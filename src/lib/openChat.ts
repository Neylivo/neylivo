import { supabase } from './supabase'

// v1.409.0: что открыто на экране прямо сейчас, и что это за канал.
//
// Нужно уведомлениям. Общий слушатель (globalNotify) видит все сообщения, до
// которых человеку есть дело, но про открытый чат звенеть не должен: человек и
// так на него смотрит. А чтобы написать в уведомлении «— #общий», нужно имя
// канала — причём любого, не только открытого, потому что писать могут куда
// угодно.
//
// Держим это отдельным крошечным модулем, а не в состоянии компонентов:
// уведомления живут выше их всех и не должны зависеть от того, смонтирован ли
// сейчас список каналов.

let openDm: string | null = null
let openChannel: string | null = null

export function setOpenDmThread(id: string | null) { openDm = id }
export function setOpenChannel(id: string | null) { openChannel = id }
export function getOpenDmThread(): string | null { return openDm }
export function getOpenChannel(): string | null { return openChannel }

export interface ChannelInfo { channel: string; server: string; serverId: string }

// Канал спрашиваем у базы один раз и запоминаем: сообщений много, каналов мало.
const cache = new Map<string, ChannelInfo | null>()
const pending = new Map<string, Promise<ChannelInfo | null>>()

export async function channelInfo(channelId: string): Promise<ChannelInfo | null> {
  if (cache.has(channelId)) return cache.get(channelId) ?? null
  const running = pending.get(channelId)
  if (running) return running
  const p = (async () => {
    const { data } = await supabase.from('channels').select('name, server_id').eq('id', channelId).maybeSingle()
    if (!data) { cache.set(channelId, null); return null }
    const { data: srv } = await supabase.from('servers').select('name').eq('id', (data as any).server_id).maybeSingle()
    const info: ChannelInfo = {
      channel: (data as any).name ?? '',
      server: (srv as any)?.name ?? '',
      serverId: (data as any).server_id,
    }
    cache.set(channelId, info)
    return info
  })()
  pending.set(channelId, p)
  try { return await p } finally { pending.delete(channelId) }
}
