// v1.494.0: свой голос для озвучки сообщений.
//
// Владелец: «сделай чтобы в настройках можешь поставить любой голос на озвучка
// сообщение хоть голос себя или Соника».
//
// Что было. Пункт «Зачитать сообщение» существовал с давних пор и всегда читал
// ОДНИМ голосом: ru-RU, что бы система ни поставила по умолчанию, без единой
// настройки. Ни выбрать другой, ни ускорить, ни сделать выше — ничего.
//
// Что здесь. Вся смысловая часть озвучки: какой голос выбрать из тех, что есть
// в системе, с какой скоростью и высотой читать, что именно произносить. Всё
// это чистые функции — их и проверяют, без единого произнесённого слова.
// Живая часть (сам speechSynthesis) — в speak() внизу и в настройках.
//
// ПРО «ГОЛОС СЕБЯ». Скопировать чей-то настоящий голос с записи приложение не
// умеет и обещать этого не будет. Зато список голосов берётся у системы
// целиком: всё, что человек поставил себе в Windows или Android, тут появится
// само. А высота и скорость дают остальное — «Соник» из списка ниже это она и
// есть.
//
// Проверки: src/lib/__ui_test.ts (чистая часть) и scripts/speak-test.cjs
// (настоящий синтез в настоящем браузере).

export interface SpeechSettings {
  /** URI голоса из системы. Пусто — какой система выберет сама. */
  voice: string
  /** Скорость: 0.1 медленно, 10 быстро. У браузеров разумный предел ~4. */
  rate: number
  /** Высота: 0 низко, 2 высоко. */
  pitch: number
  /** Громкость 0..1. */
  volume: number
  /** Читать ли «Имя говорит:» перед текстом. */
  sayAuthor: boolean
}

export const SPEECH_DEFAULT: SpeechSettings = {
  voice: '', rate: 1, pitch: 1, volume: 1, sayAuthor: true,
}

/** Пределы. Взяты из самого Web Speech API, а не из головы. */
export const RATE_MIN = 0.1, RATE_MAX = 4
export const PITCH_MIN = 0, PITCH_MAX = 2

/**
 * Готовые голоса.
 *
 * Нужны не для красоты: «поставь высоту 1.9 и скорость 1.6» — это не то, что
 * человек будет подбирать сам. Соник здесь настоящий: быстро и очень высоко.
 */
export interface SpeechPreset { id: string; label: string; hint: string; rate: number; pitch: number }

export const SPEECH_PRESETS: SpeechPreset[] = [
  { id: 'normal', label: 'Обычный', hint: 'Как читает система', rate: 1, pitch: 1 },
  { id: 'sonic', label: 'Соник', hint: 'Быстро и очень высоко', rate: 1.7, pitch: 2 },
  { id: 'chipmunk', label: 'Бурундук', hint: 'Ещё выше, но помедленнее', rate: 1.15, pitch: 2 },
  { id: 'deep', label: 'Бас', hint: 'Низко и неспешно', rate: 0.85, pitch: 0.2 },
  { id: 'robot', label: 'Робот', hint: 'Ровно и без интонации', rate: 0.9, pitch: 0.5 },
  { id: 'announcer', label: 'Диктор', hint: 'Медленно и внятно', rate: 0.8, pitch: 1 },
  { id: 'fast', label: 'Скороговорка', hint: 'Очень быстро', rate: 3, pitch: 1.1 },
]

/** Число в границах. Мусор превращается в значение по умолчанию, а не в NaN. */
export function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Прочитать сохранённое. Битое и чужое молча заменяется разумным. */
export function readSpeech(raw: string | null): SpeechSettings {
  let o: any = {}
  try { o = raw ? JSON.parse(raw) : {} } catch { o = {} }
  if (!o || typeof o !== 'object') o = {}
  return {
    voice: typeof o.voice === 'string' ? o.voice : '',
    rate: clampNum(o.rate, RATE_MIN, RATE_MAX, 1),
    pitch: clampNum(o.pitch, PITCH_MIN, PITCH_MAX, 1),
    volume: clampNum(o.volume, 0, 1, 1),
    sayAuthor: o.sayAuthor === undefined ? true : !!o.sayAuthor,
  }
}

export const SPEECH_KEY = 'ponoi_speech'

/** Какой из готовых голосов сейчас выбран, если какой-то. */
export function presetOf(s: SpeechSettings): string | null {
  const п = SPEECH_PRESETS.find(p =>
    Math.abs(p.rate - s.rate) < 0.001 && Math.abs(p.pitch - s.pitch) < 0.001)
  return п ? п.id : null
}

/** Минимум от голоса системы, который нам нужен. */
export interface VoiceLike { name: string; lang: string; voiceURI: string; default?: boolean }

/**
 * Выбрать голос для чтения.
 *
 * Порядок: выбранный человеком → голос под язык текста → голос по умолчанию →
 * первый попавшийся. Последние три нужны потому, что выбранный голос может
 * ИСЧЕЗНУТЬ: человек удалил языковой пакет, открыл приложение на другом
 * устройстве, обновил систему. Молча замолчать в этом случае — худшее, что
 * можно сделать: выглядит как «озвучка сломалась».
 */
export function pickVoice(voices: VoiceLike[], want: string, lang = 'ru'): VoiceLike | null {
  if (!voices.length) return null
  if (want) {
    const свой = voices.find(v => v.voiceURI === want) ?? voices.find(v => v.name === want)
    if (свой) return свой
  }
  const язык = voices.filter(v => (v.lang || '').toLowerCase().startsWith(lang.toLowerCase()))
  if (язык.length) return язык.find(v => v.default) ?? язык[0]
  return voices.find(v => v.default) ?? voices[0]
}

