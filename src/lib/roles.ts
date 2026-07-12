import { supabase } from './supabase'

// Цветные роли (как в Discord). Роли живут в таблице server_roles; назначение —
// с v1.96.0 в таблице member_roles (участнику можно дать сколько угодно ролей,
// миграция 25_member_roles.sql), раньше — одиночное server_members.role_id
// (миграция 12). Код читает обе: до миграции 25 всё работает по-старому.
// Иерархия ролей (position, 0 — высшая) и флаг «Управление сервером» (manage) —
// миграция 18. Значок роли (icon_url) — миграция 25.
export interface ServerRole { id: string; server_id: string; name: string; color: string; position: number; manage?: boolean; icon_url?: string | null; permissions?: number }

export const ROLE_COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#00b0f4', '#99aab5']

export async function fetchRoles(serverId: string): Promise<ServerRole[]> {
  const { data } = await supabase.from('server_roles').select('*').eq('server_id', serverId).order('position').order('created_at')
  return (data ?? []) as ServerRole[]
}

export async function createRole(serverId: string, name: string, color: string) {
  return supabase.from('server_roles').insert({ server_id: serverId, name, color })
}

// v1.260.0: во всех апдейтах ниже добавлен .select('id') + синтетическая ошибка
// на 0 задетых строк — RLS без своей ошибки блокирует чужую/устаревшую роль молча
// (data: [], error: null), и вызывающий код (RoleEditor.tsx) до этого репортил
// «Роль переименована»/reload без ошибки, хотя в базе ничего не менялось.
async function updateOne(table: string, id: string, patch: Record<string, any>) {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select('id')
  if (!error && (!data || data.length === 0)) return { error: { message: 'Не сохранилось — нет прав на изменение' } as any }
  return { error }
}

// Обновить роль (имя / цвет / значок / право «Управление сервером»).
export async function updateRole(id: string, patch: { name?: string; color?: string; manage?: boolean; icon_url?: string | null }) {
  return updateOne('server_roles', id, patch)
}

export async function deleteRole(id: string) {
  return supabase.from('server_roles').delete().eq('id', id)
}

// Старое одиночное назначение (до миграции 25) — оставлено как фолбэк.
export async function assignRole(serverId: string, userId: string, roleId: string | null) {
  const { data, error } = await supabase.from('server_members').update({ role_id: roleId }).eq('server_id', serverId).eq('user_id', userId).select('user_id')
  if (!error && (!data || data.length === 0)) return { error: { message: 'Не сохранилось — нет прав на изменение роли участника' } as any }
  return { error }
}

// Битовая маска прав роли (миграция 34_permissions.sql, см. src/lib/permissions.ts).
export async function setRolePermissions(id: string, permissions: number) {
  return updateOne('server_roles', id, { permissions })
}

// Сохранить иерархию: позиции 0..n-1 в порядке массива (0 — самая высокая роль).
export async function saveRoleOrder(roles: ServerRole[]) {
  for (let i = 0; i < roles.length; i++) {
    const { error } = await updateOne('server_roles', roles[i].id, { position: i })
    if (error) return { error }
  }
  return { error: null }
}

// v1.96.0: все роли всех участников сервера — карта user_id -> role_id[].
// До миграции 25 (нет таблицы member_roles) возвращает пусто, и интерфейс
// откатывается на старое одиночное поле server_members.role_id.
export async function fetchMemberRoles(serverId: string): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from('member_roles').select('user_id, role_id').eq('server_id', serverId)
  if (error || !data) return {}
  const map: Record<string, string[]> = {}
  for (const r of data as any[]) (map[r.user_id] ??= []).push(r.role_id)
  return map
}

// Выдать (on=true) или снять (on=false) роль участнику. Ролей может быть сколько
// угодно. До миграции 25 тихо откатывается на старое одиночное поле role_id.
export async function toggleMemberRole(serverId: string, userId: string, roleId: string, on: boolean) {
  if (on) {
    const { error } = await supabase.from('member_roles').insert({ server_id: serverId, user_id: userId, role_id: roleId })
    if (!error || (error as any).code === '23505' || String(error.message ?? '').includes('duplicate')) return { error: null }
    return assignRole(serverId, userId, roleId)
  }
  const { error } = await supabase.from('member_roles').delete().match({ server_id: serverId, user_id: userId, role_id: roleId })
  if (error) return assignRole(serverId, userId, null)
  // подчищаем старое одиночное поле, если оно указывало на эту же роль
  await supabase.from('server_members').update({ role_id: null }).eq('server_id', serverId).eq('user_id', userId).eq('role_id', roleId)
  return { error: null }
}
