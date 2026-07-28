// SoundCloud support: oEmbed metadata (title / author / artwork) and the
// Widget API (hidden iframe) for actual playback of soundcloud.com links —
// a plain <audio> element cannot play a soundcloud.com page URL.
export interface ScMeta { title: string; author: string; art: string | null; play?: string | null }

const META_KEY = 'ponoi_mus_scmeta_v2'

function loadCache(): Record<string, ScMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') } catch { return {} }
}
const cache = loadCache()
function saveCache() { try { localStorage.setItem(META_KEY, JSON.stringify(cache)) } catch {} }

/**
 * Ссылка на SoundCloud (v1.369.0 — переписано).
 *
 * Что было не так. Проверка гоняла регулярку `(^|\.)soundcloud\.com/` по всей
 * строке: перед доменом требовалась точка или начало строки. У обычной ссылки
 * `https://soundcloud.com/автор/трек` перед доменом стоит `//` — ни то, ни
 * другое. То есть самый частый вид ссылки не опознавался вовсе: он проваливался
 * в ветку «прочие источники», сохранялся голым адресом без обложки, без автора
 * и без ссылки воспроизведения. Работали только `www.soundcloud.com` (там точка
 * есть) и короткие `on.soundcloud.com`.
 *
 * Разбираем адрес как адрес, а не как текст: тогда и поддомены на месте, и
 * похожий домен `soundcloud.com.evil.ru` за свой не сойдёт.
 */
export function isSoundcloudUrl(u: string) {
  try {
    const h = new URL(u.trim()).hostname.toLowerCase()
    return h === 'soundcloud.com' || h.endsWith('.soundcloud.com')
  } catch { return false }
}

/** Чистим SC-ссылку: убираем query/hash (utm, si и прочий трекинг ломают виджет). */
export function cleanScUrl(u: string): string {
  let s = u.trim()
  try {
    const url = new URL(s)
    const h = url.hostname.toLowerCase()
    if (h === 'soundcloud.com' || h.endsWith('.soundcloud.com')) {
      url.search = ''
      url.hash = ''
      s = url.toString().replace(/\/$/, '')
    }
  } catch {}
  return s
}

/** Разбор ответа oEmbed (прямого или через noembed) в ScMeta. */
function parseOembed(j: any): ScMeta | null {
  if (!j || j.error || !(j.title || j.thumbnail_url)) return null
  let title = String(j.title || '')
  const author = String(j.author_name || '')
  if (author && title.endsWith(' by ' + author)) title = title.slice(0, title.length - (' by ' + author).length)
  // Каноничный URL трека для виджета — достаём из oEmbed html (api.soundcloud.com/tracks/…).
  // Критично для коротких ссылок on.soundcloud.com: oEmbed их резолвит, а сам виджет — нет.
  let play: string | null = null
  try {
    const m = String(j.html || '').match(/src="([^"]+)"/)
    if (m) play = new URL(m[1].replace(/&amp;/g, '&')).searchParams.get('url')
  } catch {}
  return { title: title || 'Трек', author, art: j.thumbnail_url ? String(j.thumbnail_url) : null, play }
}

/** Track metadata via SoundCloud oEmbed (no API key needed). Cached in localStorage.
 *  v1.79.0: если прямой oEmbed молчит (блокировщик рекламы / SoundCloud заблокирован
 *  в сети) — пробуем noembed.com: он ходит к SoundCloud со своего сервера. */
export async function scMeta(url: string): Promise<ScMeta | null> {
  if (cache[url]) return cache[url]
  let meta: ScMeta | null = null
  try {
    const r = await fetch('https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(url))
    if (r.ok) meta = parseOembed(await r.json())
  } catch {}
  if (!meta) {
    try {
      const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url))
      if (r.ok) meta = parseOembed(await r.json())
    } catch {}
  }
  if (meta) { cache[url] = meta; saveCache() }
  return meta
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
    '&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false'
}

