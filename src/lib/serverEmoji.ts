// v1.250.0: эмодзи и стикеры СЕРВЕРА — как в Discord: у сервера свой пак,
// доступный автоматически всем участникам (просто live-запрос «эмодзи серверов,
// где я состою», см. server_emoji/stickers RLS в supabase/61_server_emoji_stickers.sql —
// никакого отдельного шага «выдать доступ» при вступлении не нужно).
//
// Отдельно от src/lib/emoji.ts (личная ГЛОБАЛЬНАЯ по имени коллекция custom_emoji) —
// имена здесь уникальны только within один сервер, поэтому не может быть конфликта
// с личными эмодзи. Для рендера :имя: в тексте сообщений (md.tsx) серверные эмодзи
// подмешиваются в тот же кэш через emoji.ts::mergeIntoCache().
import { supabase } from './supabase'
import { cleanEmojiName, mergeIntoCache } from './emoji'

export interface ServerEmoji { id: string; server_id: string; name: string; url: string }
export interface ServerSticker { id: string; server_id: string; name: string; url: string }

let emojiList: ServerEmoji[] = []
let stickerList: ServerSticker[] = []
let myServerIds: string[] = []
let myServerNames: Record<string, string> = {}
let started = false
let chan: ReturnType<typeof supabase.channel> | null = null

export function loadServerEmoji(): ServerEmoji[] { return emojiList }
export function loadStickers(): ServerSticker[] { return stickerList }
export function serverNameOf(id: string): string { return myServerNames[id] ?? '?' }

async function refreshEmoji() {
  if (!myServerIds.length) { emojiList = []; mergeIntoCache({}); window.dispatchEvent(new CustomEvent('ponoi-server-emoji')); return }
  const { data } = await supabase.from('server_emoji').select('id, server_id, name, url').in('server_id', myServerIds)
  emojiList = (data ?? []) as ServerEmoji[]
  const map: Record<string, string> = {}
  for (const e of emojiList) map[e.name] = e.url
  mergeIntoCache(map)
  window.dispatchEvent(new CustomEvent('ponoi-server-emoji'))
}
async function refreshStickers() {
  if (!myServerIds.length) { stickerList = []; window.dispatchEvent(new CustomEvent('ponoi-stickers')); return }
  const { data } = await supabase.from('stickers').select('id, server_id, name, url').in('server_id', myServerIds)
  stickerList = (data ?? []) as ServerSticker[]
  window.dispatchEvent(new CustomEvent('ponoi-stickers'))
}

// Список серверов пользователя меняется (вступил/вышел/загрузился) — держим
// в актуальном состоянии извне (Home.tsx уже знает список servers). Имена —
// чтобы пикер эмодзи мог подписать группы «Эмодзи сервера X», не делая для
// этого свой отдельный запрос к servers.
export function setMyServers(servers: { id: string; name: string }[]) {
  const ids = servers.map(s => s.id)
  myServerNames = Object.fromEntries(servers.map(s => [s.id, s.name]))
  const same = ids.length === myServerIds.length && ids.every(id => myServerIds.includes(id))
  if (same) return
  myServerIds = ids
  refreshEmoji()
  refreshStickers()
}

export function initServerEmoji() {
  if (started) return
  started = true
  chan = supabase.channel('server_emoji_live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'server_emoji' }, () => refreshEmoji())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stickers' }, () => refreshStickers())
    .subscribe()
}
export function stopServerEmoji() {
  if (chan) { supabase.removeChannel(chan); chan = null }
  started = false
}

export async function addServerEmoji(serverId: string, name: string, url: string, uid: string): Promise<void> {
  const clean = cleanEmojiName(name)
  if (!clean) throw new Error('Название должно содержать буквы или цифры')
  if (!url.trim()) throw new Error('Нет картинки для эмодзи')
  const { error } = await supabase.from('server_emoji').insert({ server_id: serverId, name: clean, url: url.trim(), created_by: uid })
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Эмодзи с именем :' + clean + ': уже есть на этом сервере' : error.message)
  await refreshEmoji()
}
export async function removeServerEmoji(id: string): Promise<void> {
  const { data, error } = await supabase.from('server_emoji').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Не удалось удалить — нет прав на управление эмодзи')
  await refreshEmoji()
}

export async function addSticker(serverId: string, name: string, url: string, uid: string): Promise<void> {
  const nm = name.trim()
  if (!nm) throw new Error('Название пустое')
  if (!url.trim()) throw new Error('Нет картинки для стикера')
  const { error } = await supabase.from('stickers').insert({ server_id: serverId, name: nm, url: url.trim(), created_by: uid })
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Стикер с именем «' + nm + '» уже есть на этом сервере' : error.message)
  await refreshStickers()
}
export async function removeSticker(id: string): Promise<void> {
  const { data, error } = await supabase.from('stickers').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Не удалось удалить — нет прав на управление стикерами')
  await refreshStickers()
}
