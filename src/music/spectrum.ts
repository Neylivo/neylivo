// v1.491.0: спектр звука плеера — для визуализаторов в плагинах.
//
// Зачем. Владелец попросил AudioContext и AnalyserNode, «чтобы анализировать
// музыку». Сам AudioContext у плагина теперь есть — в его окне-странице он
// настоящий. Но проанализировать им ЧУЖОЙ звук нельзя ничем: звук плеера живёт
// в приложении, а страница плагина — в песочнице с чужим происхождением, и
// дотянуться до него оттуда невозможно, как невозможно и из потока.
//
// Поэтому анализатор стоит в приложении, а плагину уходят ЧИСЛА: полосы спектра
// и общая громкость. Этого хватает на любой визуализатор, а самого звука
// плагину по-прежнему не достаётся — как и раньше.
//
// ЧТО ЭТО НЕ ДЕЛАЕТ. Не слушает микрофон, не лезет в звонок и не работает для
// YouTube и SoundCloud: там звук идёт внутри чужого окна, и добраться до него
// нечем — ровно то же ограничение, что у эквалайзера (dsp.ts). Плагин узнаёт об
// этом честно: полосы приходят нулями, а не выдуманными числами.
//
// Опрос идёт ТОЛЬКО пока кто-то подписан — как у геймпадов (gamepads.ts).
// Крутить кадровый цикл ради никого — это севшая батарея на ровном месте.
//
// Проверки: src/music/__music_test.ts (чистая математика) и
// src/lib/plugins/__api_test.tsx (живой звук).

/** Сколько полос отдаём плагину. Достаточно для полосок и колец, и не гоняет
 *  по тысяче чисел в кадр. */
export const BANDS = 32

/**
 * Свести сырые данные анализатора в полосы.
 *
 * Чистая функция, чтобы её можно было проверить без звука вообще. Данные
 * анализатора — байты 0..255 по линейной шкале частот; ухо же слышит
 * логарифмически, поэтому нижние полосы берут узкие куски, верхние — широкие.
 * Без этого весь визуализатор выглядит как «слева всё скачет, справа мертво».
 */
export function toBands(raw: ArrayLike<number>, bands = BANDS): number[] {
  const n = raw.length
  const out: number[] = []
  if (!n) return new Array(bands).fill(0)
  for (let i = 0; i < bands; i++) {
    // Границы куска по логарифму: каждая следующая полоса шире предыдущей.
    const от = Math.floor(n * (Math.pow(2, i / bands) - 1))
    const до = Math.max(от + 1, Math.floor(n * (Math.pow(2, (i + 1) / bands) - 1)))
    // Ровная шкала здесь была бы проще, но выглядит она плохо: вся музыка
    // живёт в нижней трети, и правая половина полос стояла бы мёртвой.
    let сумма = 0, счёт = 0
    for (let j = от; j < Math.min(до, n); j++) { сумма += raw[j]; счёт++ }
    out.push(счёт ? Math.round(сумма / счёт) / 255 : 0)
  }
  return out
}

/**
 * Общая громкость 0..1 — для «пульса» под бит.
 *
 * Считается по ВОЛНЕ, а не по спектру. Первая версия брала среднее по всем
 * частотным полосам, и это оказалось враньём: чистый тон занимает несколько
 * полос из двухсот пятидесяти шести, среднее выходит 0.006 — то есть громкая
 * нота читалась как тишина. Поймано живой проверкой на настоящем звуке.
 *
 * Данные волны — байты вокруг 128 (128 и есть тишина), поэтому считаем
 * среднеквадратичное отклонение от середины: ровно то, что ухо зовёт
 * громкостью.
 */
export function toLevel(wave: ArrayLike<number>): number {
  if (!wave.length) return 0
  let s = 0
  for (let i = 0; i < wave.length; i++) {
    const d = (wave[i] - 128) / 128
    s += d * d
  }
  return Math.round(Math.sqrt(s / wave.length) * 1000) / 1000
}

// ── Живая часть ────────────────────────────────────────────────────────────

type Кадр = { bands: number[]; level: number }

let анализатор: AnalyserNode | null = null
let буфер: Uint8Array | null = null
/** Отдельный буфер под волну: громкость считается по ней, а не по спектру. */
let волна: Uint8Array | null = null
const подписчики = new Set<string>()
let кадр = 0
let отдать: ((k: Кадр) => void) | null = null

/** Кто отдаёт кадры наружу. Ставит host.ts — здесь про плагины ничего не знают. */
export function setSpectrumEmit(fn: ((k: Кадр) => void) | null) { отдать = fn }

/** Есть ли смысл вообще строить цепочку. Спрашивает плеер. */
export const spectrumWanted = (): boolean => подписчики.size > 0

const слушателиГотовности = new Set<() => void>()
/** Плеер узнаёт, что спектр понадобился, и достраивает цепочку. */
export function onSpectrumWanted(fn: () => void): () => void {
  слушателиГотовности.add(fn)
  return () => { слушателиГотовности.delete(fn) }
}

/** Плеер отдал сюда свой анализатор. Может позваться повторно — это не беда. */
export function setAnalyser(a: AnalyserNode | null) {
  анализатор = a
  буфер = a ? new Uint8Array(a.frequencyBinCount) : null
  волна = a ? new Uint8Array(a.fftSize) : null
}

export const hasAnalyser = (): boolean => !!анализатор

/** Один снимок. Отдельной функцией — её же зовёт проверка. */
export function readSpectrum(): Кадр {
  if (!анализатор || !буфер || !волна) return { bands: new Array(BANDS).fill(0), level: 0 }
  анализатор.getByteFrequencyData(буфер as Uint8Array<ArrayBuffer>)
  анализатор.getByteTimeDomainData(волна as Uint8Array<ArrayBuffer>)
  return { bands: toBands(буфер), level: toLevel(волна) }
}

function шаг() {
  if (!подписчики.size) { кадр = 0; return }
  const k = readSpectrum()
  try { отдать?.(k) } catch { /* сломанный слушатель — не повод встать */ }
  кадр = requestAnimationFrame(шаг)
}

export function watchSpectrum(pluginId: string) {
  подписчики.add(pluginId)
  // Плееру пора построить цепочку: до подписки анализатора могло не быть вовсе.
  слушателиГотовности.forEach(fn => { try { fn() } catch {} })
  if (!кадр && typeof requestAnimationFrame === 'function') кадр = requestAnimationFrame(шаг)
}

export function unwatchSpectrum(pluginId: string) {
  подписчики.delete(pluginId)
  if (!подписчики.size && кадр) { cancelAnimationFrame(кадр); кадр = 0 }
}

/** Убрать за всеми сразу — аварийный режим. Анализатор при этом остаётся: он
 *  принадлежит плееру, а не плагинам. */
export function unwatchAllSpectrum() {
  подписчики.clear()
  if (кадр) { cancelAnimationFrame(кадр); кадр = 0 }
}

/** Для проверок и аварийного режима. */
export function clearSpectrum() {
  подписчики.clear()
  if (кадр) { cancelAnimationFrame(кадр); кадр = 0 }
  setAnalyser(null)
  отдать = null
}
