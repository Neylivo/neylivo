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
  /**
   * Длительность записи, с которой сняты метки, в секундах — из строки
   * [length:03:20] (v1.404.0). Нужна для ускоренных версий: метки сняты с
   * оригинала, а у «спидапа» та же песня короче, и без пересчёта текст
   * разъезжается тем сильнее, чем дальше от начала.
   */
  srcDur?: number
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
  let srcDur: number | undefined
  const lines: LyricLine[] = []

  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim()
    if (!line) { lines.push({ t: null, text: '' }); continue }

    const meta = line.match(META_RE)
    if (meta) {
      const tag = meta[1].toLowerCase()
      if (tag === 'offset') {
        const v = parseInt(meta[2].trim(), 10)
        if (!isNaN(v)) offset = v
      }
      if (tag === 'length') {
        // Пишут и «03:20», и «200», и «3:20.5» — разбираем все три.
        const raw2 = meta[2].trim()
        const mm = raw2.match(/^(\d{1,3}):(\d{1,2})(?:[.,](\d+))?$/)
        if (mm) srcDur = parseInt(mm[1], 10) * 60 + parseInt(mm[2], 10)
        else { const n = parseFloat(raw2); if (isFinite(n) && n > 0) srcDur = n }
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
  return { lines, synced, raw: src, srcDur }
}

/**
 * Во сколько раз запись, с которой сняты метки, длиннее играющей (v1.404.0).
 *
 * Ускоренная версия — это та же песня, только короче: метки с оригинала на ней
 * не просто «немного опаздывают», а разъезжаются тем сильнее, чем дальше от
 * начала, и к середине песни текст уходит на десятки секунд.
 *
 * Пересчитываем, только когда обе длительности известны и правдоподобны:
 * ошибиться тут хуже, чем не трогать. Разница больше чем вдвое — это не
 * ускорение, а другая запись (концертная, с длинным вступлением, час подряд),
 * и подгонять под неё нечего.
 */
export function lyricsScale(srcDur?: number, trackDur?: number): number {
  if (!srcDur || !trackDur || !isFinite(srcDur) || !isFinite(trackDur)) return 1
  if (srcDur < 20 || trackDur < 20) return 1
  const k = srcDur / trackDur
  if (k < 0.5 || k > 2) return 1
  // Разница в пару секунд — это округление длительности, а не ускорение.
  if (Math.abs(srcDur - trackDur) < 3) return 1
  return k
}

/**
 * Время песни, по которому искать строку: с поправкой на скорость записи, на
 * ручной сдвиг и на то, что об истёкшем времени приложение узнаёт с задержкой
 * (v1.404.0). Заглядываем чуть вперёд — иначе строка вспыхивает уже после того,
 * как её начали петь.
 */
export const LYRICS_LOOKAHEAD = 0.25
export function lyricsTime(cur: number, scale: number, offset: number): number {
  return cur * scale + offset + LYRICS_LOOKAHEAD
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

/**
 * Куда прокрутить список, чтобы строка встала РОВНО посередине (v1.420.0).
 *
 * Почему это считается по измеренным размерам, а не по номеру строки. Раньше
 * положение вычислялось арифметикой: «сдвинуть на номер строки × высоту
 * строки». Это верно ровно до первой длинной строки: она переносится на два
 * ряда, её настоящая высота становится вдвое больше расчётной, и дальше весь
 * текст съезжает — тем сильнее, чем больше таких строк было выше. Поющаяся
 * строка оказывалась ниже середины, а к концу песни уходила за край.
 *
 * Поэтому считаем от того, что видно на самом деле: от верха строки и её
 * высоты. lineTop — offsetTop строки внутри прокручиваемого блока.
 */
export function centerScrollTop(lineTop: number, lineHeight: number, viewHeight: number, maxScroll: number): number {
  const want = lineTop + lineHeight / 2 - viewHeight / 2
  if (!isFinite(want)) return 0
  return Math.max(0, Math.min(Math.round(want), Math.max(0, Math.round(maxScroll))))
}

/**
 * Сколько ждать, прежде чем снова вести текст самому (v1.420.0).
 *
 * Человек листает текст руками — значит, он что-то читает, и вырывать список
 * из-под пальца на следующей же строке нельзя. Но и бросать его в
 * пролистанном виде до конца песни неправильно: он забудет, что листал, и
 * решит, что подсветка отстала. Поэтому пауза, а не переключатель.
 */
export const LYRICS_HOLD_MS = 6000

/** Пора ли снова самим вести текст: last — когда человек листал последний раз. */
export function autoScrollOk(lastTouch: number, now: number): boolean {
  return !lastTouch || now - lastTouch >= LYRICS_HOLD_MS
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

// ── Ручная поправка (v1.404.0) ────────────────────────────────────────────
//
// Даже верно подобранный текст у одной записи идёт на полсекунды раньше, у
// другой — позже: у неё длиннее вступление, другой мастеринг, другая нарезка.
// Автоматически это не угадать, поэтому даём человеку сдвинуть текст самому —
// поправка помнится для каждого трека отдельно.

const SHIFT_KEY = 'ponoi_mus_lyr_shift_v1'

function shiftAll(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SHIFT_KEY) || '{}') } catch { return {} }
}
export function lyricsShift(trackId: string): number {
  const v = shiftAll()[trackId]
  return typeof v === 'number' && isFinite(v) ? v : 0
}
export function setLyricsShift(trackId: string, v: number) {
  const all = shiftAll()
  const clamped = Math.max(-15, Math.min(15, Math.round(v * 10) / 10))
  if (clamped) all[trackId] = clamped; else delete all[trackId]
  try { localStorage.setItem(SHIFT_KEY, JSON.stringify(all)) } catch { /* переполнено */ }
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
 * Насколько долго ехать к следующей строке (v1.435.0).
 *
 * Раньше текст двигала системная плавная прокрутка (`behavior: 'smooth'`): у
 * неё одна скорость на любое расстояние и своя, ничем не управляемая кривая.
 * На песне это заметно — короткий шаг между соседними строками она тянет так
 * же долго, как прыжок через припев, и движение выходит вязким, а на быстрых
 * строчках следующая прокрутка обрывает предыдущую на середине.
 *
 * Поэтому время считается от расстояния: соседняя строка — быстро, далёкий
 * прыжок — заметно, но не дольше секунды, иначе текст «плывёт» отдельно от
 * музыки.
 */
export function lyricsScrollMs(distancePx: number): number {
  const d = Math.abs(distancePx)
  return Math.max(240, Math.min(900, 240 + d * 1.1))
}

/**
 * Кривая движения: быстро трогается, мягко останавливается.
 *
 * Без «отскока» нарочно: текст, который проезжает мимо строки и возвращается,
 * читать невозможно, а строка — это то, что человек в этот момент читает.
 */
export function lyricsEase(p: number): number {
  const t = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - t, 5)
}

