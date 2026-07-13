import { supabase } from './supabase'
import type { Profile, DMThread } from '../types'
import { tagFor, parseFriendCode } from './friendCode'

export async function searchUsers(q: string, exceptId: string): Promise<Profile[]> {
  const term = q.trim()
  if (!term) return []
  // v1.40.0: ищем и по юзернейму, и по нику (display_name). До миграции 21 колонки
  // display_name может не быть — тогда откатываемся на поиск только по юзернейму.
  const safe = term.replace(/[,()]/g, '')
  let { data, error } = await supabase.from('profiles').select('*')
    .or('username.ilike.%' + safe + '%,display_name.ilike.%' + safe + '%').limit(10)
  if (error) ({ data } = await supabase.from('profiles').select('*')
    .ilike('username', '%' + term + '%').limit(10))
  return (data ?? []).filter(p => p.id !== exceptId)
}

// Find a profile by its friend code "Имя#7401". The tag is a pure function of
// the user id (see friendCode.ts), so we fetch same-named profiles and match.
export async function findByCode(code: string): Promise<Profile | null> {
  const parsed = parseFriendCode(code)
  if (!parsed) return null
  const { data } = await supabase.from('profiles').select('*')
    .eq('username', parsed.name).limit(50)
  const candidates = (data ?? []) as Profile[]
  return candidates.find(p => tagFor(p.id) === parsed.tag) ?? null
}

// Точный поиск по юзернейму (без учёта регистра) — добавление в друзья как в Discord.
// Если вдруг несколько совпадений, предпочитаем точное по регистру, иначе первое.
export async function findByUsername(name: string): Promise<Profile | null> {
  const term = name.trim()
  if (!term) return null
  const { data } = await supabase.from('profiles').select('*').ilike('username', term).limit(5)
  const list = (data ?? []) as Profile[]
  return list.find(p => p.username === term) ?? list[0] ?? null
}

// Общие друзья двух пользователей: пересечение принятых friend_requests.
export async function mutualFriends(aId: string, bId: string): Promise<Profile[]> {
  const q = (uid: string) => supabase.from('friend_requests').select('from_user, to_user')
    .eq('status', 'accepted').or('from_user.eq.' + uid + ',to_user.eq.' + uid)
  const [a, b] = await Promise.all([q(aId), q(bId)])
  const others = (rows: any[] | null, uid: string) =>
    new Set((rows ?? []).map(r => r.from_user === uid ? r.to_user : r.from_user))
  const mine = others(a.data as any[], aId)
  const theirs = others(b.data as any[], bId)
  const common = [...mine].filter(x => theirs.has(x) && x !== aId && x !== bId)
  if (common.length === 0) return []
  const { data } = await supabase.from('profiles').select('*').in('id', common.slice(0, 30))
  return (data ?? []) as Profile[]
}

export async function sendRequest(fromId: string, fromName: string, to: Profile) {
  return supabase.from('friend_requests').insert({
    // v1.40.0: в заявке храним ник (display_name), а не юзернейм — в списках друзей показывается ник
    from_user: fromId, to_user: to.id, from_name: fromName, to_name: (to.display_name || to.username), status: 'pending',
  })
}

export async function respondRequest(id: string, accept: boolean) {
  // .select('id') — без него update() не сообщает, сколько строк реально
  // изменилось: обновление несуществующей/уже неактуальной заявки (id устарел)
  // молча "успевает" с пустым результатом вместо ошибки.
  return supabase.from('friend_requests').update({ status: accept ? 'accepted' : 'declined' }).eq('id', id).select('id')
}

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends'
// v1.232.0: статус отношений с конкретным человеком — для кнопки «Добавить в
// друзья»/«Друг» в полном профиле (см. ProfileCard.tsx). Берём ВСЕ строки между
// парой (не .maybeSingle()) — обе стороны могли одновременно отправить заявку
// друг другу до того, как кто-то ответил, тогда совпадающих строк будет две.
export async function friendStatus(meId: string, otherId: string): Promise<{ status: FriendStatus; requestId: string | null }> {
  const { data } = await supabase.from('friend_requests').select('id,from_user,to_user,status')
    .or(`and(from_user.eq.${meId},to_user.eq.${otherId}),and(from_user.eq.${otherId},to_user.eq.${meId})`)
  const rows = (data ?? []) as any[]
  const accepted = rows.find(r => r.status === 'accepted')
  if (accepted) return { status: 'friends', requestId: accepted.id }
  const out = rows.find(r => r.status === 'pending' && r.from_user === meId)
  if (out) return { status: 'pending_out', requestId: out.id }
  const inc = rows.find(r => r.status === 'pending' && r.from_user === otherId)
  if (inc) return { status: 'pending_in', requestId: inc.id }
  return { status: 'none', requestId: null }
}

