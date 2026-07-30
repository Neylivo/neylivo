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
  const key = [now.title, now.artist, now.album ?? '', now.art ?? ''].join('|')
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
          artwork: now.art
            ? [96, 192, 384, 512].map(px => ({ src: now.art as string, sizes: `${px}x${px}`, type: 'image/jpeg' }))
            : [],
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
  const d = typeof dur === 'number' && isFinite(dur) && dur > 0 ? dur : 0
  try {
    if (!d) { ms.setPositionState({}); return }
    ms.setPositionState({ duration: d, position: Math.min(curPos ?? 0, d), playbackRate: 1 })
  } catch { /* значения не понравились — не беда, карточка просто без полосы */ }
}