/** Имя для сверки: без регистра, без скобок и без служебных слов. */
function nameKey(s: string | undefined): string {
  return (s || '').toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(official|video|audio|lyrics?|remaster(ed)?|hd|prod|feat|ft|version|клип|премьера)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
/** Значимые слова имени — по ним считается совпадение «на две трети». */
function nameWords(s: string | undefined): string[] {
  return nameKey(s).split(' ').filter(w => w.length >= 2)
}

/**
 * Похожи ли имена (исполнителя или названия) настолько, чтобы считать их одним.
 *
 * Не строгое равенство: в каталоге пишут «Король и Шут», «Король И Шут (КиШ)»,
 * «Korol i Shut». Совпадением считается вхождение одного в другое целиком или
 * общая часть не меньше двух третей меньшего имени — этого хватает, чтобы
 * пережить приписки, и мало, чтобы спутать двух разных людей.
 */
export function sameName(a: string | undefined, b: string | undefined): boolean {
  const ka = nameKey(a), kb = nameKey(b)
  if (!ka || !kb) return false
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true
  const wa = new Set(nameWords(a)), wb = nameWords(b)
  if (!wa.size || !wb.length) return false
  const common = wb.filter(w => wa.has(w)).length
  return common / Math.min(wa.size, wb.length) >= 0.67
}

/**
 * Какую из найденных записей брать.
 *
 * v1.435.0: сверяется ИСПОЛНИТЕЛЬ, и это главное изменение.
 *
 * Что было. Выбор шёл по двум признакам: есть ли метки времени (+1000) и близка
 * ли длительность. Автор не участвовал вообще. У песни с распространённым
 * названием («Осень», «Небо», «Home») в каталоге десятки записей разных людей —
 * и побеждала та, у которой оказались метки времени, а не та, которую человек
 * слушает. То есть под музыку одного исполнителя пелся текст другого, и со
 * стороны это выглядело как «караоке показывает чушь». Владелец принёс ровно
 * это.
 *
 * Как теперь, по убыванию важности:
 *   1. совпал исполнитель — сильнее всего остального вместе взятого;
 *   2. совпало название;
 *   3. есть метки времени — ради караоке всё и затевалось;
 *   4. ближе длительность: у одной песни бывает и студийная запись, и
 *      концертная, и час «расширенной версии», а текст к ним разъезжается.
 *
 * И отдельно — правило отказа. Если исполнитель известен, но НИ ОДНА запись с
 * ним не сошлась, берём чужую только при почти точном совпадении длительности
 * (до пяти секунд): одинаковая длина и одинаковое название — это уже та самая
 * запись, просто автор в каталоге записан иначе. Во всех прочих случаях честнее
 * сказать «не нашлось», чем показать чужой текст.
 */
export function pickLyrics(rows: LrcRow[], dur?: number, want?: { title?: string; artist?: string }): LrcRow | null {
  const withText = (rows ?? []).filter(r => (r.syncedLyrics || r.plainLyrics || '').trim())
  if (!withText.length) return null
  const wantArtist = (want?.artist || '').trim()
  const wantTitle = (want?.title || '').trim()
  const durOk = (r: LrcRow) => !!(dur && isFinite(dur) && r.duration && Math.abs(r.duration - dur) <= 5)

  const artistHit = (r: LrcRow) => !!wantArtist && sameName(r.artistName, wantArtist)
  const titleHit = (r: LrcRow) => !!wantTitle && sameName(r.trackName, wantTitle)

  const score = (r: LrcRow) => {
    let v = 0
    if (artistHit(r)) v += 100_000
    if (titleHit(r)) v += 10_000
    if (r.syncedLyrics && r.syncedLyrics.trim()) v += 1000
    if (dur && isFinite(dur) && r.duration) v -= Math.min(200, Math.abs(r.duration - dur))
    return v
  }

  let best = withText[0]
  for (const r of withText) if (score(r) > score(best)) best = r

  // Исполнитель известен, а совпадения с ним нет ни у кого: пускаем только
  // запись той же длины — иначе это чужая песня с тем же названием.
  if (wantArtist && !artistHit(best) && !durOk(best)) return null
  return best
}

/** Дописать [length:мм:сс], если его нет: без него ускоренную версию не подогнать. */
function withLength(text: string, dur?: number): string {
  if (!text || !dur || !isFinite(dur) || dur <= 0) return text
  if (/^\[length:/im.test(text)) return text
  const m = Math.floor(dur / 60), sec = Math.round(dur % 60)
  return `[length:${m}:${String(sec).padStart(2, '0')}]\n` + text
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
      // v1.435.0: кого именно ищем — передаётся внутрь выбора. Без этого он
      // брал запись с метками времени от любого однофамильца по названию.
      const best = pickLyrics(Array.isArray(rows) ? rows : [], dur, { title, artist })
      if (best) return { ok: true, hit: {
        // Длительность записи дописываем строкой [length:...] — по ней потом
        // подгоняется время для ускоренных версий. lrclib отдаёт её отдельным
        // полем, а в самом тексте её обычно нет.
        text: withLength((best.syncedLyrics || best.plainLyrics || '').trim(), best.duration),
        synced: !!(best.syncedLyrics && best.syncedLyrics.trim()),
        by: [best.artistName, best.trackName].filter(Boolean).join(' — '),
      } }
    } catch { netFail = true }
  }
  return { ok: false, why: netFail ? 'net' : 'none' }
}
