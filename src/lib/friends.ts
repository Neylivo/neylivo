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
  return supabase.from('friend_requests').update({ status: accept ? 'accepted' : 'declined' }).eq('id', id)
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

// v1.230.0: приватность ЛС/звонков (см. supabase/58_dm_privacy.sql) — предварительная
// проверка на клиенте, чтобы сразу показать понятную причину, а не только словить
// отказ RLS/Edge Function постфактум. Финальное решение всё равно за сервером.
export async function canMessage(meId: string, targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_dm', { p_sender: meId, p_recipient: targetId })
  if (error) return true   // не смогли проверить — не блокируем на клиенте, решит RLS
  return !!data
}
export async function canCallUser(targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_call', { p_target: targetId })
  if (error) return true   // не смогли проверить — не блокируем на клиенте, решит Edge Function
  return !!data
}
