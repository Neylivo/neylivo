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

export async function createServer(name: string, meId: string, meName: string) {
  const { data, error } = await supabase.from('servers').insert({ name, owner: meId }).select().single()
  if (error || !data) return { error }
  await supabase.from('server_members').insert({ server_id: data.id, user_id: meId, member_name: meName, role: 'owner' })
  await supabase.from('channels').insert({ server_id: data.id, name: 'общий' })
  return { server: data as Server }
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
