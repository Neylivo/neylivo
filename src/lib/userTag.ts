// v1.178.0: «Взять тег сервера» — какой сервер сейчас представляет пользователь
// рядом с ником (profiles.tag_server_id), и сам тег этого сервера (servers.settings.tag).
// Кэш общий на сессию: тег меняется редко, а рендерится рядом с каждым сообщением/строкой участника.
import { supabase } from './supabase'
import type { ServerTag } from '../components/TagEmoji'

export interface ResolvedTag extends ServerTag { serverId: string; serverName: string }

const profileTagCache = new Map<string, string | null>()          // userId -> tag_server_id
const serverTagCache = new Map<string, { name: string; tag: ServerTag } | null>()  // serverId -> {name, tag}
const listeners = new Set<() => void>()

export function onTagChange(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }

// Своя карточка изменила тег — сбросить кэш и перерисовать все бейджи с ним.
export function invalidateUserTag(userId: string) {
  profileTagCache.delete(userId)
  listeners.forEach(l => l())
}
// Сервер обновил свой тег в настройках — сбросить кэш этого сервера для всех, кто его носит.
export function invalidateServerTag(serverId: string) {
  serverTagCache.delete(serverId)
  listeners.forEach(l => l())
}

export async function resolveUserTag(userId: string): Promise<ResolvedTag | null> {
  let serverId: string | null
  if (profileTagCache.has(userId)) {
    serverId = profileTagCache.get(userId)!
  } else {
    try {
      const { data, error } = await supabase.from('profiles').select('tag_server_id').eq('id', userId).maybeSingle()
      serverId = error ? null : ((data as any)?.tag_server_id ?? null)
    } catch { serverId = null }
    profileTagCache.set(userId, serverId)
  }
  if (!serverId) return null
  let srv: { name: string; tag: ServerTag } | null
  if (serverTagCache.has(serverId)) {
    srv = serverTagCache.get(serverId)!
  } else {
    try {
      const { data } = await supabase.from('servers').select('name, settings').eq('id', serverId).maybeSingle()
      srv = data ? { name: (data as any).name, tag: (data as any).settings?.tag ?? {} } : null
    } catch { srv = null }
    serverTagCache.set(serverId, srv)
  }
  if (!srv || !srv.tag?.name) return null
  return { ...srv.tag, serverId, serverName: srv.name }
}
