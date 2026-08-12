// v1.420.0: внутренний ИИ NeyLivo Music — слушает трек и сам расставляет текст.
//
// Зачем это вообще. Текст с метками времени (LRC) есть у популярных песен и нет
// у всего остального: у своих записей, у редких вещей, у чужих языков. Раньше в
// таком случае человек мог только вписать текст руками, а метки времени —
// расставить построчно, чего никто в жизни делать не станет. Караоке
// существовало только для тех песен, которым повезло попасть в чужой каталог.
//
// Что делает ИИ. Модель распознавания речи (Whisper) слушает сам звук трека и
// отдаёт куски текста с временем: «с 12.4 по 16.1 звучало вот это». Из этого
// собирается LRC — тот же формат, что и у скачанного текста, с теми же метками.
//
// Два режима, и второй важнее первого:
//
//   1. Ничего не известно — берём распознанное как есть. Слова могут быть с
//      ошибками: модель обучена на речи, а не на пении, и это честно
//      подписывается в самом тексте.
//   2. Слова известны (нашлись в каталоге, но без меток) или человек вставил их
//      сам — тогда распознанное используется ТОЛЬКО как источник времени, а
//      слова остаются правильными. Получается настоящее караоке на песне,
//      которой в каталогах синхронного текста нет вовсе.
//
// Чего здесь нет и не будет: выдумывания меток «на глазок». Если распознать не
// удалось или совпало слишком мало, функции возвращают null, а плеер говорит
// об этом словами. Врать про то, где какая строка звучит, хуже, чем не иметь
// караоке: человек видит, что подсветка мимо, и не понимает, кому не верить.

/** Кусок распознанного: с какой секунды, по какую (может не быть), и что услышано. */
export interface SpeechChunk {
  start: number
  end: number | null
  text: string
}

/** С какой моделью работаем. tiny — самая быстрая; она же единственная, которую
 *  разумно скачивать на телефон. Многоязычная: русские песни тоже. */
export const AI_MODEL = 'onnx-community/whisper-tiny'

/** Метка времени LRC из секунд: [мм:сс.дд]. */
export function stamp(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const ss = Math.floor(rest)
  const cs = Math.round((rest - ss) * 100)
  // Округление сотых может дать 100 — тогда это следующая секунда.
  const ss2 = cs === 100 ? ss + 1 : ss
  const cs2 = cs === 100 ? 0 : cs
  return `[${String(m).padStart(2, '0')}:${String(ss2).padStart(2, '0')}.${String(cs2).padStart(2, '0')}]`
}

/** Слова для сравнения: без знаков, в нижнем регистре, без пустого. */
export function words(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
}

/** Подпись, которая честно говорит, откуда взялся текст. Это служебная строка
 *  LRC — разбор её пропускает, а человек в окне правки видит. */
export const AI_CREDIT = '[by:NeyLivo — распознано на слух, слова могут быть с ошибками]'
export const AI_CREDIT_TIMED = '[by:NeyLivo — метки времени расставлены на слух]'

/**
 * Распознанное — в LRC (режим 1: слов мы не знали).
 *
 * Пустые и служебные куски выбрасываем: модель охотно выдаёт «(музыка)»,
 * «Спасибо за просмотр» на инструментальных участках и просто пустые строки.
 * Такое в тексте песни хуже, чем пропуск.
 */
export function chunksToLrc(chunks: SpeechChunk[], dur?: number): string | null {
  const good = (chunks ?? [])
    .filter(c => c && isFinite(c.start) && c.start >= 0 && words(c.text).length > 0)
    .filter(c => !JUNK.test(c.text.trim()))
    .sort((a, b) => a.start - b.start)
  if (good.length < 3) return null   // две строки — это не текст песни, а шум

  const lines = [AI_CREDIT]
  if (dur && isFinite(dur) && dur > 0) lines.push(`[length:${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}]`)
  let prev = -1
  for (const c of good) {
    // Метки обязаны идти по возрастанию: у модели на стыках кусков бывает
    // время «назад», и такой текст разбор потом отсортирует, перемешав строки.
    const t = c.start <= prev ? prev + 0.05 : c.start
    prev = t
    lines.push(stamp(t) + c.text.trim())
  }
  return lines.join('\n')
}

/** Мусор, который модель выдаёт на музыке без слов. */
const JUNK = /^[\s(\[]*(музыка|music|subtitles?|субтитры|аплодисменты|applause|спасибо за просмотр|thanks? for watching|foreign|♪+|\.+)[\s)\]]*$/i

