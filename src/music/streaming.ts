import type { ScMeta } from './soundcloud'

// v1.367.0: ссылки со стриминговых сервисов — Spotify, Apple Music, Deezer,
// Яндекс.Музыка, Bandcamp.
//
// Честно о главном. Полный трек со Spotify сторонним приложением не играется, и
// это не наша недоработка: он отдаётся только через их собственный проигрыватель,
// только владельцу Premium и только после его входа в Spotify. Тридцатисекундные
// отрывки они убрали из своего API в конце 2024 года. То же у Apple Music и
// Яндекса. Обещать «играет полностью» было бы враньём.
//
// Что тогда делаем. Ссылка перестаёт быть мёртвой:
//   1) вытягиваем название, автора и обложку — через oEmbed, без ключей;
//   2) ищем тот же трек там, где его правда можно играть (Audius, открытый
//      каталог с публичным поиском без ключа);
//   3) нашли — играем целиком; не нашли — карточка с обложкой и кнопкой
//      «Открыть в сервисе», а не молчащий проигрыватель.
//
// Так человек получает максимум возможного и точно знает, что происходит.

export type Service = 'spotify' | 'apple' | 'deezer' | 'yandex' | 'bandcamp'

export const SERVICE_NAME: Record<Service, string> = {
  spotify: 'Spotify', apple: 'Apple Music', deezer: 'Deezer',
  yandex: 'Яндекс.Музыка', bandcamp: 'Bandcamp',
}

/** Какой это сервис, если вообще. */
export function serviceOf(u: string): Service | null {
  let host = ''
  try { host = new URL(u.trim()).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
  if (host === 'open.spotify.com' || host === 'spotify.link') return 'spotify'
  if (host === 'music.apple.com') return 'apple'
  if (host === 'deezer.com' || host === 'dzr.page.link' || host.endsWith('.deezer.com')) return 'deezer'
  if (host === 'music.yandex.ru' || host === 'music.yandex.com') return 'yandex'
  if (host.endsWith('.bandcamp.com') || host === 'bandcamp.com') return 'bandcamp'
  return null
}

export const isStreamingUrl = (u: string) => serviceOf(u) !== null

/** Адрес oEmbed сервиса. null — у сервиса его нет, обойдёмся именем из ссылки. */
function oembedUrl(svc: Service, url: string): string | null {
  const e = encodeURIComponent(url)
  switch (svc) {
    case 'spotify': return 'https://open.spotify.com/oembed?url=' + e
    case 'deezer': return 'https://api.deezer.com/oembed?url=' + e + '&format=json'
    case 'bandcamp': return 'https://bandcamp.com/api/oembed?format=json&url=' + e
    // У Apple Music и Яндекса открытого oEmbed нет — название берём из ссылки.
    case 'apple': case 'yandex': return null
  }
}

/**
 * Название трека из самой ссылки — запасной путь, когда сервис ничего не отдал.
 *
 * Лучше «Blinding Lights» из адреса, чем «Трек»: человек хотя бы узнает свою
 * запись в списке.
 */
export function titleFromUrl(u: string): string {
  try {
    const parts = new URL(u).pathname.split('/').filter(Boolean)
    // Последний кусок часто идентификатор — берём последний осмысленный.
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = decodeURIComponent(parts[i])
      if (/^[0-9a-z]{16,}$/i.test(p) || /^\d+$/.test(p)) continue
      const t = p.replace(/[-_]+/g, ' ').trim()
      if (t.length > 1 && !['track', 'album', 'song', 'artist', 'ru', 'us'].includes(t.toLowerCase())) {
        return t.replace(/\b\w/g, c => c.toUpperCase())
      }
    }
  } catch { /* не разобрали — вернём общее слово ниже */ }
  return 'Трек'
}

