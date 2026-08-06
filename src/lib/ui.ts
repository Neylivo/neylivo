
export const PALETTE = ['#5865f2', '#eb459e', '#3ba55d', '#faa61a', '#ed4245', '#9b59b6', '#1abc9c']
export function colorFor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
export const initial = (s: string) => (s || '?').slice(0, 1).toUpperCase()
let _time24 = true
export function setTime24(v: boolean) { _time24 = v }
export const timeShort = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: !_time24 })
// Точное время с секундами — для тултипа при наведении на время сообщения.
export const timeFull = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !_time24 })

// v1.187.0: для записей о звонках в истории — всегда полная дата+время (в отличие
// от msgTime, который прячет дату для «сегодня»): звонок — событие, к которому
// возвращаются, отсутствие даты уводит в контекст текущего дня без нужды.
export function callTime(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()} ${timeShort(iso)}`
}

/**
 * Сколько КАЛЕНДАРНЫХ дней назад. 0 — сегодня, 1 — вчера, 2 — позавчера.
 *
 * Именно календарных, а не по двадцать четыре часа. Сообщение, написанное вчера
 * в 23:50, остаётся вчерашним и в 00:10 — хотя прошло двадцать минут. И
 * наоборот: написанное двадцать часов назад бывает позавчерашним. Считать
 * разницу во времени и делить на сутки — самая частая ошибка в таких подписях,
 * и видна она только на границе полуночи.
 *
 * Будущее (сбитые часы на устройстве) даёт отрицательное число — такое считаем
 * сегодняшним, иначе вышло бы «Вчера» у того, что ещё не наступило.
 */
export function daysAgo(when: Date, now: Date = new Date()): number {
  const день = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return Math.round((день(now) - день(when)) / 86400000)
}

export function dayLabel(iso: string, now: Date = new Date()) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const дней = daysAgo(d, now)
  if (дней <= 0) return 'Сегодня'
  if (дней === 1) return 'Вчера'
  if (дней === 2) return 'Позавчера'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts)
}

// v1.81.0: числа и склонения для карточки-приглашения / превью сервера (как в Discord).
export const fmtN = (n: number) => n.toLocaleString('ru-RU')
export function ruMembers(n: number): string {
  const d = n % 100
  if (d >= 11 && d <= 14) return 'участников'
  const r = n % 10
  return r === 1 ? 'участник' : r >= 2 && r <= 4 ? 'участника' : 'участников'
}

/**
 * Время сообщения.
 *
 * Сегодня — просто время. Вчера и позавчера — словом и временем: «Вчера в
 * 21:13». Дальше — короткая дата плюс время, а год добавляется, только если
 * сообщение не из текущего года.
 *
 * v1.504.0: словами. До этого вчерашнее сообщение подписывалось «5 авг., 21:13»
 * — число приходилось сопоставлять с сегодняшним, чтобы понять, вчера это было
 * или на прошлой неделе. Владелец попросил прямо: вчера и позавчера — так и
 * писать.
 *
 * Точная дата никуда не делась — она в подсказке при наведении (timeFull).
 */
export function msgTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const дней = daysAgo(d, now)
  if (дней <= 0) return timeShort(iso)
  if (дней === 1) return 'Вчера в ' + timeShort(iso)
  if (дней === 2) return 'Позавчера в ' + timeShort(iso)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts) + ', ' + timeShort(iso)
}
