// v1.187.0: блокировка пользователя как в настоящем Discord — останавливает
// переписку в обе стороны на уровне БД (RLS в 48_block.sql), рвёт дружбу и
// прячет сообщения заблокированного везде (ЛС и серверы). Лёгкая версия,
// не трогающая ни дружбу, ни доставку — src/lib/userPrefs.ts (isDmIgnored).
import { supabase } from './supabase'

let mine: string | null = null
const blocked = new Set<string>()   // id людей, с кем есть блок в любую сторону (я блокировал ИЛИ меня)
let chan: ReturnType<typeof supabase.channel> | null = null

export async function loadBlocked(meId: string) {
  mine = meId
  blocked.clear()
  const { data } = await supabase.from('blocked_users').select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${meId},blocked_id.eq.${meId}`)
  for (const r of (data ?? []) as any[]) blocked.add(r.blocker_id === meId ? r.blocked_id : r.blocker_id)
  window.dispatchEvent(new CustomEvent('ponoi-blocked'))
}

// v1.252.0: blocked_users не был в публикации realtime (supabase/63_more_realtime.sql) —
// блокировка/разблокировка на одном устройстве не пряталась/не возвращалась в
// переписке (isBlockedWith ниже, используется в фильтре MessageList) на другом,
// пока не перезайдёшь. Два отдельных .on() — Supabase не умеет OR по колонкам
// в одном filter, а блок бывает «я блокировал» ИЛИ «меня заблокировали».
export function watchBlocked(meId: string) {
  if (chan) { supabase.removeChannel(chan); chan = null }
  chan = supabase.channel('blocked:' + meId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_users', filter: 'blocker_id=eq.' + meId }, () => loadBlocked(meId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_users', filter: 'blocked_id=eq.' + meId }, () => loadBlocked(meId))
    .subscribe()
}

export function isBlockedWith(otherId: string): boolean { return blocked.has(otherId) }

export async function blockUser(meId: string, otherId: string) {
  await supabase.from('blocked_users').insert({ blocker_id: meId, blocked_id: otherId })
  await supabase.from('friend_requests').delete()
    .or(`and(from_user.eq.${meId},to_user.eq.${otherId}),and(from_user.eq.${otherId},to_user.eq.${meId})`)
  blocked.add(otherId)
}

export async function unblockUser(meId: string, otherId: string) {
  await supabase.from('blocked_users').delete().eq('blocker_id', meId).eq('blocked_id', otherId)
  blocked.delete(otherId)
}

// v1.246.0: список тех, кого заблокировал именно я (а не любая сторона блока, как
// в `blocked` выше) — для экрана «Заблокированные» в настройках. Разблокировать
// раньше было нельзя вообще — обратной кнопки не было нигде в интерфейсе.
export interface BlockedEntry { id: string; username: string; avatar_url: string | null }
export async function listBlockedByMe(meId: string): Promise<BlockedEntry[]> {
  const { data: rows } = await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', meId)
  const ids = (rows ?? []).map((r: any) => r.blocked_id)
  if (!ids.length) return []
  const { data: profs } = await supabase.from('profiles').select('id, username, avatar_url').in('id', ids)
  return ((profs ?? []) as any[]).map(p => ({ id: p.id, username: p.username, avatar_url: p.avatar_url ?? null }))
}
