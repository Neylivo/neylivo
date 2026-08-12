// v1.444.0: музыка не обрывается, когда приложение свёрнуто.
//
// Что было. NeyLivo Music держался на одном Media Session: система показывала
// карточку в шторке, но сам процесс приложения оставался обычным. Свернул
// приложение, открыл пару других — и Android при нехватке памяти вправе его
// прибрать. Музыка обрывалась на полуслове, и виноватым выглядело приложение,
// хотя оно ничего неправильного не делало. Об этом было честно написано прямо
// в src/music/mediaSession.ts: «настоящей постоянной службы нет».
//
// Как теперь. Пока идёт воспроизведение, включается постоянная служба
// (android/app/src/main/java/com/ponoi/app/MusicService.java): для системы это
// значит «у процесса есть видимая задача», и такие убивают в последнюю очередь.
// Служба ничего не играет сама и в проигрыватель не лезет — она только не даёт
// его выгрузить.
//
// Про разрешение на уведомления. С Android 13 без него служба на переднем плане
// не поднимется. Мы НЕ спрашиваем его при запуске приложения: спрашивать
// «можно уведомления?» у того, кто ещё ничего не включил, — верный способ
// получить отказ навсегда, а второго окна система не покажет. Спрашиваем ровно
// один раз и ровно тогда, когда человек первый раз свернул приложение с
// играющей музыкой: в этот момент просьба понятна.
//
// Решение принимает keepAliveAction — она же и только она. Иначе вышло бы
// привычное расхождение: одно место считает, что служба нужна, другое её
// выключает.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).
import { registerPlugin } from '@capacitor/core'

export type KeepAliveState = {
  /** Приложение на Android (в браузере службы нет и не нужно). */
  native: boolean
  /** Идёт воспроизведение. */
  playing: boolean
  /** Есть что играть — иначе держать процесс не за чем. */
  hasTrack: boolean
  /** Приложение свёрнуто. */
  hidden: boolean
  /** Разрешены ли уведомления. */
  allowed: boolean
  /** Разрешение уже спрашивали (второго окна система не покажет). */
  askedBefore: boolean
}

/**
 * `start` — играем: карточка и защита процесса от выгрузки.
 * `show`  — на паузе: карточка остаётся, но процесс больше не держим.
 * `stop`  — играть нечего: карточку убрать.
 */
export type KeepAliveAction = 'start' | 'show' | 'stop' | 'ask' | 'idle'

export function keepAliveAction(s: KeepAliveState): KeepAliveAction {
  if (!s.native) return 'idle'
  if (!s.hasTrack) return 'stop'
  // v1.502.0: пауза больше НЕ снимает карточку.
  //
  // Раньше здесь стояло `if (!s.playing) return 'stop'`, и владелец описал
  // последствие точно: поставил песню на паузу, свернул NeyLivo Music — и в
  // шторке нет ничего, продолжить нечем, надо лезть в приложение. Так себя не
  // ведёт ни один музыкальный сервис: у Spotify карточка на паузе остаётся,
  // на ней и нажимают «играть».
  //
  // Но и держать процесс незакрываемым на паузе неправильно — музыки нет, а
  // память занята. Поэтому состояний стало два: играем — служба на переднем
  // плане, встали — карточка живёт, передний план отпущен.
  if (s.allowed) return s.playing ? 'start' : 'show'
  // Разрешения нет. Просим только у свёрнутого приложения с играющей музыкой и
  // только один раз: пока приложение на экране, система его не выгружает, а
  // спрашивать «можно уведомления?» без повода — верный отказ навсегда.
  if (s.playing && s.hidden && !s.askedBefore) return 'ask'
  return 'idle'
}

const ASKED_KEY = 'ponoi_notify_asked'

export function keepAliveAsked(): boolean {
  try { return localStorage.getItem(ASKED_KEY) === '1' } catch { return false }
}
export function markKeepAliveAsked() {
  try { localStorage.setItem(ASKED_KEY, '1') } catch { /* приватный режим */ }
}

/** Что показать на системной карточке. Ровно то же, что видно в плеере. */
export interface KeepAliveNow {
  title?: string
  artist?: string
  /** Откуда трек — уходит третьей строкой карточки. */
  album?: string
  /** Обложка: обычная ссылка или data:. Пусто — значок приложения. */
  art?: string | null
  /** Идёт ли воспроизведение: от этого зависит вид кнопки и передний план. */
  playing?: boolean
  /** Длительность и позиция В СЕКУНДАХ — по ним система рисует полосу. */
  dur?: number
  pos?: number
}

/** Что система прислала обратно с карточки, наушников или экрана блокировки. */
export type MediaKey =
  | { action: 'play' | 'pause' | 'next' | 'prev' | 'stop' }
  | { action: 'seek'; sec: number }

