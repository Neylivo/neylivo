
import { supabase } from './supabase'

export type RxTable = 'reactions' | 'dm_reactions'
export interface Reaction { message_id: string; user_id: string; emoji: string }

export async function loadReactions(table: RxTable, messageIds: string[]): Promise<Reaction[]> {
  if (!messageIds.length) return []
  const { data } = await supabase.from(table).select('message_id, user_id, emoji').in('message_id', messageIds)
  return (data ?? []) as Reaction[]
}

// Toggle: if the user already reacted with this emoji, remove it; otherwise add it.
/**
 * v1.327.0: возвращает, получилось ли. Раньше ошибка молча глоталась — а с тех
 * пор, как право «Ставить реакции» стало настоящим (v1.321.0) и его можно отобрать
 * у @everyone, отказ базы стал обычным делом: человек жал на эмодзи, и не
 * происходило ровным счётом ничего, без единого слова почему.
 */
export async function toggleReaction(table: RxTable, messageId: string, userId: string, emoji: string): Promise<boolean> {
  const { data } = await supabase.from(table).select('emoji')
    .eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji).maybeSingle()
  if (data) {
    const { error } = await supabase.from(table).delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
    return !error
  }
  const { error } = await supabase.from(table).insert({ message_id: messageId, user_id: userId, emoji })
  return !error
}

// Group flat reaction rows into per-message summaries: { emoji, count, mine }
export interface RxSummary { emoji: string; count: number; users: string[] }
export function groupReactions(rows: Reaction[]): Record<string, RxSummary[]> {
  const byMsg: Record<string, Record<string, string[]>> = {}
  for (const r of rows) {
    ;(byMsg[r.message_id] ??= {})[r.emoji] ??= []
    byMsg[r.message_id][r.emoji].push(r.user_id)
  }
  const out: Record<string, RxSummary[]> = {}
  for (const mid in byMsg) {
    out[mid] = Object.entries(byMsg[mid]).map(([emoji, users]) => ({ emoji, count: users.length, users }))
  }
  return out
}

export type PinTable = 'messages' | 'dm_messages'
// v1.260.0: раньше не проверяли результат — RLS без ошибки может вернуть 0 задетых
// строк (доступ пропал/сообщение чужое), и закреп/правка «сохранялись» только в
// локальном optimistic-state, откатываясь при следующей перезагрузке ленты.
export async function setPin(table: PinTable, id: string, pinned: boolean): Promise<boolean> {
  const { data, error } = await supabase.from(table).update({ pinned }).eq('id', id).select('id')
  return !error && !!data && data.length > 0
}
/**
 * v1.327.0: возвращает, удалилось ли на самом деле. Раньше функция глотала и
 * ошибку, и «правило доступа не дало удалить ни одной строки» — а вызывающая
 * сторона к этому моменту уже убирала сообщение из ленты. В итоге сообщение
 * пропадало с экрана и оставалось в базе: у собеседника оно на месте, а после
 * перезагрузки возвращалось и к тебе.
 */
/**
 * Почему удаление не вышло — словами, чтобы сказать это человеку.
 *
 * `denied` — база отказала (это не твоё сообщение либо нет прав);
 * `net` — до базы не достучались.
 */
export type DeleteFail = 'denied' | 'net'

/**
 * Удалить сообщение (v1.435.0 — переписано).
 *
 * Что было не так. Успех определялся по тому, вернула ли база удалённую строку
 * (`delete ... returning`). Но вернуть её она может только через правило ЧТЕНИЯ,
 * а оно к удалению отношения не имеет: пустой ответ означал и «не дали удалить»,
 * и «удалила, но показывать нечего». Во втором случае приложение возвращало
 * сообщение обратно в ленту и писало «нет прав» — хотя в базе его уже не было.
 * Со стороны это выглядит ровно как жалоба владельца: «с телефона написал, с ПК
 * удалить не даёт» — а на самом деле удалилось, просто в другом окне ещё висит
 * копия и рядом неверное сообщение об отказе. Правила базы тут ни при чём: они
 * смотрят только на автора, и это теперь отдельно проверяется в test:db.
 *
 * Теперь пустой ответ — не приговор: спрашиваем, есть ли строка ещё. Нет —
 * значит удалили. Есть — значит правда отказ.
 */
export async function deleteMessage(table: PinTable, id: string): Promise<{ ok: true } | { ok: false; why: DeleteFail }> {
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) {
    const denied = /row-level security|permission denied|violates/i.test(String(error.message ?? ''))
    return { ok: false, why: denied ? 'denied' : 'net' }
  }
  if (data && data.length > 0) return { ok: true }
  const { data: still, error: readErr } = await supabase.from(table).select('id').eq('id', id).maybeSingle()
  if (readErr) return { ok: false, why: 'net' }
  return still ? { ok: false, why: 'denied' } : { ok: true }
}

export async function editMessage(table: PinTable, id: string, content: string): Promise<boolean> {
  // v1.263.0: edited_at — точное время правки, для подсказки при наведении на «(изменено)».
  // Пока миграция supabase/66_edited_at.sql не применена, колонки нет — PostgREST
  // вернёт ошибку на весь update (не проигнорирует поле молча), поэтому сначала
  // пробуем с edited_at, а при ошибке именно по нему — откатываемся на старое поведение.
  let res = await supabase.from(table).update({ content, edited: true, edited_at: new Date().toISOString() }).eq('id', id).select('id')
  if (res.error && /edited_at/i.test(res.error.message ?? '')) {
    res = await supabase.from(table).update({ content, edited: true }).eq('id', id).select('id')
  }
  const { data, error } = res
  return !error && !!data && data.length > 0
}

// v1.157.0: правка одного вложения из группы (спойлер/название/описание) —
// index соответствует позиции в attach_url, склеенном через '\n' (миграция v1.70.0).
export type AttachMetaItem = { name?: string; desc?: string } | null
export interface AttachPatch { spoiler?: boolean; name?: string; desc?: string }
export async function updateAttachment(
  table: PinTable,
  msg: { id: string; attach_url?: string | null; attach_meta?: AttachMetaItem[] | null },
  index: number,
  patch: AttachPatch,
): Promise<{ attach_url: string; attach_meta: AttachMetaItem[] } | null> {
  if (!msg.attach_url) return null
  const urls = msg.attach_url.split('\n')
  if (index < 0 || index >= urls.length) return null
  if (patch.spoiler !== undefined) {
    const clean = urls[index].replace('#spoiler', '')
    urls[index] = patch.spoiler ? clean + '#spoiler' : clean
  }
  const metaArr: AttachMetaItem[] = Array.isArray(msg.attach_meta) ? [...msg.attach_meta] : []
  while (metaArr.length < urls.length) metaArr.push(null)
  const cur = { ...(metaArr[index] ?? {}) } as { name?: string; desc?: string }
  if (patch.name !== undefined) { if (patch.name.trim()) cur.name = patch.name.trim(); else delete cur.name }
  if (patch.desc !== undefined) { if (patch.desc.trim()) cur.desc = patch.desc.trim(); else delete cur.desc }
  metaArr[index] = (cur.name || cur.desc) ? cur : null
  const attach_url = urls.join('\n')
  const { data, error } = await supabase.from(table).update({ attach_url, attach_meta: metaArr }).eq('id', msg.id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Не сохранилось — нет прав на изменение сообщения')
  return { attach_url, attach_meta: metaArr }
}