// Разрыв дружбы/отмена заявки — сносит запись(и) в обе стороны (то же, что
// «Удалить из друзей» в DMHome.tsx, вынесено сюда для переиспользования).
export async function removeFriendship(meId: string, otherId: string) {
  return supabase.from('friend_requests').delete()
    .or(`and(from_user.eq.${meId},to_user.eq.${otherId}),and(from_user.eq.${otherId},to_user.eq.${meId})`)
}

// Canonical (ordered) DM thread between two users; created on first open.
// v1.227.0: раньше при ошибке (RLS/сеть) просто отдавала null — вызывающий код видел
// только «не получилось», без единой зацепки, что именно сломалось. Логируем и
// пробрасываем настоящую ошибку Supabase, чтобы её было видно в тосте/консоли.
export async function openThread(meId: string, otherId: string): Promise<DMThread | null> {
  const [a, b] = [meId, otherId].sort()
  const found = await supabase.from('dm_threads').select('*').eq('user_a', a).eq('user_b', b).maybeSingle()
  if (found.error) { console.error('[openThread] select failed:', found.error); throw found.error }
  if (found.data) return found.data as DMThread
  const ins = await supabase.from('dm_threads').insert({ user_a: a, user_b: b }).select().single()
  if (ins.error) { console.error('[openThread] insert failed:', ins.error); throw ins.error }
  return (ins.data as DMThread) ?? null
}

// v1.229.0: id всех, с кем есть личная переписка (1-в-1) — НЕЗАВИСИМО от того,
// друзья ли ещё сейчас. Как в Discord: удаление из друзей не трогает диалог,
// его история и сама возможность писать/читать остаются — сайдбар ЛС строится
// по факту переписки, а не по списку друзей.
export async function fetchDmPartnerIds(meId: string): Promise<string[]> {
  const { data } = await supabase.from('dm_threads').select('user_a,user_b')
    .or('user_a.eq.' + meId + ',user_b.eq.' + meId)
  const ids = new Set<string>()
  for (const t of (data ?? []) as any[]) {
    const other = t.user_a === meId ? t.user_b : t.user_a
    if (other) ids.add(other)
  }
  return [...ids]
}

// v1.269.0: как fetchDmPartnerIds, но парой с id самого диалога — числовой
// бейджик непрочитанного в сайдбаре (src/lib/badge.ts) ключуется по id
// диалога ('dm:<id>'), а не по id собеседника.
export async function fetchDmThreadMap(meId: string): Promise<Record<string, string>> {
  const { data } = await supabase.from('dm_threads').select('id,user_a,user_b')
    .or('user_a.eq.' + meId + ',user_b.eq.' + meId)
  const map: Record<string, string> = {}
  for (const t of (data ?? []) as any[]) {
    const other = t.user_a === meId ? t.user_b : t.user_a
    if (other) map[other] = t.id
  }
  return map
}

// v1.230.0: приватность звонков (см. supabase/58_dm_privacy.sql) — предварительная
// проверка на клиенте, чтобы сразу показать понятную причину, а не только словить
// отказ Edge Function постфактум. Финальное решение всё равно за сервером.
// (Аналог для сообщений, can_dm/canMessage, не заведён: openChat/sendMsg в
// DMHome.tsx уже сами по факту распознают отказ RLS и показывают понятный текст.)
export async function canCallUser(targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_call', { p_target: targetId })
  if (error) return true   // не смогли проверить — не блокируем на клиенте, решит Edge Function
  return !!data
}
