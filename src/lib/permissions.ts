import { supabase } from './supabase'

// Битовая маска прав ролей — как в Discord (v1.156.0). Раньше был единственный
// флаг server_roles.manage; теперь каждый бит реально подключён к конкретному
// действию (кик/бан/каналы/роли/сообщения), а не просто лежит заготовкой в UI.
export const PERM = {
  MANAGE_SERVER: 1,
  MANAGE_ROLES: 2,
  MANAGE_CHANNELS: 4,
  KICK_MEMBERS: 8,
  BAN_MEMBERS: 16,
  MANAGE_MESSAGES: 32,
} as const
export type PermBit = typeof PERM[keyof typeof PERM]

// Группировка для редактора роли — как категории прав в Discord.
export const PERM_GROUPS: { title: string; perms: { bit: PermBit; label: string; hint: string }[] }[] = [
  { title: 'Общие права сервера', perms: [
    { bit: PERM.MANAGE_SERVER, label: 'Управление сервером', hint: 'Открывать «Настройки сервера» и менять профиль, доступ, автомодерацию' },
    { bit: PERM.MANAGE_ROLES, label: 'Управление ролями', hint: 'Создавать, изменять и удалять роли; назначать их участникам' },
    { bit: PERM.MANAGE_CHANNELS, label: 'Управление каналами', hint: 'Создавать, изменять и удалять каналы и категории' },
  ] },
  { title: 'Права участников', perms: [
    { bit: PERM.KICK_MEMBERS, label: 'Кикать участников', hint: 'Удалять участников с сервера — они смогут вернуться по новому приглашению' },
    { bit: PERM.BAN_MEMBERS, label: 'Банить участников', hint: 'Удалять участников с сервера без возможности вернуться' },
  ] },
  { title: 'Права текстовых каналов', perms: [
    { bit: PERM.MANAGE_MESSAGES, label: 'Управление сообщениями', hint: 'Удалять и закреплять чужие сообщения' },
  ] },
]

export const hasPerm = (mask: number | undefined | null, bit: PermBit): boolean => ((mask ?? 0) & bit) !== 0

export async function kickMember(serverId: string, targetId: string): Promise<void> {
  const { error } = await supabase.rpc('kick_member', { p_server: serverId, p_target: targetId })
  if (error) throw error
}
export async function banMember(serverId: string, targetId: string, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc('ban_member', { p_server: serverId, p_target: targetId, p_reason: reason ?? null })
  if (error) throw error
}
export async function unbanMember(serverId: string, targetId: string): Promise<void> {
  const { error } = await supabase.rpc('unban_member', { p_server: serverId, p_target: targetId })
  if (error) throw error
}

export interface ServerBan { server_id: string; user_id: string; banned_by: string; reason: string | null; created_at: string }
export async function fetchBans(serverId: string): Promise<ServerBan[]> {
  const { data } = await supabase.from('server_bans').select('*').eq('server_id', serverId).order('created_at', { ascending: false })
  return (data ?? []) as ServerBan[]
}
