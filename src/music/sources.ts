// Музыка по ссылке: YouTube и Audius (плюс прямые аудио-файлы играют через <audio>).
// YouTube: id из ссылки + oEmbed-метаданные + IFrame Player API (без ключей).
// Audius: /v1/resolve превращает ссылку на страницу трека в прямой stream-URL.
import type { ScMeta } from './soundcloud'

const META_KEY = 'ponoi_mus_srcmeta_v1'
function loadCache(): Record<string, ScMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') } catch { return {} }
}
const cache = loadCache()
function saveCache() { try { localStorage.setItem(META_KEY, JSON.stringify(cache)) } catch {} }

// ---------- YouTube ----------
export function parseYouTubeId(u: string): string | null {
  try {
    const url = new URL(u.trim())
    const h = url.hostname.replace(/^(www|m)\./i, '')
    if (h === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null
    if (h === 'youtube.com' || h === 'music.youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v')
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)
      if (m) return m[1]
    }
  } catch {}
  return null
}
export function isYouTubeUrl(u: string) { return parseYouTubeId(u) !== null }

const ANY_URL_RE = /https?:\/\/[^\s<>]+[^\s<>.,)!?;:'"]/g

/** Первая ссылка на видео YouTube в тексте сообщения (для карточки-превью в чате). */
export function findYouTubeLink(text?: string | null): string | null {
  if (!text) return null
  const matches = text.match(ANY_URL_RE)
  return matches?.find(isYouTubeUrl) ?? null
}

/** Название/автор/обложка через YouTube oEmbed (без API-ключа). */
export async function ytMeta(url: string): Promise<ScMeta | null> {
  if (cache[url]) return cache[url]
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url))
    if (!r.ok) return null
    const j = await r.json()
    const meta: ScMeta = {
      title: String(j.title || 'Видео'),
      author: String(j.author_name || ''),
      art: j.thumbnail_url ? String(j.thumbnail_url) : null,
      play: parseYouTubeId(url),
    }
    cache[url] = meta; saveCache()
    return meta
  } catch { return null }
}

declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: (() => void) | undefined } }
let ytApiPromise: Promise<any> | null = null

/** IFrame Player API — управление скрытым YouTube-плеером (play/pause/seek/volume). */
export function loadYtApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!ytApiPromise) {
    ytApiPromise = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { try { prev?.() } catch {} res(window.YT) }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.onerror = () => { ytApiPromise = null; rej(new Error('Не удалось загрузить YouTube API')) }
      document.head.appendChild(s)
    })
  }
  return ytApiPromise
}

// ---------- Audius ----------
export function isAudiusUrl(u: string) { return /(^|\/\/)(www\.)?audius\.co\//i.test(u) }

/** Ссылка на страницу трека Audius -> метаданные + прямой stream-URL (играет в <audio>). */
export async function audiusMeta(url: string): Promise<ScMeta | null> {
  if (cache[url]) return cache[url]
  try {
    const r = await fetch('https://api.audius.co/v1/resolve?url=' + encodeURIComponent(url) + '&app_name=ponoi')
    if (!r.ok) return null
    const j = await r.json()
    const d = j?.data
    if (!d || !d.id) return null
    const meta: ScMeta = {
      title: String(d.title || 'Трек'),
      author: String(d.user?.name || d.user?.handle || 'Audius'),
      art: (d.artwork && (d.artwork['480x480'] || d.artwork['150x150'])) || null,
      play: 'https://api.audius.co/v1/tracks/' + d.id + '/stream?app_name=ponoi',
    }
    cache[url] = meta; saveCache()
    return meta
  } catch { return null }
}
