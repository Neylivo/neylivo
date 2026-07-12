// v1.267.0: журнал аудита сервера (миграция supabase/68_audit_log.sql) — модерация
// (кик/бан/разбан/тайм-аут) пишется прямо в security-definer RPC-функциях
// (kick_member и т.д., уже проверивших права), структурные правки (каналы/роли) —
// отсюда, с клиента, после успешного действия.
import { supabase } from './supabase'

export interface AuditEntry {
  id: string
  server_id: string
  actor_id: string
  actor_name: string
  action: string
  target_name: string | null
  detail: string | null
  created_at: string
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  kick: 'Исключение участника',
  ban: 'Бан участника',
  unban: 'Снятие бана',
  timeout: 'Тайм-аут участника',
  timeout_clear: 'Снятие тайм-аута',
  channel_create: 'Создание канала',
  channel_delete: 'Удаление канала',
  role_create: 'Создание роли',
  role_delete: 'Удаление роли',
  role_update: 'Изменение роли',
}

export async function fetchAuditLog(serverId: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase.from('audit_log').select('*')
    .eq('server_id', serverId).order('created_at', { ascending: false }).limit(200)
  if (error) return []
  return (data ?? []) as AuditEntry[]
}

// Не проверяем результат жёстко (toastErr) — это второстепенная запись ПОСЛЕ уже
// состоявшегося успешного действия (канал создан/роль удалена и т.п.), терять
// его из-за сбоя логирования не должны ни само действие, ни его пользователь.
export async function logAudit(serverId: string, action: string, targetName: string, detail?: string) {
  try { await supabase.rpc('log_audit', { p_server: serverId, p_action: action, p_target_name: targetName, p_detail: detail ?? null }) }
  catch {}
}
