import { supabase } from './supabase'
import type { Profile, DMThread } from '../types'

export async function searchUsers(q: string, exceptId: string): Promise<Profile[]> {
  const term = q.trim()
  if (!term) return []
  const { data } = await supabase.from('profiles').select('*')
    .ilike('username', '%' + term + '%').limit(10)
  return (data ?? []).filter(p => p.id !== exceptId)
}

export async function sendRequest(fromId: string, fromName: string, to: Profile) {
  return supabase.from('friend_requests').insert({
    from_user: fromId, to_user: to.id, from_name: fromName, to_name: to.username, status: 'pending',
  })
}

export async function respondRequest(id: string, accept: boolean) {
  return supabase.from('friend_requests').update({ status: accept ? 'accepted' : 'declined' }).eq('id', id)
}

// Canonical (ordered) DM thread between two users; created on first open.
export async function openThread(meId: string, otherId: string): Promise<DMThread | null> {
  const [a, b] = [meId, otherId].sort()
  const found = await supabase.from('dm_threads').select('*').eq('user_a', a).eq('user_b', b).maybeSingle()
  if (found.data) return found.data as DMThread
  const ins = await supabase.from('dm_threads').insert({ user_a: a, user_b: b }).select().single()
  return (ins.data as DMThread) ?? null
}
