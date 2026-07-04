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