/**
 * Разобрать пришедшее с той стороны моста. null — не наше, молча пропускаем.
 *
 * Отдельной функцией — потому что через мост приходит что угодно: и чужие
 * события, и наши будущие, о которых эта версия приложения ещё не знает. Гнать
 * такое в проигрыватель нельзя, а проверить разбор иначе нечем — самого моста
 * нигде, кроме телефона, нет.
 */
export function parseMediaKey(d: unknown): MediaKey | null {
  const o = (d ?? {}) as { action?: unknown; sec?: unknown }
  const a = typeof o.action === 'string' ? o.action : ''
  if (a === 'play' || a === 'pause' || a === 'next' || a === 'prev' || a === 'stop') return { action: a }
  if (a === 'seek') {
    const sec = Number(o.sec)
    return { action: 'seek', sec: isFinite(sec) && sec > 0 ? sec : 0 }
  }
  return null
}

/**
 * Отдавать ли системе позицию заново.
 *
 * Полосу в карточке система двигает САМА — по времени и скорости из последнего
 * состояния. Слать позицию каждую секунду значит дёргать мост шестьдесят раз в
 * минуту без всякой пользы. Но перемотку иначе не заметить: у системы полоса
 * поедет со старого места.
 *
 * Поэтому сравнивается ожидаемое время с настоящим. Разошлись больше чем на
 * две секунды — значит перемотали (сами, с полосы, из текста песни или из
 * общего прослушивания), и карточку надо пересобрать.
 *
 * @param было  что отдали в прошлый раз и когда (мс)
 * @param стало текущее время трека в секундах
 * @param играет идёт ли воспроизведение — на паузе ожидание не растёт
 * @param сейчас текущее время (мс)
 */
export function mediaSeeked(
  было: { pos: number; at: number } | null,
  стало: number,
  играет: boolean,
  сейчас: number,
): boolean {
  if (!было || !было.at) return false
  const ждём = было.pos + (играет ? (сейчас - было.at) / 1000 : 0)
  return Math.abs(стало - ждём) > 2
}

interface KeepAlivePlugin {
  canNotify(): Promise<{ value: boolean }>
  requestNotify(): Promise<void>
  start(o: KeepAliveNow & { foreground?: boolean }): Promise<{ value: boolean }>
  stop(): Promise<void>
  addListener(event: 'mediaKey', cb: (d: { action: string; sec?: number }) => void): Promise<unknown>
}
const Native = registerPlugin<KeepAlivePlugin>('MusicKeepAlive')

/** Разрешены ли уведомления. При любом сбое — «нет»: тогда служба просто не
 *  поднимется, и это безопаснее, чем считать разрешённым то, что запрещено. */
export async function canKeepAlive(): Promise<boolean> {
  try { return (await Native.canNotify()).value } catch { return false }
}

export async function askKeepAlive(): Promise<void> {
  markKeepAliveAsked()
  try { await Native.requestNotify() } catch { /* окна не будет — переживём */ }
}

/**
 * Показать (или обновить) системную карточку.
 *
 * `foreground` — держать ли процесс незакрываемым. Играем — да, на паузе — нет:
 * карточка при этом остаётся, но память под ней не держится.
 *
 * false в ответе — не вышло; музыка при этом играет как раньше, просто без
 * карточки и без защиты от выгрузки, и пугать этим человека незачем.
 */
export async function startKeepAlive(now: KeepAliveNow, foreground = true): Promise<boolean> {
  try { return (await Native.start({ ...now, foreground })).value } catch { return false }
}

export async function stopKeepAlive(): Promise<void> {
  try { await Native.stop() } catch { /* службы и так нет */ }
}

/**
 * Подписаться на кнопки системной карточки.
 *
 * Зачем это отдельно от navigator.mediaSession. В обычном браузере системную
 * карточку рисует сам движок по данным Media Session, и нажатия приходят туда
 * же. В нашем приложении на Android страница живёт в WebView, а WebView такой
 * карточки НЕ показывает вовсе — её рисует наша служба, и нажатия приходят
 * оттуда. Обработчики те же самые, разный только путь.
 *
 * Возвращает отписку.
 */
export function onMediaKey(cb: (k: MediaKey) => void): () => void {
  let off: (() => void) | null = null
  let отписались = false
  void (async () => {
    try {
      const h = await Native.addListener('mediaKey', d => {
        const k = parseMediaKey(d)
        if (k) cb(k)
      })
      const снять = (h as { remove?: () => void })?.remove
      if (отписались) снять?.call(h)
      else off = () => снять?.call(h)
    } catch { /* не Android — кнопок неоткуда взяться */ }
  })()
  return () => { отписались = true; off?.() }
}
