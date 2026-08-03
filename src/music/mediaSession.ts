// v1.425.0: системная «штучка» проигрывателя — как во всех музыкальных сервисах.
//
// Чего не было. Ponoi Music играл только пока приложение открыто и на экране: ни
// на шторке уведомлений, ни на экране блокировки, ни на кнопках гарнитуры о нём
// ничего не знало. Свернул приложение — и не то что музыка, даже название нигде
// не показывалось. Между тем ровно для этого в браузерах и в WebView Android
// есть Media Session API: страница отдаёт системе название, исполнителя,
// обложку и позицию, а система рисует свой проигрыватель и присылает нажатия
// обратно.
//
// Что это даёт на самом деле:
//   • Android (наше приложение — WebView): в шторке и на экране блокировки
//     появляется карточка с обложкой и кнопками, а звук продолжает играть, пока
//     жив процесс приложения. Кнопки гарнитуры и наушников работают.
//   • Браузер и PWA: то же самое, плюс кнопки на самой клавиатуре ноутбука.
//   • Десктоп (Electron): системный виджет мультимедиа Windows.
//
// Чего это НЕ даёт, и об этом честно сказано в разговоре с владельцем: Android
// вправе убить процесс приложения при нехватке памяти, и без настоящей
// «постоянной службы» (foreground service — это уже нативный код) музыка тогда
// прервётся. Media Session сильно повышает приоритет приложения, но не делает
// его неубиваемым.
//
// Отдельным файлом — потому что здесь единственное место во всём проекте,
// которое знает про navigator.mediaSession, и потому что его нет в старых
// движках: одна проверка на существование вместо десятка по коду.

export interface MediaNow {
  title: string
  artist: string
  /** Откуда трек — уходит в поле «альбом» системной карточки. */
  album?: string
  art?: string | null
  /** Длительность и позиция в секундах — по ним система рисует полосу. */
  dur?: number
  pos?: number
  playing: boolean
}

export interface MediaHandlers {
  play: () => void
  pause: () => void
  next: () => void
  prev: () => void
  /** Перемотать на секунду. */
  seek: (sec: number) => void
  /** Остановить и закрыть карточку. */
  stop?: () => void
}

type MS = MediaSession & {
  setPositionState?: (s: { duration?: number; position?: number; playbackRate?: number }) => void
}

// v1.443.0: то, из-за чего системная карточка «застывает», вынесено в чистые
// функции и проверяется тестом (npm run test:music). Раньше и признак «что-то
// изменилось», и разбор позиции жили прямо внутри вызовов к браузеру, а там
// ошибку видно только по тому, что однажды полоса в шторке перестала ползти.

/** Признак «карточку надо пересобрать». Пересборка на каждый тик заставляет
 *  систему перерисовывать обложку — она мигает. */
export function mediaKey(n: { title: string; artist: string; album?: string; art?: string | null }): string {
  return [n.title, n.artist, n.album ?? '', n.art ?? ''].join('|')
}

/** Что отдать системе для полосы. null — полосы не будет.
 *
 *  Позиция обязана быть не больше длительности: иначе браузер бросает ошибку и
 *  МОЛЧА перестаёт обновлять карточку целиком — то есть застывает не только
 *  полоса, но и название следующего трека. */
export function mediaPos(pos?: number, dur?: number): { duration: number; position: number; playbackRate: number } | null {
  const d = typeof dur === 'number' && isFinite(dur) && dur > 0 ? dur : 0
  if (!d) return null
  const p = typeof pos === 'number' && isFinite(pos) ? Math.max(0, pos) : 0
  return { duration: d, position: Math.min(p, d), playbackRate: 1 }
}

/** Обложки нет — отдаём значок приложения. Пустой список означает «нарисуй что
 *  хочешь», и Android рисует серый прямоугольник вместо карточки. */
export const MEDIA_FALLBACK_ART = '/icon.png'

export function mediaArtwork(art?: string | null): { src: string; sizes: string; type: string }[] {
  const src = art || MEDIA_FALLBACK_ART
  const type = /\.png(\?|$)/i.test(src) ? 'image/png' : 'image/jpeg'
  return [96, 192, 384, 512].map(px => ({ src, sizes: `${px}x${px}`, type }))
}

