import { supabase } from '../lib/supabase'
import { searchQuery } from './streaming'

// v1.394.0: текст песни в полноэкранном плеере.
//
// Два формата в одном разборе. Обычный текст — просто строки, они плывут фоном.
// LRC — те же строки, но с метками времени «[01:23.45] строка»; по ним строка
// подсвечивается ровно тогда, когда её поют, то есть получается караоке. Караоке
// без меток невозможно: угадывать, когда какая строка звучит, приложение не
// может и делать вид, что может, не будет — в таком случае честно показываем
// текст фоном и говорим, почему.
//
// Текст общий на всю Трекотеку, как автор и обложка (миграция 22): нашёл один —
// видят все. Пока миграция 102 не применена, текст живёт на этом устройстве, и
// в настройках об этом сказано прямо.

export interface LyricLine {
  /** Секунда, на которой строку поют. null — у строки нет метки времени. */
  t: number | null
  text: string
}

export interface Lyrics {
  lines: LyricLine[]
  /** Есть ли метки времени — только с ними возможно караоке. */
  synced: boolean
  raw: string
}

const LOCAL_KEY = 'ponoi_mus_lyrics_v1'

// [00:12.34] / [1:2] / [00:12:34] (кое-где сотые отделяют двоеточием)
const TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
// Служебные строки LRC: [ar:Исполнитель], [ti:Название], [offset:+250]
const META_RE = /^\[(ar|ti|al|au|by|length|offset|re|ve|tool|encoding):(.*)\]$/i

/** Разбирает и обычный текст, и LRC. Пустой ввод — пустой разбор, без выдумок. */
export function parseLyrics(raw: string): Lyrics {
  const src = (raw ?? '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return { lines: [], synced: false, raw: src }

  let offset = 0   // [offset:+250] — сдвиг в миллисекундах, бывает в файлах LRC
  const lines: LyricLine[] = []

  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim()
    if (!line) { lines.push({ t: null, text: '' }); continue }

    const meta = line.match(META_RE)
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') {
        const v = parseInt(meta[2].trim(), 10)
        if (!isNaN(v)) offset = v
      }
      continue   // служебные строки не поются
    }

    TAG_RE.lastIndex = 0
    const stamps: number[] = []
    let m: RegExpExecArray | null
    while ((m = TAG_RE.exec(line))) {
      const mm = parseInt(m[1], 10), ss = parseInt(m[2], 10)
      // Сотые могут быть записаны одной, двумя или тремя цифрами.
      const fracRaw = m[3] ?? ''
      const frac = fracRaw ? parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length) : 0
      if (ss >= 60) continue   // мусорная метка — пропускаем, строку не теряем
      stamps.push(mm * 60 + ss + frac)
    }
    const text = line.replace(TAG_RE, '').trim()
    if (stamps.length === 0) { lines.push({ t: null, text: line }); continue }
    // Одна строка может быть помечена несколькими метками (припев) — тогда она
    // повторяется в каждой из них.
    for (const s of stamps) lines.push({ t: Math.max(0, s - offset / 1000), text })
  }

  const timed = lines.filter(l => l.t !== null)
  // Одна случайная метка в обычном тексте — это ещё не караоке. Порог: половина
  // непустых строк. Иначе подсветка скакала бы по трём строкам из сорока.
  const nonEmpty = lines.filter(l => l.text.trim()).length
  const synced = timed.length > 0 && timed.length >= Math.max(2, Math.ceil(nonEmpty / 2))

  if (synced) lines.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
  return { lines, synced, raw: src }
}

/**
 * Какая строка звучит на секунде t. Возвращает -1, пока не началась первая.
 * Двоичный поиск: строк бывает под сотню, а зовут это на каждом кадре.
 */
export function activeLineIndex(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, res = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const lt = lines[mid].t
    if (lt === null || lt > t) hi = mid - 1
    else { res = mid; lo = mid + 1 }
  }
  return res
}

// ── Хранение ──────────────────────────────────────────────────────────────

function localAll(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') } catch { return {} }
}

/** Текст трека: сначала общий из базы, если её ещё нет — свой, с этого устройства. */
export async function loadLyrics(trackId: string): Promise<string> {
  if (!trackId) return ''
  const { data, error } = await supabase.from('music_lyrics').select('text').eq('track_id', trackId).maybeSingle()
  if (!error && data?.text) return data.text as string
  return localAll()[trackId] ?? ''
}

