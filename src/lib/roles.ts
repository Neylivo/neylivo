import { supabase } from './supabase'

// Цветные роли (как в Discord). Роли живут в таблице server_roles, назначение —
// в server_members.role_id (миграция 12_roles.sql). Если миграция ещё не
// применена, запросы тихо вернут пусто и интерфейс просто не покажет роли.
// Иерархия ролей (position) и флаг «Управление сервером» (manage) — миграция 18_role_perms.sql.
export interface ServerRole { id: string; server_id: string; name: string; color: string; position: number; manage?: boolean }

export const ROLE_COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#00b0f4', '#99aab5']

export async function fetchRoles(serverId: string): Promise<ServerRole[]> {
  const { data } = await supabase.from('server_roles').select('*').eq('server_id', serverId).order('position').order('created_at')
  return (data ?? []) as ServerRole[]
}

export async function createRole(serverId: string, name: string, color: string) {
  return supabase.from('server_roles').insert({ server_id: serverId, name, color })
}

export async function deleteRole(id: string) {
  return supabase.from('server_roles').delete().eq('id', id)
}

export async function assignRole(serverId: string, userId: string, roleId: string | null) {
  return supabase.from('server_members').update({ role_id: roleId }).eq('server_id', serverId).eq('user_id', userId)
}

// Флаг «Управление сервером»: роль даёт доступ к настройкам сервера (миграция 18_role_perms.sql).
export async function setRoleManage(id: string, manage: boolean) {
  return supabase.from('server_roles').update({ manage }).eq('id', id)
}

// Сохранить иерархию: позиции 0..n-1 в порядке массива (0 — самая высокая роль).
export async function saveRoleOrder(roles: ServerRole[]) {
  for (let i = 0; i < roles.length; i++) {
    const { error } = await supabase.from('server_roles').update({ position: i }).eq('id', roles[i].id)
    if (error) return { error }
  }
  return { error: null }
}
