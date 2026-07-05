// Emoji list for the picker + SHARED custom-emoji store (:name: -> image url).
// Custom emoji live in the Supabase `custom_emoji` table so they are visible to
// everyone on any device. A synchronous in-memory cache backs loadCustom() so the
// message renderer stays synchronous; localStorage mirrors it for offline/first paint.
// v1.88.0: избранные эмодзи (emoji_favs) и паки (emoji_packs / emoji_pack_items).
import { supabase } from './supabase'

export const EMOJI_GROUPS: { title: string; emojis: string[] }[] = [
  { title: 'Часто используемые', emojis: ['😂','❤️','👍','🔥','😭','🥺','😍','🎉','💀','✨','🙏','👀'] },
  { title: 'Смайлы', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😊','🙂','😉','😌','😍','🥰','😘','😗','😜','🤪','😝','🤗','🤔','🤨','😐','😶','🙄','😏','😴','🤤','😪','😷','🤒','🤕','🤢','🤮','🥶','🥵','😎','🤓','🧐'] },
  { title: 'Жесты', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤙','👏','🙌','👐','🤝','🙏','💪','👀','🫶','🤲'] },
  { title: 'Сердца', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
  { title: 'Разное', emojis: ['🔥','✨','🎉','🎊','⭐','🌟','💥','💫','🎵','🎶','💯','✅','❌','⚡','🌈','🍕','🍺','☕','🎮','⚽'] },
]

const CUSTOM_KEY = 'ponoi_custom_emoji_v1'   // local mirror (offline / first paint)
const FAVS_KEY = 'ponoi_emoji_favs_v1'
export type CustomEmoji = Record<string, string> // name -> url
export type EmojiPack = { id: string; name: string; owner: string | null; items: string[] }

// in-memory caches — kept in sync with the DB; seeded from local mirrors
let cache: CustomEmoji = readMirror()
let owners: Record<string, string | null> = {}
let favs = new Set<string>(readFavsMirror())
let packs: EmojiPack[] = []
let started = false

function readMirror(): CustomEmoji {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') } catch { return {} }
}
function writeMirror(map: CustomEmoji) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(map)) } catch {}
}
function readFavsMirror(): string[] {
  try { return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]') } catch { return [] }
}
function writeFavsMirror() {
  try { localStorage.setItem(FAVS_KEY, JSON.stringify(Array.from(favs))) } catch {}
}

// Synchronous reads used by the message renderer + picker.
export function loadCustom(): CustomEmoji { return cache }
export function emojiOwner(name: string): string | null { return owners[name] ?? null }
export function loadFavs(): Set<string> { return favs }
export function loadPacks(): EmojiPack[] { return packs }

