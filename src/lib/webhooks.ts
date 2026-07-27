import { supabase } from './supabase'

// v1.319.0: вебхуки каналов — адрес, на который стороннее приложение шлёт обычный
// POST, и сообщение появляется в канале от заданного имени. То же, что вебхуки
// Discord.
//
// Токен показывается ОДИН раз при создании: в базе лежит только его отпечаток.
// Поэтому здесь он и генерируется — на устройстве, а не на сервере: так сырой
// токен вообще нигде не появляется, кроме экрана того, кто вебхук завёл.

export interface Webhook {
  id: string
  channel_id: string
  name: string
  created_at: string
  last_used_at: string | null
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

export function webhookUrl(id: string, token: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
  return `${base}/functions/v1/webhook/${id}/${token}`
}

export async function listWebhooks(channelId: string): Promise<Webhook[]> {
  const { data, error } = await supabase.from('webhooks')
    .select('id, channel_id, name, created_at, last_used_at')
    .eq('channel_id', channelId).order('created_at')
  if (error) throw new Error(webhookErr(error.message))
  return (data ?? []) as Webhook[]
}

/** Создать вебхук. Возвращает готовый адрес — он больше нигде не восстановим. */
export async function createWebhook(serverId: string, channelId: string, name: string): Promise<{ id: string; url: string }> {
  const { data: me } = await supabase.auth.getUser()
  const uid = me.user?.id
  if (!uid) throw new Error('Нужно войти в аккаунт')
  const token = randomToken()
  const { data, error } = await supabase.from('webhooks').insert({
    channel_id: channelId, server_id: serverId,
    name: name.trim() || 'Вебхук',
    token_hash: await sha256(token),
    created_by: uid,
  }).select('id').single()
  if (error) throw new Error(webhookErr(error.message))
  return { id: data.id as string, url: webhookUrl(data.id as string, token) }
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await supabase.from('webhooks').delete().eq('id', id)
  if (error) throw new Error(webhookErr(error.message))
}

function webhookErr(msg: string): string {
  if (/webhooks|does not exist/i.test(msg)) {
    return 'Вебхуки пока не включены — примени миграцию supabase/80_webhooks.sql'
  }
  if (/row-level security|permission denied/i.test(msg)) {
    return 'Нет прав на управление вебхуками этого сервера'
  }
  return msg
}
