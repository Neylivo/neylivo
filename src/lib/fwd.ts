// Пересланные сообщения — без миграции БД: кодируются в content невидимым
// маркером U+2063 (тот же приём, что и системные сообщения в sysmsg.ts, но тип «fwd»).
// Формат: \u2063fwd:<encodeURIComponent(автор)>:<ISO-время>\u2063<текст оригинала>
const M = '\u2063'

export interface FwdMsg { author: string; at: string; text: string }

export function fwdMark(author: string, at: string, text: string): string {
  return M + 'fwd:' + encodeURIComponent(author) + ':' + at + M + text
}

export function parseFwd(content?: string | null): FwdMsg | null {
  if (!content || !content.startsWith(M)) return null
  const end = content.indexOf(M, 1)
  if (end < 0) return null
  const head = content.slice(1, end).split(':')
  if (head[0] !== 'fwd') return null
  return {
    author: decodeURIComponent(head[1] || ''),
    at: head.slice(2).join(':'), // в ISO-времени есть двоеточия — собираем обратно
    text: content.slice(end + 1),
  }
}

// v1.508.0: пересылка пачкой — подписи считает одна функция на все места.
//
// Владелец: «при выборе сообщений кроме удаления можно ещё и переслать».
// Числа тут расходятся легче всего: выбрано пять сообщений, отмечено три
// получателя — и в заголовке, на кнопке и в ответе должны стоять РАЗНЫЕ числа,
// каждое про своё. Разошлись бы они молча, поэтому считаются здесь.

/** Русские окончания для сообщений: 1 сообщение, 2 сообщения, 5 сообщений. */
export function ruMessages(n: number): string {
  const d = n % 100
  if (d >= 11 && d <= 14) return 'сообщений'
  const r = n % 10
  return r === 1 ? 'сообщение' : r >= 2 && r <= 4 ? 'сообщения' : 'сообщений'
}

/** Заголовок окна пересылки. */
export function fwdTitle(писем: number): string {
  return писем > 1 ? 'Переслать ' + писем + ' ' + ruMessages(писем) : 'Переслать сообщение'
}

/** Что сказать после отправки: сколько писем и скольким адресатам. */
export function fwdDone(писем: number, адресатов: number): string {
  const что = писем > 1 ? писем + ' ' + ruMessages(писем) : 'сообщение'
  const куда = адресатов > 1 ? ' в ' + адресатов + ' ' + (адресатов % 10 === 1 && адресатов % 100 !== 11 ? 'место' : 'мест' + (адресатов % 10 >= 2 && адресатов % 10 <= 4 && (адресатов % 100 < 12 || адресатов % 100 > 14) ? 'а' : '')) : ''
  return 'Переслано ' + что + куда
}
