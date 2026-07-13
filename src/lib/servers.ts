import { supabase } from './supabase'
import type { Server } from '../types'

function genCode() {
  const s = 'abcdefghjkmnpqrstuvwxyz23456789'
  let c = ''
  for (let i = 0; i < 8; i++) c += s[Math.floor(Math.random() * s.length)]
  return c
}

export async function myServers(): Promise<Server[]> {
  // v1.272.0: раньше error молча игнорировалась — сбой сети (Supabase недоступен)
  // и «у тебя правда нет серверов» выглядели абсолютно одинаково: пустой список.
  // Бросаем ошибку — вызывающая сторона (Home.tsx) отличает «правда пусто» от
  // «не достучались» и во втором случае не затирает уже показанный кэш.
  const { data, error } = await supabase.from('servers').select('*').order('created_at')
  if (error) throw error
  return (data ?? []) as Server[]
}

export async function createServer(name: string, meId: string, meName: string, avatarUrl?: string | null) {
  const { data, error } = await supabase.from('servers').insert({ name, owner: meId, avatar_url: avatarUrl ?? null }).select().single()
  if (error || !data) return { error }
  await supabase.from('server_members').insert({ server_id: data.id, user_id: meId, member_name: meName, role: 'owner' })
  // Стартовые каналы как в Discord: текстовый «основной» + голосовой «Основной».
  const ins = await supabase.from('channels').insert([
    { server_id: data.id, name: 'основной', kind: 'text' },
    { server_id: data.id, name: 'Основной', kind: 'voice' },
  ] as any)
  if (ins.error) await supabase.from('channels').insert({ server_id: data.id, name: 'основной' })
  return { server: data as Server }
}

// Update shared server fields (name / avatar / accent). Stored on the servers row
// so every member sees the same avatar & accent on any device.
// v1.255.0: раньше отдавал сырой ответ Supabase как есть — RLS без совпадения
// строки молча обновляет 0 строк (error остаётся null), и ServerView.tsx
// (createCategory/deleteCategory/renameCategory, только `if (error)`) принимал
// это за успех: категория «создавалась» в интерфейсе, но не сохранялась в базе.
// Сохраняем ФОРМУ ответа ({data, error}) — вызывающие уже проверяют error —
// просто синтезируем его на месте несовпавших 0 строк.
export async function updateServer(id: string, patch: { name?: string; avatar_url?: string | null; accent?: string | null }) {
  const res = await supabase.from('servers').update(patch).eq('id', id).select('id')
  if (!res.error && (!res.data || res.data.length === 0)) {
    return { ...res, error: { message: 'Не сохранилось — нет прав на изменение сервера' } as any }
  }
  return res
}

// v1.263.0: приглашения бессрочны (нет expires_at/max_uses) — раньше каждое
// открытие панели «Пригласить» плодило новую вечную ссылку на server_invites.
// Теперь сперва ищем уже существующую свою ссылку для этого сервера и переиспользуем её.
export async function createInvite(serverId: string, meId: string) {
  const { data: existing } = await supabase.from('server_invites').select('code')
    .eq('server_id', serverId).eq('created_by', meId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.code) return { code: existing.code as string }
  const code = genCode()
  const { error } = await supabase.from('server_invites').insert({ code, server_id: serverId, created_by: meId })
  if (error) return { error }
  return { code }
}

export async function joinByCode(code: string, _meId: string, meName: string) {
  const clean = code.trim().replace(/^.*\//, '')  // allow pasting a full link
  // v1.200.0: было прямое select server_invites (RLS пускал читать ЛЮБОЙ инвайт
  // кому угодно) + прямой insert в server_members без проверки инвайта вообще —
  // см. supabase/54_security_hardening.sql. Теперь всё — включая проверку паузы
  // приглашений и бана — делает security-definer RPC на сервере.
  const { data, error } = await supabase.rpc('redeem_invite', { p_code: clean, p_member_name: meName })
  if (error) {
    const msg = String(error.message || '')
    if (msg.includes('invite_not_found')) return { error: { message: 'Приглашение не найдено' } }
    if (msg.includes('invites_paused')) return { error: { message: 'Приглашения на этот сервер приостановлены' } }
    if (msg.includes('banned')) return { error: { message: 'Вы забанены на этом сервере' } }
    return { error }
  }
  return { serverId: data as string }
}

// Members with their profile avatar_url merged in (server_members has no avatar column).
export async function listMembers(serverId: string) {
  const { data } = await supabase.from('server_members').select('*').eq('server_id', serverId).order('joined_at')
  const members = (data ?? []) as any[]
  if (members.length === 0) return members
  const ids = members.map(m => m.user_id)
  // v1.95.0: тянем и «кубик» (nameplate); до миграции 24 колонок нет — откатываемся на базовый набор.
  let profs: any[] | null = null
  const r = await supabase.from('profiles').select('id, avatar_url, nameplate_url, nameplate_kind, nameplate_outline').in('id', ids)
  if (!r.error) profs = (r.data ?? []) as any[]
  else { const r2 = await supabase.from('profiles').select('id, avatar_url').in('id', ids); profs = (r2.data ?? []) as any[] }
  const byId: Record<string, any> = {}
  for (const p of (profs ?? [])) byId[p.id] = p
  return members.map(m => ({ ...m,
    avatar_url: byId[m.user_id]?.avatar_url ?? null,
    nameplate_url: byId[m.user_id]?.nameplate_url ?? null,
    nameplate_kind: byId[m.user_id]?.nameplate_kind ?? null,
    nameplate_outline: byId[m.user_id]?.nameplate_outline ?? null }))
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

// «Путешествие по серверам» (v1.48.0): подборка/поиск сообществ с числом
// участников и пометкой серверов, где ты уже состоишь.
export type DiscoverServer = Server & { members: number; joined: boolean }

export async function discoverServers(q: string, meId: string): Promise<DiscoverServer[]> {
  const term = q.trim()
  let list: Server[] = []
  if (!term) {
    const { data } = await supabase.from('servers').select('*').limit(30)
    list = (data ?? []) as Server[]
  } else {
    const byName = await supabase.from('servers').select('*').ilike('name', '%' + term + '%').limit(20)
    list = (byName.data ?? []) as Server[]
    if (list.length === 0 && /^[0-9a-f-]{6,}$/i.test(term)) {
      const byId = await supabase.from('servers').select('*').eq('id', term).maybeSingle()
      if (byId.data) list = [byId.data as Server]
    }
  }
  if (list.length === 0) return []
  const ids = list.map(s => s.id)
  const { data: mem } = await supabase.from('server_members').select('server_id, user_id').in('server_id', ids)
  const counts: Record<string, number> = {}
  const mine = new Set<string>()
  for (const r of ((mem ?? []) as any[])) {
    counts[r.server_id] = (counts[r.server_id] ?? 0) + 1
    if (r.user_id === meId) mine.add(r.server_id)
  }
  return list
    .map(s => ({ ...s, members: counts[s.id] ?? 0, joined: mine.has(s.id) }))
    .sort((a, b) => b.members - a.members)
}

// Вступление без кода приглашения — из «Путешествия по серверам».
export async function joinServerDirect(serverId: string, meId: string, meName: string) {
  const { error } = await supabase.from('server_members')
    .insert({ server_id: serverId, user_id: meId, member_name: meName, role: 'member' })
  if (error && error.code !== '23505' && !String(error.message).includes('duplicate')) return { error }
  return { serverId }
}
