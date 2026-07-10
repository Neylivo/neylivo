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
  // v1.191.0: расширенный набор — 10 новых битов (см. supabase/49_role_perms2.sql).
  // CREATE_INVITE/MENTION_EVERYONE/ADD_REACTIONS/ATTACH_FILES по умолчанию
  // разрешены всем (servers.base_permissions) — тут их можно только ОТОБРАТЬ
  // у конкретной роли не выйдет, но явная выдача роли не мешает базовым правам.
  VIEW_AUDIT_LOG: 64,
  MANAGE_EMOJI: 128,
  MANAGE_EVENTS: 256,
  MANAGE_WEBHOOKS: 512,
  CREATE_INVITE: 1024,
  MENTION_EVERYONE: 2048,
  ADD_REACTIONS: 4096,
  ATTACH_FILES: 8192,
  TIMEOUT_MEMBERS: 16384,
  MANAGE_AUTOMOD: 32768,
} as const
export type PermBit = typeof PERM[keyof typeof PERM]

// Группировка для редактора роли — как категории прав в Discord.
export const PERM_GROUPS: { title: string; perms: { bit: PermBit; label: string; hint: string }[] }[] = [
  { title: 'Общие права сервера', perms: [
    { bit: PERM.MANAGE_SERVER, label: 'Управление сервером', hint: 'Открывать «Настройки сервера» и менять профиль, доступ' },
    { bit: PERM.MANAGE_ROLES, label: 'Управление ролями', hint: 'Создавать, изменять и удалять роли; назначать их участникам' },
    { bit: PERM.MANAGE_CHANNELS, label: 'Управление каналами', hint: 'Создавать, изменять и удалять каналы и категории' },
    { bit: PERM.MANAGE_EVENTS, label: 'Управление событиями', hint: 'Создавать и отменять события сервера' },
    { bit: PERM.MANAGE_EMOJI, label: 'Управление эмодзи и стикерами', hint: 'Загружать и удалять свои эмодзи/стикеры сервера' },
    { bit: PERM.MANAGE_WEBHOOKS, label: 'Управление ботами', hint: 'Добавлять и удалять ботов на сервере' },
    { bit: PERM.MANAGE_AUTOMOD, label: 'Управление автомодерацией', hint: 'Настраивать фильтры автомодерации' },
    { bit: PERM.VIEW_AUDIT_LOG, label: 'Просмотр журнала аудита', hint: 'Видеть историю действий модераторов на сервере' },
  ] },
  { title: 'Права участников', perms: [
    { bit: PERM.KICK_MEMBERS, label: 'Кикать участников', hint: 'Удалять участников с сервера — они смогут вернуться по новому приглашению' },
    { bit: PERM.BAN_MEMBERS, label: 'Банить участников', hint: 'Удалять участников с сервера без возможности вернуться' },
    { bit: PERM.TIMEOUT_MEMBERS, label: 'Отправлять в тайм-аут', hint: 'Временно запретить участнику писать и ставить реакции' },
    { bit: PERM.CREATE_INVITE, label: 'Создавать приглашения', hint: 'Генерировать код приглашения на сервер' },
  ] },
  { title: 'Права текстовых каналов', perms: [
    { bit: PERM.MANAGE_MESSAGES, label: 'Управление сообщениями', hint: 'Удалять и закреплять чужие сообщения' },
    { bit: PERM.MENTION_EVERYONE, label: 'Упоминание @everyone', hint: 'Упоминание реально оповещает всех участников' },
    { bit: PERM.ADD_REACTIONS, label: 'Добавление реакций', hint: 'Ставить эмодзи-реакции на сообщения' },
    { bit: PERM.ATTACH_FILES, label: 'Прикрепление файлов', hint: 'Отправлять файлы и изображения' },
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
// v1.191.0: тайм-аут — until=null снимает досрочно.
export async function timeoutMember(serverId: string, targetId: string, until: Date | null): Promise<void> {
  const { error } = await supabase.rpc('timeout_member', { p_server: serverId, p_target: targetId, p_until: until ? until.toISOString() : null })
  if (error) throw error
}

export interface ServerBan { server_id: string; user_id: string; banned_by: string; reason: string | null; created_at: string }
export async function fetchBans(serverId: string): Promise<ServerBan[]> {
  const { data } = await supabase.from('server_bans').select('*').eq('server_id', serverId).order('created_at', { ascending: false })
  return (data ?? []) as ServerBan[]
}
