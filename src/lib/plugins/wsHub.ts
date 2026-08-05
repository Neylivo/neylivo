// v1.465.0: постоянное соединение для плагинов.
//
// Зачем. net.fetch — это «спросил и забыл», net.stream — «спросил и слушаю
// ответ». Оба начинает плагин. А есть задачи, где начинает ЧУЖАЯ сторона: чат
// Twitch, домашняя автоматика, игровой сервер, бот с моментальным откликом.
// Опрашивать такое по таймеру — значит опаздывать на секунды и жечь батарею.
//
// Как устроено. Сам WebSocket живёт ЗДЕСЬ, в приложении, а не в воркере плагина:
// в песочнице WebSocket вырезан вместе с fetch (см. bootstrap.ts, список KILL) —
// именно для того, чтобы плагин не мог выйти в сеть мимо проверки домена.
// Плагин получает не соединение, а его НОМЕР, и шлёт по нему через приложение.
//
// Что из этого следует: адрес проверяется тем же checkTarget, что и обычный
// запрос (netGuard.ts), соединения считаются, а при остановке плагина
// закрываются все до одного — иначе выключенный плагин продолжал бы слушать сеть.

import { checkTarget, type NetTarget } from './netGuard'

/** Сколько соединений разом на плагин. Больше — это уже не интеграция. */
/** Сколько знаков в одном отправляемом сообщении. */
/** Сколько знаков берём из входящего: остальное режется, а не роняет вкладку. */

export class WsError extends Error {}

interface Sock {
  pluginId: string
  ws: WebSocket
  url: string
}

const socks = new Map<number, Sock>()
let seq = 0

export interface WsEvents {
  onOpen: () => void
  /** Пришло сообщение. Только текст: двоичные кадры плагину не отдаём — их
   *  всё равно не переслать через postMessage без лишних сложностей, а для
   *  задач, ради которых это делалось, хватает текста. */
  onMessage: (text: string) => void
  onClose: (code: number, reason: string) => void
}

export function countFor(pluginId: string): number {
  let n = 0
  for (const [, s] of socks) if (s.pluginId === pluginId) n++
  return n
}

/**
 * Открыть соединение. Возвращает номер, по которому плагин шлёт и закрывает.
 *
 * Проверка адреса — до создания сокета: браузер иначе успел бы постучаться
 * туда, куда нельзя, ещё до того, как мы скажем «нельзя».
 */
export function openSocket(pluginId: string, rawUrl: string, target: NetTarget, ev: WsEvents): number {
  const bad = checkTarget(rawUrl, target, 'wss:')
  if (bad) throw new WsError(bad)
  const url = String(rawUrl)
  let ws: WebSocket
  try { ws = new WebSocket(url) } catch (e: any) { throw new WsError('Не удалось открыть соединение: ' + (e?.message ?? e)) }

  const id = ++seq
  socks.set(id, { pluginId, ws, url })

  ws.onopen = () => ev.onOpen()
  ws.onmessage = e => {
    // Двоичное молча не отдаём как «[object Blob]»: пусть плагин видит пустоту
    // и не строит на этом логику.
    const d = e.data
    if (typeof d !== 'string') return
    // v1.489.0: пришедшее не обрезаем — сколько прислали, столько и отдадим.
    ev.onMessage(d)
  }
  const bye = (code: number, reason: string) => {
    if (!socks.has(id)) return    // уже закрыли — второй раз не сообщаем
    socks.delete(id)
    ev.onClose(code, reason)
  }
  ws.onclose = e => bye(e.code, String(e.reason || ''))
  // Ошибка соединения приходит отдельно от закрытия, но для плагина это одно и
  // то же событие: «связи больше нет». Браузер причину не сообщает намеренно.
  ws.onerror = () => { try { ws.close() } catch {} ; bye(1006, 'связь оборвалась') }
  return id
}

export function sendSocket(pluginId: string, id: number, data: unknown): boolean {
  const s = socks.get(id)
  if (!s) throw new WsError('Соединение уже закрыто')
  // Чужой номер — не «не найдено», а именно отказ: иначе плагин мог бы перебором
  // номеров писать в чужие соединения.
  if (s.pluginId !== pluginId) throw new WsError('Это соединение принадлежит другому плагину')
  if (s.ws.readyState !== WebSocket.OPEN) throw new WsError('Соединение ещё не открыто или уже закрывается')
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? null)
  s.ws.send(text)
  return true
}

export function closeSocket(pluginId: string, id: number): boolean {
  const s = socks.get(id)
  if (!s || s.pluginId !== pluginId) return false
  socks.delete(id)
  try { s.ws.close() } catch {}
  return true
}

/** Закрыть всё, что открыл плагин. Зовётся при его остановке: иначе выключенный
 *  плагин остался бы на связи с чужим сервером, а человек считал бы, что выключил. */
export function closeAllFor(pluginId: string) {
  for (const [id, s] of [...socks]) {
    if (s.pluginId !== pluginId) continue
    socks.delete(id)
    try { s.ws.close() } catch {}
  }
}

/** Аварийный режим: закрыть все соединения всех плагинов. */
export function closeAllSockets() {
  for (const [id, s] of [...socks]) {
    socks.delete(id)
    try { s.ws.close() } catch {}
  }
}

/** Для проверок и для экрана плагина: что сейчас открыто. */
export function openSockets(): { id: number; pluginId: string; url: string }[] {
  return [...socks].map(([id, s]) => ({ id, pluginId: s.pluginId, url: s.url }))
}
