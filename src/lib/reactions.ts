
import { supabase } from './supabase'

export type RxTable = 'reactions' | 'dm_reactions'
export interface Reaction { message_id: string; user_id: string; emoji: string }

export async function loadReactions(table: RxTable, messageIds: string[]): Promise<Reaction[]> {
  if (!messageIds.length) return []
  const { data } = await supabase.from(table).select('message_id, user_id, emoji').in('message_id', messageIds)
  return (data ?? []) as Reaction[]
}

// Toggle: if the user already reacted with this emoji, remove it; otherwise add it.
export async function toggleReaction(table: RxTable, messageId: string, userId: string, emoji: string) {
  const { data } = await supabase.from(table).select('emoji')
    .eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji).maybeSingle()
  if (data) {
    await supabase.from(table).delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
  } else {
    await supabase.from(table).insert({ message_id: messageId, user_id: userId, emoji })
  }
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
export async function setPin(table: PinTable, id: string, pinned: boolean) {
  await supabase.from(table).update({ pinned }).eq('id', id)
}
export async function deleteMessage(table: PinTable, id: string) {
  await supabase.from(table).delete().eq('id', id)
}

export async function editMessage(table: PinTable, id: string, content: string) {
  await supabase.from(table).update({ content, edited: true }).eq('id', id)
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
  const { error } = await supabase.from(table).update({ attach_url, attach_meta: metaArr }).eq('id', msg.id)
  if (error) throw error
  return { attach_url, attach_meta: metaArr }
}
