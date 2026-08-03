// v1.444.0: музыка не обрывается, когда приложение свёрнуто.
//
// Что было. Ponoi Music держался на одном Media Session: система показывала
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

export type KeepAliveAction = 'start' | 'stop' | 'ask' | 'idle'

export function keepAliveAction(s: KeepAliveState): KeepAliveAction {
  if (!s.native) return 'idle'
  if (!s.playing || !s.hasTrack) return 'stop'
  if (s.allowed) return 'start'
  // Музыка играет, разрешения нет. Просим только у свёрнутого приложения и
  // только один раз: до этого момента служба всё равно не нужна — пока
  // приложение на экране, система его не выгружает.
  if (s.hidden && !s.askedBefore) return 'ask'
  return 'idle'
}

const ASKED_KEY = 'ponoi_notify_asked'

export function keepAliveAsked(): boolean {
  try { return localStorage.getItem(ASKED_KEY) === '1' } catch { return false }
}
export function markKeepAliveAsked() {
  try { localStorage.setItem(ASKED_KEY, '1') } catch { /* приватный режим */ }
}

interface KeepAlivePlugin {
  canNotify(): Promise<{ value: boolean }>
  requestNotify(): Promise<void>
  start(o: { title?: string; artist?: string }): Promise<{ value: boolean }>
  stop(): Promise<void>
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

/** Включить службу. false — не вышло; музыка при этом играет как раньше, просто
 *  без защиты от выгрузки, и пугать этим человека незачем. */
export async function startKeepAlive(title?: string, artist?: string): Promise<boolean> {
  try { return (await Native.start({ title, artist })).value } catch { return false }
}

export async function stopKeepAlive(): Promise<void> {
  try { await Native.stop() } catch { /* службы и так нет */ }
}
