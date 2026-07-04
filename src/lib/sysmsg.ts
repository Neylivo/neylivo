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

// ---- v1.43.0: системные сообщения о звонках в ЛС (как в Discord) ----
// «X начинает звонок.» вставляется при старте; по завершении звонящий
// редактирует его на итог: длительность или «пропущенный звонок».
export function sysCallStart(): string { return SYS + 'sys:call:start' + SYS }
export function sysCallEnded(sec: number): string { return SYS + 'sys:call:ended' + SYS + String(sec) }
export function sysCallMissed(sec: number): string { return SYS + 'sys:call:missed' + SYS + String(sec) }

/** «несколько секунд» / «5 мин» / «1 ч 12 мин» — как пишет Discord. */
export function fmtCallDur(sec: number): string {
  if (sec < 60) return 'несколько секунд'
  const m = Math.round(sec / 60)
  if (m < 60) return m + ' мин'
  return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'
}