/**
 * Сохранить текст. Пишем и в базу, и на устройство: база может быть без
 * миграции 102, а терять набранное из-за этого нельзя.
 *
 * shared=false — только на это устройство, в общий текст не лезем. Так уходит
 * найденное в интернете у того, кто трек не выкладывал: себе он текст оставит,
 * а общий менять не вправе (v1.395.0). База это же правило держит сама, у себя;
 * здесь мы просто не стучимся туда, где нам заведомо откажут.
 */
export async function saveLyrics(trackId: string, text: string, shared = true): Promise<'db' | 'local'> {
  if (!trackId) return 'local'
  const all = localAll()
  if (text.trim()) all[trackId] = text; else delete all[trackId]
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)) } catch { /* переполнено */ }

  if (!shared) return 'local'
  const { data: u } = await supabase.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return 'local'
  const { error } = await supabase.from('music_lyrics')
    .upsert({ track_id: trackId, text, updated_by: uid }, { onConflict: 'track_id' })
  return error ? 'local' : 'db'
}

// ── Поиск в интернете (по желанию, по умолчанию выключено) ────────────────
//
// lrclib.net — открытый каталог текстов, ключа не требует и отдаёт в том числе
// LRC с метками времени. Запрос уходит с устройства человека: сервису видно
// название трека и IP. Поэтому настройка выключена по умолчанию, а рядом с ней
// это прямо написано — молчать о таком нельзя.
//
// v1.396.0: искали через /api/get — а он требует ТОЧНОГО названия и обязательно
// исполнителя: без исполнителя сервер отвечает 400, а у нас в Трекотеке автор
// известен далеко не всегда (файл, ссылка, свой заголовок с YouTube). В итоге
// «не нашлось» получали вообще все треки, и выглядело это как сломанная
// настройка. Теперь спрашиваем /api/search: он ищет по обрывку названия и
// прощает «(Official Video)» в заголовке.

export interface LyricsHit { text: string; synced: boolean; by: string }
export type LyricsSearch = { ok: true; hit: LyricsHit } | { ok: false; why: 'none' | 'net' }

/** Строка каталога, как её отдаёт lrclib. Берём только то, чем пользуемся. */
export interface LrcRow {
  trackName?: string; artistName?: string; duration?: number
  syncedLyrics?: string | null; plainLyrics?: string | null
}

/**
 * Какую из найденных записей брать.
 *
 * Сначала те, где есть текст вообще. Дальше — с метками времени: ради караоке
 * всё и затевалось. При равенстве ближе та, у которой длительность совпадает с
 * нашей: у одной песни в каталоге бывает и студийная запись, и концертная, и
 * час «расширенной версии», а текст к ним разъезжается.
 */
export function pickLyrics(rows: LrcRow[], dur?: number): LrcRow | null {
  const withText = (rows ?? []).filter(r => (r.syncedLyrics || r.plainLyrics || '').trim())
  if (!withText.length) return null
  const score = (r: LrcRow) => {
    let v = r.syncedLyrics && r.syncedLyrics.trim() ? 1000 : 0
    if (dur && isFinite(dur) && r.duration) v -= Math.min(200, Math.abs(r.duration - dur))
    return v
  }
  let best = withText[0]
  for (const r of withText) if (score(r) > score(best)) best = r
  return best
}

export async function searchLyricsOnline(title: string, artist: string, dur?: number): Promise<LyricsSearch> {
  // Два захода: «исполнитель + название» и одно название. Второй нужен, когда
  // автор записан не так, как в каталоге, — а такое сплошь и рядом.
  const queries = [searchQuery(title, artist), searchQuery(title, '')]
    .map(q => q.trim()).filter((q, i, a) => q && a.indexOf(q) === i)
  let netFail = false
  for (const q of queries) {
    try {
      const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q),
        { headers: { Accept: 'application/json' } })
      if (!r.ok) { if (r.status >= 500) netFail = true; continue }
      const rows = await r.json()
      const best = pickLyrics(Array.isArray(rows) ? rows : [], dur)
      if (best) return { ok: true, hit: {
        text: (best.syncedLyrics || best.plainLyrics || '').trim(),
        synced: !!(best.syncedLyrics && best.syncedLyrics.trim()),
        by: [best.artistName, best.trackName].filter(Boolean).join(' — '),
      } }
    } catch { netFail = true }
  }
  return { ok: false, why: netFail ? 'net' : 'none' }
}
