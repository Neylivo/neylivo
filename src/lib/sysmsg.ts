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

// v1.68.0: приглашение на сервер в ЛС — карточка с кнопкой «Присоединиться».
// v1.81.0: карточка 1-в-1 как в Discord — в preview вшивается JSON-снапшот
// сервера (иконка, баннер, описание, участники, «в сети», дата основания),
// потому что получатель до вступления не может читать сервер из-за RLS.
// Старые сообщения, где preview — просто имя сервера, читаются как раньше.
export interface InviteMeta { ic?: string | null; bn?: string | null; d?: string | null; m?: number; o?: number; c?: string | null }
export function sysInvite(code: string, serverName: string, meta?: InviteMeta): string {
  const body = meta ? JSON.stringify({ n: serverName, ...meta }) : serverName
  return SYS + 'sys:invite:' + code + SYS + body
}
export function parseInviteMeta(preview: string): { n: string } & InviteMeta {
  if (preview.startsWith('{')) { try { const j = JSON.parse(preview); if (j && typeof j.n === 'string') return j } catch {} }
  return { n: preview }
}

// v1.180.0: карточка «Игровой Экспресс» в чате — тот же приём, что у sysInvite:
// лёгкое превью (для чего sha1-список модов НЕ нужен) прямо в сообщении, сам
// манифест — по id в quicklaunch_packs (см. src/lib/quicklaunch.ts).
export interface QlSysMeta { game: string; mcVersion: string; loader: string; modCount: number; totalMb: number }
export function sysQuickLaunch(packId: string, meta: QlSysMeta): string {
  return SYS + 'sys:qlaunch:' + packId + SYS + JSON.stringify(meta)
}
export function parseQuickLaunchMeta(preview: string): QlSysMeta | null {
  try { const j = JSON.parse(preview); if (j && typeof j.game === 'string') return j } catch {}
  return null
}

// v1.184.0: «Поделиться игрой» для игр без установочного пайплайна (Roblox и
// т.п.) — просто join-ссылка, без скачивания/скана (в отличие от sysQuickLaunch
// выше, который для Minecraft-сборок). Та же схема: targetId — тип игры, preview — JSON.
export interface GameLinkMeta { game: string; label?: string | null; url: string }
export function sysGameLink(game: string, meta: GameLinkMeta): string {
  return SYS + 'sys:glink:' + game + SYS + JSON.stringify(meta)
}
export function parseGameLinkMeta(preview: string): GameLinkMeta | null {
  try { const j = JSON.parse(preview); if (j && typeof j.url === 'string') return j } catch {}
  return null
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
/** «несколько секунд» / «минута» / «5 минут» / «1 час 12 минут» — как пишет Discord. */
export function fmtCallDur(sec: number): string {
  if (sec < 60) return 'несколько секунд'
  const m = Math.round(sec / 60)
  if (m < 60) return m + ' ' + ruPlural(m, 'минута', 'минуты', 'минут')
  const h = Math.floor(m / 60), rem = m % 60
  return h + ' ' + ruPlural(h, 'час', 'часа', 'часов') + (rem ? ' ' + rem + ' ' + ruPlural(rem, 'минута', 'минуты', 'минут') : '')
}