/**
 * Режим 2: слова известны, времени нет. Ставим известным строкам время из
 * распознанного.
 *
 * Как сопоставляем. Идём по строкам сверху вниз и по распознанным кускам тоже
 * сверху вниз, не возвращаясь назад: песня поётся в одном порядке, и это
 * единственное, на что здесь можно твёрдо опереться. Строка считается найденной,
 * если делит с куском хотя бы одно слово длиннее трёх букв (короткие — «и», «не»,
 * «the» — совпадают со всем подряд и склеили бы что угодно с чем угодно).
 *
 * Не найденные строки получают время ЛИНЕЙНО между ближайшими найденными:
 * строки в песне идут примерно равномерно, и это куда ближе к правде, чем
 * оставить их без метки — без метки строка не подсветится вообще никогда.
 *
 * Если совпало меньше трети строк — возвращаем null. Это значит, что
 * распознавание не про эту песню (инструментал, другой язык, шум), и
 * притворяться, что мы её разметили, нельзя.
 */
export function alignPlainToChunks(plainText: string, chunks: SpeechChunk[], dur?: number): string | null {
  const raw = (plainText || '').replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.trim())
    // Служебные строки LRC и уже проставленные метки убираем: слова берём чистыми.
    .filter(l => l && !/^\[[a-z]+:.*\]$/i.test(l))
    .map(l => l.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim())
    .filter(Boolean)
  if (raw.length < 3) return null

  const heard = (chunks ?? [])
    .filter(c => c && isFinite(c.start) && words(c.text).length > 0)
    .sort((a, b) => a.start - b.start)
  if (heard.length < 3) return null

  const times: (number | null)[] = raw.map(() => null)
  let at = 0
  for (let i = 0; i < raw.length; i++) {
    const w = new Set(words(raw[i]).filter(x => x.length > 3))
    if (!w.size) continue
    for (let j = at; j < heard.length; j++) {
      const hw = words(heard[j].text).filter(x => x.length > 3)
      if (hw.some(x => w.has(x))) {
        times[i] = heard[j].start
        at = j + 1
        break
      }
    }
  }

  const found = times.filter(t => t !== null).length
  if (found < Math.max(3, Math.ceil(raw.length / 3))) return null

  // Пропуски достраиваем: до первой найденной — назад от неё, после последней —
  // вперёд, между — ровными шагами.
  fillGaps(times, dur)

  const out = [AI_CREDIT_TIMED]
  if (dur && isFinite(dur) && dur > 0) out.push(`[length:${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}]`)
  let prev = -1
  for (let i = 0; i < raw.length; i++) {
    let t = times[i] ?? prev + 2
    if (t <= prev) t = prev + 0.05
    prev = t
    out.push(stamp(t) + raw[i])
  }
  return out.join('\n')
}

/** Достроить пропущенные метки. Отдельно — потому что это чистая арифметика,
 *  и её проверяет тест. */
export function fillGaps(times: (number | null)[], dur?: number): void {
  const n = times.length
  const firstIdx = times.findIndex(t => t !== null)
  const lastIdx = (() => { for (let i = n - 1; i >= 0; i--) if (times[i] !== null) return i; return -1 })()
  if (firstIdx < 0) return

  // Шаг «по умолчанию» — средний промежуток между известными строками.
  const known: number[] = []
  for (const t of times) if (t !== null) known.push(t)
  const span = known[known.length - 1] - known[0]
  const step = known.length > 1 ? Math.max(0.5, span / (known.length - 1)) : 3

  // До первой известной — раскладываем ровно между началом записи и ею.
  //
  // Сначала здесь стоял отсчёт назад с обычным шагом, и на длинном вступлении
  // все такие строки упирались в ноль: две-три строки с одинаковой меткой 0 —
  // это подсветка, которая перескакивает через них разом. Раскладка по долям
  // даёт возрастающие метки при любом вступлении.
  const firstT = times[firstIdx] as number
  for (let i = 0; i < firstIdx; i++) {
    times[i] = Math.max(0, (firstT * (i + 1)) / (firstIdx + 1))
  }
  // После последней — шагаем вперёд, не дальше конца записи.
  for (let i = lastIdx + 1; i < n; i++) {
    const t = (times[i - 1] as number) + step
    times[i] = dur && isFinite(dur) && dur > 0 ? Math.min(t, dur) : t
  }
  // Между известными — ровными долями.
  let i = firstIdx
  while (i < lastIdx) {
    if (times[i + 1] !== null) { i++; continue }
    let j = i + 1
    while (j < n && times[j] === null) j++
    const a = times[i] as number, b = times[j] as number
    const cnt = j - i
    for (let k = 1; k < cnt; k++) times[i + k] = a + ((b - a) * k) / cnt
    i = j
  }
}

export type AiStage = 'audio' | 'model' | 'listen'
export interface AiProgress { stage: AiStage; percent: number; note?: string }

/** Почему распознать нельзя. null — можно. */
export function whyCantRecognize(src: string | undefined, isEmbed: boolean): string | null {
  if (isEmbed) {
    return 'У треков с YouTube и SoundCloud сам звук приложению недоступен — его отдаёт их проигрыватель, а не мы. Распознавать нечего.'
  }
  if (!src) return 'У этого трека нет ссылки, по которой можно получить сам звук.'
  return null
}
