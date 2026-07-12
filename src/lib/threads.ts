// v1.268.0: ветки (Threads) — см. supabase/70_threads.sql. Сообщения веток живут
// в обычной таблице messages (thread_id вместо null) — свои закреп/реакции/правка
// не нужны, работают те же функции, что и у обычных сообщений (reactions.ts).
import { supabase } from './supabase'

export interface Thread {
  id: string
  channel_id: string
  server_id: string
  name: string
  created_by: string
  created_by_name: string
  origin_message_id: string | null
  archived: boolean
  created_at: string
}

export async function fetchThreads(channelId: string): Promise<Thread[]> {
  const { data, error } = await supabase.from('threads').select('*')
    .eq('channel_id', channelId).order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []) as Thread[]
}

export async function createThread(
  channelId: string, serverId: string, name: string, createdBy: string, createdByName: string, originMessageId?: string | null,
): Promise<Thread> {
  const { data, error } = await supabase.from('threads')
    .insert({ channel_id: channelId, server_id: serverId, name: name.trim().slice(0, 100), created_by: createdBy, created_by_name: createdByName, origin_message_id: originMessageId ?? null })
    .select().single()
  if (error) throw new Error(error.message)
  return data as Thread
}

export async function archiveThread(id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from('threads').update({ archived }).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Не удалось изменить ветку — нет прав')
}