// v1.88.0: кириллица в названии эмодзи транслитерируется, а не выбрасывается —
// раньше «имя по-русски» молча превращалось в пустую строку и создание «не работало».
const TR: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
}
export function cleanEmojiName(raw: string): string {
  const low = raw.trim().toLowerCase()
  let out = ''
  for (const ch of low) out += (ch in TR ? TR[ch] : ch)
  return out.replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

// Pull the shared table into the cache and notify listeners.
export async function fetchCustomEmoji(): Promise<CustomEmoji> {
  const { data } = await supabase.from('custom_emoji').select('name, url, owner')
  const map: CustomEmoji = {}
  const own: Record<string, string | null> = {}
  for (const r of ((data ?? []) as any[])) { map[r.name] = r.url; own[r.name] = r.owner ?? null }
  cache = map
  owners = own
  writeMirror(map)
  window.dispatchEvent(new CustomEvent('ponoi-custom-emoji'))
  return map
}

export async function fetchFavs(uid: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('emoji_favs').select('name').eq('user_id', uid)
  if (!error) {
    favs = new Set(((data ?? []) as any[]).map(r => r.name))
    writeFavsMirror()
    window.dispatchEvent(new CustomEvent('ponoi-emoji-favs'))
  }
  return favs
}

export async function toggleFav(uid: string, name: string): Promise<boolean> {
  const had = favs.has(name)
  if (had) {
    favs.delete(name)
    await supabase.from('emoji_favs').delete().eq('user_id', uid).eq('name', name)
  } else {
    favs.add(name)
    await supabase.from('emoji_favs').upsert({ user_id: uid, name })
  }
  writeFavsMirror()
  window.dispatchEvent(new CustomEvent('ponoi-emoji-favs'))
  return !had
}

// Добавить сразу несколько эмодзи в избранное (напр. целый пак).
export async function addFavs(uid: string, names: string[]): Promise<void> {
  if (!names.length) return
  for (const n of names) favs.add(n)
  await supabase.from('emoji_favs').upsert(names.map(n => ({ user_id: uid, name: n })))
  writeFavsMirror()
  window.dispatchEvent(new CustomEvent('ponoi-emoji-favs'))
}

export async function fetchPacks(): Promise<EmojiPack[]> {
  const [ps, items] = await Promise.all([
    supabase.from('emoji_packs').select('id, name, owner, created_at').order('created_at'),
    supabase.from('emoji_pack_items').select('pack_id, name'),
  ])
  if (ps.error || items.error) return packs
  const by: Record<string, string[]> = {}
  for (const r of ((items.data ?? []) as any[])) { (by[r.pack_id] = by[r.pack_id] ?? []).push(r.name) }
  packs = ((ps.data ?? []) as any[]).map(p => ({ id: p.id, name: p.name, owner: p.owner ?? null, items: by[p.id] ?? [] }))
  window.dispatchEvent(new CustomEvent('ponoi-emoji-packs'))
  return packs
}

export async function createPack(owner: string, name: string, names: string[]): Promise<void> {
  const nm = name.trim()
  if (!nm) throw new Error('Название пака пустое')
  if (!names.length) throw new Error('Выбери хотя бы один эмодзи для пака')
  const { data, error } = await supabase.from('emoji_packs').insert({ name: nm, owner }).select().single()
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать пак (применена ли миграция 23?)')
  const { error: e2 } = await supabase.from('emoji_pack_items').insert(names.map(n => ({ pack_id: (data as any).id, name: n })))
  if (e2) throw new Error(e2.message)
  await fetchPacks()
}

export async function deletePack(id: string): Promise<EmojiPack[]> {
  await supabase.from('emoji_packs').delete().eq('id', id)
  return fetchPacks()
}

// Load once + subscribe to realtime so everyone sees new emoji/packs live. Idempotent.
export function initCustomEmoji(uid?: string) {
  if (started) { if (uid) fetchFavs(uid); return }
  started = true
  fetchCustomEmoji()
  fetchPacks()
  if (uid) fetchFavs(uid)
  supabase.channel('custom_emoji_live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_emoji' }, () => { fetchCustomEmoji() })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'emoji_packs' }, () => { fetchPacks() })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'emoji_pack_items' }, () => { fetchPacks() })
    .subscribe()
}

export async function addCustom(name: string, url: string, ownerId: string): Promise<CustomEmoji> {
  const clean = cleanEmojiName(name)
  if (!clean) throw new Error('Название должно содержать буквы или цифры')
  if (!url.trim()) throw new Error('Нет картинки для эмодзи')
  if (cache[clean] && owners[clean] && owners[clean] !== ownerId) {
    throw new Error('Имя :' + clean + ': уже занято другим пользователем')
  }
  const { error } = await supabase.from('custom_emoji').upsert({ name: clean, url: url.trim(), owner: ownerId })
  if (error) throw new Error('Не удалось создать эмодзи: ' + error.message)
  return fetchCustomEmoji()
}

export async function removeCustom(name: string): Promise<CustomEmoji> {
  await supabase.from('custom_emoji').delete().eq('name', name)
  return fetchCustomEmoji()
}