// ---- Импорт трека/плейлиста: скрытый одноразовый виджет -> полный список треков ----
export interface ScTrack { url: string; title: string; author: string; art: string | null; dur: number; play: string | null }

function scArt(u: any): string | null {
  const s = u ? String(u) : ''
  return s ? s.replace('-large', '-t500x500') : null
}

/**
 * Разворачивает SC-ссылку (одиночный трек ИЛИ плейлист/сет) в список треков с
 * метаданными: название, автор, обложка, длительность, прямой play-URL
 * (api.soundcloud.com/tracks/…). Работает через невидимый одноразовый виджет:
 * READY -> getSounds(); ленивые элементы плейлиста добираем skip(i) + getCurrentSound.
 */
// Сколько ждём один ленивый элемент плейлиста: 60 попыток по 200 мс = 12 секунд.
// v1.370.0: было 8, и на длинном плейлисте с медленной сетью треки терялись.
const LAZY_TRIES = 60

/** Номера треков, которые SoundCloud не отдал при последнем разборе. */
let lastSkipped: number[] = []
export function lastImportSkipped(): number[] { return lastSkipped }

export async function scResolveTracks(url: string, onProgress?: (done: number, total: number) => void): Promise<ScTrack[]> {
  lastSkipped = []
  let target = url
  if (/^https?:\/\/on\.soundcloud\.com\//i.test(url)) {
    // Короткие ссылки виджет сам не резолвит — берём каноничный URL из oEmbed.
    const m = await scMeta(url)
    if (m?.play) target = m.play
  }
  const SC = await loadWidgetApi()
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;border:0'
  frame.allow = 'autoplay'
  frame.src = widgetSrc(target)
  document.body.appendChild(frame)
  const w = SC.Widget(frame)
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('SoundCloud не отвечает — проверь ссылку или блокировщик рекламы')), 20000)
      w.bind(SC.Widget.Events.READY, () => { clearTimeout(t); res() })
      w.bind(SC.Widget.Events.ERROR, () => { clearTimeout(t); rej(new Error('SoundCloud: ссылка не читается')) })
    })
    try { w.setVolume(0) } catch {}
    const sounds: any[] = await new Promise(res => w.getSounds((s: any[]) => res(Array.isArray(s) ? s : [])))
    const total = Math.max(sounds.length, 1)
    const out: ScTrack[] = []
    // v1.370.0: сколько треков плейлиста не отдалось. Раньше такие просто
    // пропускались молча, и человек получал «добавлено 47» вместо 52, не зная,
    // что пятерых не хватает и каких.
    const skipped: number[] = []
    const toTrack = (s: any): ScTrack => ({
      url: String(s.permalink_url || url),
      title: String(s.title || 'Трек'),
      author: String(s.user?.username || ''),
      art: scArt(s.artwork_url || s.user?.avatar_url),
      dur: s.duration > 0 ? Math.round(s.duration / 1000) : 0,
      play: s.id ? 'https://api.soundcloud.com/tracks/' + s.id : null,
    })
    for (let i = 0; i < total; i++) {
      let s: any = sounds[i]
      if (!s || !s.title) {
        // Ленивый элемент плейлиста: перескакиваем на него и ждём загрузки данных.
        try { w.skip(i) } catch {}
        try { w.pause() } catch {}
        s = await new Promise<any>(res => {
          let tries = 0
          const iv = setInterval(() => {
            w.getCurrentSoundIndex((ci: number) => {
              if (ci !== i) { if (++tries > LAZY_TRIES) { clearInterval(iv); res(null) }; return }
              w.getCurrentSound((cs: any) => {
                if (cs && cs.title) { clearInterval(iv); try { w.pause() } catch {}; res(cs) }
                else if (++tries > LAZY_TRIES) { clearInterval(iv); res(null) }
              })
            })
          }, 200)
        })
      }
      if (s && s.title) out.push(toTrack(s))
      else skipped.push(i + 1)
      onProgress?.(i + 1, total)
    }
    try { w.pause() } catch {}
    lastSkipped = skipped
    return out
  } finally { try { frame.remove() } catch {} }
}