function session(): MS | null {
  try {
    const ms = (navigator as any)?.mediaSession
    return ms && typeof ms.setActionHandler === 'function' ? (ms as MS) : null
  } catch { return null }
}

export const hasMediaSession = (): boolean => !!session()

let bound = false

/**
 * Подписать системные кнопки на наши действия. Достаточно одного раза за
 * жизнь плеера: обработчики зовут свежие функции через ссылку.
 */
export function bindMediaKeys(h: MediaHandlers) {
  const ms = session()
  if (!ms || bound) return
  bound = true
  const set = (name: string, fn: ((d?: any) => void) | null) => {
    try { ms.setActionHandler(name as MediaSessionAction, fn as any) } catch { /* этого действия движок не знает */ }
  }
  set('play', () => h.play())
  set('pause', () => h.pause())
  set('nexttrack', () => h.next())
  set('previoustrack', () => h.prev())
  set('stop', () => (h.stop ? h.stop() : h.pause()))
  // Перемотка: и «на столько-то», и «ровно туда» — систему устраивает любая,
  // но разные оболочки присылают разные действия.
  set('seekto', (d: any) => { if (typeof d?.seekTime === 'number') h.seek(d.seekTime) })
  set('seekbackward', (d: any) => h.seek(Math.max(0, (curPos ?? 0) - (Number(d?.seekOffset) || 10))))
  set('seekforward', (d: any) => h.seek((curPos ?? 0) + (Number(d?.seekOffset) || 10)))
}

/** Последняя известная позиция — нужна кнопкам «назад/вперёд на 10 секунд». */
let curPos: number | null = null
/** Что уже отдано системе: без этого метаданные пересобирались бы каждую секунду. */
let lastKey = ''

/**
 * Рассказать системе, что играет. null — ничего не играет, карточку убираем.
 *
 * Позиция обновляется отдельно и часто (см. updateMediaPosition), а метаданные
 * — только когда правда сменились: пересборка MediaMetadata на каждый тик
 * заставляет систему перерисовывать карточку и мигать обложкой.
 */
export function setMediaNow(now: MediaNow | null) {
  const ms = session()
  if (!ms) return
  if (!now) {
    lastKey = ''
    curPos = null
    try { ms.playbackState = 'none' } catch { /* не поддерживается */ }
    try { ms.metadata = null } catch { /* не поддерживается */ }
    return
  }
  const key = mediaKey(now)
  if (key !== lastKey) {
    lastKey = key
    try {
      const MM = (window as any).MediaMetadata
      if (MM) {
        ms.metadata = new MM({
          title: now.title || 'Ponoi Music',
          artist: now.artist || '',
          album: now.album || 'Ponoi Music',
          // Несколько размеров одной и той же картинки: система сама выберет,
          // что ей нужно для шторки и что для экрана блокировки.
          // v1.443.0: без обложки отдаём значок приложения — пустой список
          // означает «нарисуй что хочешь», и в шторке был серый прямоугольник.
          artwork: mediaArtwork(now.art),
        })
      }
    } catch { /* движок не знает MediaMetadata — карточки просто не будет */ }
  }
  try { ms.playbackState = now.playing ? 'playing' : 'paused' } catch { /* не поддерживается */ }
  updateMediaPosition(now.pos, now.dur)
}

/**
 * Обновить полосу в системной карточке.
 *
 * Позиция обязана быть не больше длительности: иначе браузер бросает ошибку и
 * молча перестаёт обновлять карточку вовсе — это ловится только по тому, что
 * полоса в шторке однажды застыла.
 */
export function updateMediaPosition(pos?: number, dur?: number) {
  const ms = session()
  if (!ms || typeof ms.setPositionState !== 'function') return
  curPos = typeof pos === 'number' && isFinite(pos) ? Math.max(0, pos) : null
  const st = mediaPos(pos, dur)
  try {
    if (!st) { ms.setPositionState({}); return }
    ms.setPositionState(st)
  } catch { /* значения не понравились — не беда, карточка просто без полосы */ }
}
