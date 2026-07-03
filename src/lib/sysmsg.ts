// Системные сообщения в ленте («X закрепил сообщение») — без миграции БД:
// кодируются в content невидимым маркером U+2063 (invisible separator).
// Формат: \u2063sys:<type>:<targetId>\u2063<preview>
const SYS = '\u2063'

export interface SysMsg { type: string; targetId: string; preview: string }

export function sysPin(targetId: string, preview: string): string {
  return SYS + 'sys:pin:' + targetId + SYS + preview
}

export function parseSys(content?: string | null): SysMsg | null {
  if (!content || !content.startsWith(SYS)) return null
  const end = content.indexOf(SYS, 1)
  if (end < 0) return null
  const head = content.slice(1, end).split(':')
  if (head[0] !== 'sys') return null
  return { type: head[1] || '', targetId: head[2] || '', preview: content.slice(end + 1) }
}