/** Из oEmbed-названия вида «Автор — Трек» вытащить автора, если поля author нет. */
export function splitTitleAuthor(title: string, author: string): { title: string; author: string } {
  if (author) return { title, author }
  const m = title.split(/\s+[—–-]\s+/)
  if (m.length >= 2) return { author: m[0].trim(), title: m.slice(1).join(' - ').trim() }
  return { title, author }
}

const CACHE_KEY = 'ponoi_mus_stream_v1'
function loadCache(): Record<string, ScMeta> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} }
}
const cache = loadCache()
function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* переполнено — обойдёмся */ } }

/** Название, автор и обложка по ссылке сервиса. Играть по ней пока нечем. */
export async function streamingMeta(url: string): Promise<ScMeta | null> {
  if (cache[url]) return cache[url]
  const svc = serviceOf(url)
  if (!svc) return null

  let title = '', author = '', art: string | null = null
  const oe = oembedUrl(svc, url)
  if (oe) {
    try {
      const r = await fetch(oe)
      if (r.ok) {
        const j = await r.json()
        title = String(j.title || '')
        author = String(j.author_name || j.artist || '')
        art = j.thumbnail_url ? String(j.thumbnail_url) : null
      }
    } catch { /* сервис не ответил — ниже возьмём имя из ссылки */ }
  }
  if (!title) title = titleFromUrl(url)
  const split = splitTitleAuthor(title, author)

  const meta: ScMeta = {
    title: split.title,
    author: split.author || SERVICE_NAME[svc],
    art,
    play: null,     // играть по этой ссылке нельзя — см. поиск замены ниже
  }
  cache[url] = meta; saveCache()
  return meta
}

/**
 * Поисковый запрос для замены: «автор название», без лишнего.
 *
 * Из названий выкидываем то, что мешает совпасть: «(Official Video)»,
 * «[Remastered 2011]», «feat. …» и прочие хвосты, которых у той же записи в
 * другом каталоге обычно нет.
 */
export function searchQuery(title: string, author: string): string {
  const clean = (s: string) => s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(feat|ft|prod|official|video|audio|lyrics?|remaster(ed)?|hd|4k)\b.*$/i, ' ')
    .replace(/[^\p{L}\p{N}\s'&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const a = clean(author), t = clean(title)
  // Автор уже в названии — не повторяем: «Nirvana Nirvana Lithium» ничего не найдёт.
  if (a && t.toLowerCase().includes(a.toLowerCase())) return t
  return (a + ' ' + t).trim()
}

export interface Playable { play: string; title: string; author: string; art: string | null }

/**
 * Найти ту же запись там, где её можно играть целиком.
 *
 * Audius — открытый каталог с публичным поиском без ключа. Совпадение проверяем,
 * а не берём первое подряд: подсунуть человеку чужую песню под нужным названием
 * хуже, чем честно сказать «не нашлось».
 */
export async function findPlayable(title: string, author: string): Promise<Playable | null> {
  const q = searchQuery(title, author)
  if (q.length < 3) return null
  try {
    const r = await fetch('https://api.audius.co/v1/tracks/search?query=' + encodeURIComponent(q) + '&app_name=ponoi&limit=8')
    if (!r.ok) return null
    const j = await r.json()
    const list: any[] = Array.isArray(j?.data) ? j.data : []
    const want = norm(title)
    for (const d of list) {
      if (!d?.id || !d?.title) continue
      if (!looksSame(norm(String(d.title)), want)) continue
      return {
        play: 'https://api.audius.co/v1/tracks/' + d.id + '/stream?app_name=ponoi',
        title: String(d.title),
        author: String(d.user?.name || d.user?.handle || 'Audius'),
        art: (d.artwork && (d.artwork['480x480'] || d.artwork['150x150'])) || null,
      }
    }
  } catch { /* не ответил — просто нет замены */ }
  return null
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Считаем названия одной записью, если одно содержит другое целиком. */
export function looksSame(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  // Слишком короткое название («Go») совпадёт с чем угодно — такому не верим.
  return short.length >= 5 && long.includes(short)
}
