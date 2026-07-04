import { supabase } from './supabase'
import type { Server } from '../types'

function genCode() {
  const s = 'abcdefghjkmnpqrstuvwxyz23456789'
  let c = ''
  for (let i = 0; i < 8; i++) c += s[Math.floor(Math.random() * s.length)]
  return c
}

export async function myServers(): Promise<Server[]> {
  const { data } = await supabase.from('servers').select('*').order('created_at')
  return (data ?? []) as Server[]
}

export async function createServer(name: string, meId: string, meName: string, avatarUrl?: string | null) {
  const { data, error } = await supabase.from('servers').insert({ name, owner: meId, avatar_url: avatarUrl ?? null }).select().single()
  if (error || !data) return { error }
  await supabase.from('server_members').insert({ server_id: data.id, user_id: meId, member_name: meName, role: 'owner' })
  await supabase.from('channels').insert({ server_id: data.id, name: 'общий' })
  return { server: data as Server }
}

// Update shared server fields (name / avatar / accent). Stored on the servers row
// so every member sees the same avatar & accent on any device.
export async function updateServer(id: string, patch: { name?: string; avatar_url?: string | null; accent?: string | null }) {
  return supabase.from('servers').update(patch).eq('id', id)
}

export async function createInvite(serverId: string, meId: string) {
  const code = genCode()
  const { error } = await supabase.from('server_invites').insert({ code, server_id: serverId, created_by: meId })
  if (error) return { error }
  return { code }
}

export async function joinByCode(code: string, meId: string, meName: string) {
  const clean = code.trim().replace(/^.*\//, '')  // allow pasting a full link
  const inv = await supabase.from('server_invites').select('*').eq('code', clean).maybeSingle()
  if (!inv.data) return { error: { message: 'Приглашение не найдено' } }
  const { error } = await supabase.from('server_members')
    .insert({ server_id: inv.data.server_id, user_id: meId, member_name: meName, role: 'member' })
  if (error && error.code !== '23505' && !String(error.message).includes('duplicate')) return { error }
  return { serverId: inv.data.server_id as string }
}

// Members with their profile avatar_url merged in (server_members has no avatar column).
export async function listMembers(serverId: string) {
  const { data } = await supabase.from('server_members').select('*').eq('server_id', serverId).order('joined_at')
  const members = (data ?? []) as any[]
  if (members.length === 0) return members
  const ids = members.map(m => m.user_id)
  const { data: profs } = await supabase.from('profiles').select('id, avatar_url').in('id', ids)
  const byId: Record<string, string | null> = {}
  for (const p of ((profs ?? []) as any[])) byId[p.id] = p.avatar_url ?? null
  return members.map(m => ({ ...m, avatar_url: byId[m.user_id] ?? null }))
}

// Общие сервера двух пользователей (вкладка «Общие сервера» в фулл-профиле).
export async function mutualServers(aId: string, bId: string): Promise<Server[]> {
  const [a, b] = await Promise.all([
    supabase.from('server_members').select('server_id').eq('user_id', aId),
    supabase.from('server_members').select('server_id').eq('user_id', bId),
  ])
  const setB = new Set(((b.data ?? []) as any[]).map(r => r.server_id))
  const ids = [...new Set(((a.data ?? []) as any[]).map(r => r.server_id))].filter(id => setB.has(id))
  if (ids.length === 0) return []
  const { data } = await supabase.from('servers').select('*').in('id', ids)
  return (data ?? []) as Server[]
}

export async function findServers(q: string): Promise<Server[]> {
  const term = q.trim()
  if (!term) return []
  const byName = await supabase.from('servers').select('*').ilike('name', '%' + term + '%').limit(10)
  const list = (byName.data ?? []) as Server[]
  if (list.length === 0 && /^[0-9a-f-]{6,}$/i.test(term)) {
    const byId = await supabase.from('servers').select('*').eq('id', term).maybeSingle()
    if (byId.data) return [byId.data as Server]
  }
  return list
}

export async function renameServer(id: string, name: string) {
  return updateServer(id, { name })
}

export async function deleteServer(id: string) {
  await supabase.from('channels').delete().eq('server_id', id)
  await supabase.from('server_members').delete().eq('server_id', id)
  await supabase.from('server_invites').delete().eq('server_id', id)
  return supabase.from('servers').delete().eq('id', id)
}