/**
 * Что именно произнести.
 *
 * Имя автора отделяется от текста паузой (запятой): без неё «Ваня говорит
 * привет» сливается в одно слово, и на слух непонятно, где кончилось имя.
 */
export function speechText(authorName: string, text: string, sayAuthor: boolean): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const имя = String(authorName ?? '').trim()
  return sayAuthor && имя ? имя + ' говорит, ' + t : t
}

/**
 * Разложить голоса по языкам — для списка в настройках.
 *
 * Голосов в системе бывает под сотню, и плоский список из них нечитаем.
 * Русские идут первыми: приложение русское, и искать в нём русский голос
 * пролистыванием ста строк незачем.
 */
export function groupVoices(voices: VoiceLike[], first = 'ru'): { lang: string; voices: VoiceLike[] }[] {
  const по = new Map<string, VoiceLike[]>()
  for (const v of voices) {
    const k = (v.lang || '??').split('-')[0].toLowerCase()
    const с = по.get(k) ?? []
    с.push(v)
    по.set(k, с)
  }
  const ключи = [...по.keys()].sort((a, b) => {
    if (a === first) return -1
    if (b === first) return 1
    return a.localeCompare(b)
  })
  return ключи.map(k => ({ lang: k, voices: по.get(k)!.sort((a, b) => a.name.localeCompare(b.name)) }))
}

// ── Живая часть ────────────────────────────────────────────────────────────

/**
 * Голоса системы.
 *
 * Отдельной функцией, потому что в браузере они приезжают НЕ СРАЗУ: первый
 * вызов getVoices() часто возвращает пустой список, а настоящий приходит
 * событием voiceschanged. Спросить один раз и показать пустой список — это
 * «голосов нет» на ровном месте, и так выглядит половина чужих реализаций.
 */
export function loadVoices(): Promise<VoiceLike[]> {
  return new Promise(resolve => {
    const s = typeof window !== 'undefined' ? window.speechSynthesis : null
    if (!s) { resolve([]); return }
    const есть = s.getVoices()
    if (есть.length) { resolve(есть); return }

    let ушли = false
    let тик = 0
    const готово = (v: VoiceLike[]) => {
      if (ушли) return
      ушли = true
      clearInterval(тик)
      s.removeEventListener?.('voiceschanged', попробовать)
      resolve(v)
    }
    // Событие voiceschanged приходит и с ПУСТЫМ списком: движок сообщает, что
    // взялся за дело, а не что закончил. Ответить на него сразу — значит
    // отдать ноль и решить, что голосов нет.
    function попробовать() {
      const v = s!.getVoices()
      if (v.length) готово(v)
    }
    s.addEventListener?.('voiceschanged', попробовать)

    // ТОЛКАЕМ ДВИЖОК. Без этого список так и остаётся пустым НАВСЕГДА.
    //
    // Замерено живой пробой (test:speak): getVoices() отдаёт ноль, и событие
    // voiceschanged не приходит вообще, пока синтез не попросили что-нибудь
    // сказать. После первой попытки приезжают все голоса разом.
    //
    // Без толчка в настройках было бы «система пока не отдала список голосов»
    // до тех пор, пока человек не нажмёт «Проверить», — и он решил бы, что
    // голосов в системе нет.
    //
    // Толкаем беззвучно: пробел с нулевой громкостью. И НЕ отменяем сразу —
    // отмена обрывает запуск движка до того, как он перечислит голоса.
    try {
      const толчок = new SpeechSynthesisUtterance(' ')
      толчок.volume = 0
      s.speak(толчок)
    } catch { /* нет синтеза — отдадим пустой список по сроку */ }

    // Опрашиваем сами: события может не быть вовсе, а движок поднимается
    // секунды. Первый вызов на старте приложения приходит РАНЬШЕ, чем движок
    // готов, — на этом проверка и поймала меня.
    тик = (setInterval(попробовать, 200) as unknown) as number
    setTimeout(() => готово(s.getVoices()), 6000)
  })
}

/** Прочитать вслух с этими настройками. Возвращает, взялось ли за дело. */
export async function speak(text: string, s: SpeechSettings, lang = 'ru-RU'): Promise<boolean> {
  const синт = typeof window !== 'undefined' ? window.speechSynthesis : null
  if (!синт || !text) return false
  try {
    const u = new SpeechSynthesisUtterance(text)
    const голоса = await loadVoices()
    const v = pickVoice(голоса, s.voice, lang.split('-')[0])
    if (v) u.voice = v as SpeechSynthesisVoice
    // Язык ставим ОТ ГОЛОСА, а не жёстко русский: с английским голосом и
    // lang='ru-RU' система читает русскими правилами английские слова, и выходит
    // невнятица. Раньше здесь всегда стояло ru-RU.
    u.lang = v?.lang || lang
    u.rate = clampNum(s.rate, RATE_MIN, RATE_MAX, 1)
    u.pitch = clampNum(s.pitch, PITCH_MIN, PITCH_MAX, 1)
    u.volume = clampNum(s.volume, 0, 1, 1)
    синт.cancel()
    синт.speak(u)
    return true
  } catch { return false }
}

/** Замолчать. Нужно и настройкам (проба), и чату. */
export function stopSpeaking() {
  try { window.speechSynthesis?.cancel() } catch { /* нет синтеза — и молчать не надо */ }
}
