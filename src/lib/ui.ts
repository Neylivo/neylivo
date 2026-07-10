
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

export function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === y.toDateString()) return 'Вчера'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
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

// Discord-style время сообщения: сегодня — просто время; иначе — короткая дата
// плюс время рядом (год добавляется, только если сообщение не из текущего года).
export function msgTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return timeShort(iso)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts) + ', ' + timeShort(iso)
}
