// Emoji list for the picker + SHARED custom-emoji store (:name: -> image url).
// Custom emoji live in the Supabase `custom_emoji` table so they are visible to
// everyone on any device. A synchronous in-memory cache backs loadCustom() so the
// message renderer stays synchronous; localStorage mirrors it for offline/first paint.
import { supabase } from './supabase'

export const EMOJI_GROUPS: { title: string; emojis: string[] }[] = [
  { title: 'Часто используемые', emojis: ['😂','❤️','👍','🔥','😭','🥺','😍','🎉','💀','✨','🙏','👀'] },
  { title: 'Смайлы', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😊','🙂','😉','😌','😍','🥰','😘','😗','😜','🤪','😝','🤗','🤔','🤨','😐','😶','🙄','😏','😴','🤤','😪','😷','🤒','🤕','🤢','🤮','🥶','🥵','😎','🤓','🧐'] },
  { title: 'Жесты', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤙','👏','🙌','👐','🤝','🙏','💪','👀','🫶','🤲'] },
  { title: 'Сердца', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
  { title: 'Разное', emojis: ['🔥','✨','🎉','🎊','⭐','🌟','💥','💫','🎵','🎶','💯','✅','❌','⚡','🌈','🍕','🍺','☕','🎮','⚽'] },
]

const CUSTOM_KEY = 'ponoi_custom_emoji_v1'   // local mirror (offline / first paint)
export type CustomEmoji = Record<string, string> // name -> url

// in-memory cache — kept in sync with the DB; seeded from the local mirror
let cache: CustomEmoji = readMirror()
let started = false

function readMirror(): CustomEmoji {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') } catch { return {} }
}
function writeMirror(map: CustomEmoji) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(map)) } catch {}
}

// Synchronous read used by the message renderer + picker.
export function loadCustom(): CustomEmoji { return cache }

// Pull the shared table into the cache and notify listeners.
export async function fetchCustomEmoji(): Promise<CustomEmoji> {
  const { data } = await supabase.from('custom_emoji').select('name, url')
  const map: CustomEmoji = {}
  for (const r of ((data ?? []) as any[])) map[r.name] = r.url
  cache = map
  writeMirror(map)
  window.dispatchEvent(new CustomEvent('ponoi-custom-emoji'))
  return map
}

// Load once + subscribe to realtime so everyone sees new emoji live. Idempotent.
export function initCustomEmoji() {
  if (started) return
  started = true
  fetchCustomEmoji()
  supabase.channel('custom_emoji_live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_emoji' }, () => { fetchCustomEmoji() })
    .subscribe()
}

export async function addCustom(name: string, url: string, ownerId: string): Promise<CustomEmoji> {
  const clean = name.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()
  if (!clean || !url.trim()) return cache
  await supabase.from('custom_emoji').upsert({ name: clean, url: url.trim(), owner: ownerId })
  return fetchCustomEmoji()
}

export async function removeCustom(name: string): Promise<CustomEmoji> {
  await supabase.from('custom_emoji').delete().eq('name', name)
  return fetchCustomEmoji()
}