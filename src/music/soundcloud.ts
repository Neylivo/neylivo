// SoundCloud support: oEmbed metadata (title / author / artwork) and the
// Widget API (hidden iframe) for actual playback of soundcloud.com links —
// a plain <audio> element cannot play a soundcloud.com page URL.
export interface ScMeta { title: string; author: string; art: string | null }

const META_KEY = 'ponoi_mus_scmeta_v1'

function loadCache(): Record<string, ScMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') } catch { return {} }
}
const cache = loadCache()
function saveCache() { try { localStorage.setItem(META_KEY, JSON.stringify(cache)) } catch {} }

export function isSoundcloudUrl(u: string) {
  return /(^|\.)soundcloud\.com\//i.test(u) || /^https?:\/\/on\.soundcloud\.com\//i.test(u)
}

/** Track metadata via SoundCloud oEmbed (no API key needed). Cached in localStorage. */
export async function scMeta(url: string): Promise<ScMeta | null> {
  if (cache[url]) return cache[url]
  try {
    const r = await fetch('https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(url))
    if (!r.ok) return null
    const j = await r.json()
    let title = String(j.title || '')
    const author = String(j.author_name || '')
    if (author && title.endsWith(' by ' + author)) title = title.slice(0, title.length - (' by ' + author).length)
    const meta: ScMeta = {
      title: title || 'Трек',
      author,
      art: j.thumbnail_url ? String(j.thumbnail_url) : null,
    }
    cache[url] = meta; saveCache()
    return meta
  } catch { return null }
}

// ---- Widget API (w.soundcloud.com/player/api.js) ----
declare global { interface Window { SC?: any } }
let apiPromise: Promise<any> | null = null

export function loadWidgetApi(): Promise<any> {
  if (window.SC?.Widget) return Promise.resolve(window.SC)
  if (!apiPromise) {
    apiPromise = new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = 'https://w.soundcloud.com/player/api.js'
      s.onload = () => res(window.SC)
      s.onerror = () => { apiPromise = null; rej(new Error('Не удалось загрузить SoundCloud API')) }
      document.head.appendChild(s)
    })
  }
  return apiPromise
}

export function widgetSrc(url: string) {
  return 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) +
    '&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=false'
}
