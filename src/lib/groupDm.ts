// v1.223.0: групповые беседы (3-10 человек) — «Новая беседа» с несколькими
// друзьями сразу, как в Discord. См. supabase/56_group_dm.sql — состав хранится
// в dm_participants (не в dm_threads.user_a/user_b, тех для группы >2 не хватит),
// все изменения состава/названия идут через security-definer RPC (не прямой
// апдейт таблицы), RLS сам решает, кто видит сообщения/состав.
import { supabase } from './supabase'
import type { Profile } from '../types'

export interface GroupThread {
  id: string
  name: string | null
  ownerId: string | null
  createdAt: string
  memberIds: string[]   // включая себя
}

export async function fetchGroupThreads(meId: string): Promise<GroupThread[]> {
  const { data: mine } = await supabase.from('dm_participants').select('thread_id').eq('user_id', meId)
  const ids = [...new Set(((mine ?? []) as any[]).map(p => p.thread_id as string))]
  if (ids.length === 0) return []
  const [{ data: threads }, { data: allParts }] = await Promise.all([
    supabase.from('dm_threads').select('id,name,owner_id,created_at').in('id', ids).eq('is_group', true),
    supabase.from('dm_participants').select('thread_id,user_id').in('thread_id', ids),
  ])
  const byThread = new Map<string, string[]>()
  for (const p of (allParts ?? []) as any[]) {
    const arr = byThread.get(p.thread_id) ?? []
    arr.push(p.user_id)
    byThread.set(p.thread_id, arr)
  }
  return ((threads ?? []) as any[]).map(t => ({
    id: t.id as string, name: (t.name as string) ?? null, ownerId: (t.owner_id as string) ?? null,
    createdAt: t.created_at as string, memberIds: byThread.get(t.id) ?? [],
  }))
}

export async function fetchGroupMembers(threadId: string): Promise<Profile[]> {
  const { data: parts } = await supabase.from('dm_participants').select('user_id').eq('thread_id', threadId)
  const ids = ((parts ?? []) as any[]).map(p => p.user_id as string)
  if (ids.length === 0) return []
  const { data } = await supabase.from('profiles').select('*').in('id', ids)
  return (data ?? []) as Profile[]
}

export async function createGroupDm(memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_dm', { p_member_ids: memberIds })
  if (error) throw error
  return data as string
}

export async function addGroupMember(threadId: string, userId: string) {
  const { error } = await supabase.rpc('add_group_member', { p_thread_id: threadId, p_user_id: userId })
  if (error) throw error
}

export async function removeGroupMember(threadId: string, userId: string) {
  const { error } = await supabase.rpc('remove_group_member', { p_thread_id: threadId, p_user_id: userId })
  if (error) throw error
}

export async function renameGroupDm(threadId: string, name: string) {
  const { error } = await supabase.rpc('rename_group_dm', { p_thread_id: threadId, p_name: name })
  if (error) throw error
}

// Имя беседы без своего названия — как в Discord: имена участников через запятую
// (кроме себя, которого вызывающий уже отфильтровал по id), длинные списки — «и ещё N».
export function groupDisplayName(otherNames: string[]): string {
  if (otherNames.length === 0) return 'Беседа'
  if (otherNames.length <= 3) return otherNames.join(', ')
  return otherNames.slice(0, 2).join(', ') + ' и ещё ' + (otherNames.length - 2)
}
