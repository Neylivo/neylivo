
// v1.100.0: красный кружок с числом непрочитанного на иконке приложения — как в Discord.
// Считаем новые ЛИЧНЫЕ сообщения и @упоминания на серверах. Счётчики по источникам
// («dm:<threadId>» / «srv:<serverId>») — кружок гаснет по мере прочтения источников.
// Куда рисуем: Windows-десктоп — overlay-иконка на панели задач (через IPC в main-процесс),
// PWA/веб — системный Badging API + число в заголовке вкладки «(3) Ponoi».

const counts: Record<string, number> = {}
let activeDm: string | null = null

/** Открытый сейчас диалог ЛС: его входящие кружок не увеличивают, а счётчик сбрасывается. */
export function setActiveDm(threadId: string | null) {
  activeDm = threadId
  if (threadId) clearBadgeKey('dm:' + threadId)
}

/** Новое личное сообщение в диалоге. */
export function bumpDm(threadId: string) {
  if (threadId === activeDm && document.visibilityState === 'visible' && document.hasFocus()) return
  counts['dm:' + threadId] = (counts['dm:' + threadId] ?? 0) + 1
  apply()
}

/** @упоминание меня в сообщении на сервере. */
export function bumpMention(serverId: string) {
  counts['srv:' + serverId] = (counts['srv:' + serverId] ?? 0) + 1
  apply()
}

/** Источник прочитан (открыли диалог/сервер) — снимаем его вклад в кружок. */
export function clearBadgeKey(key: string) {
  if (!counts[key]) return
  delete counts[key]
  apply()
}

/** v1.101.0: входящий звонок в ЛС — горит на кружке, пока звонит; принял/отклонил/пропустил — гаснет. */
export function setCallBadge(threadId: string, on: boolean) {
  const key = 'call:' + threadId
  if (on) {
    if (counts[key]) return
    counts[key] = 1
    apply()
  } else clearBadgeKey(key)
}

function total(): number {
  let n = 0
  for (const k of Object.keys(counts)) n += counts[k]
  return n
}

function drawBadge(n: number): string {
  const c = document.createElement('canvas')
  c.width = 32; c.height = 32
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(16, 16, 16, 0, Math.PI * 2); g.fillStyle = '#f23f43'; g.fill()
  g.fillStyle = '#fff'
  g.font = n > 9 ? 'bold 16px Arial' : 'bold 20px Arial'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(n > 9 ? '9+' : String(n), 16, 17)
  return c.toDataURL('image/png')
}

// v1.186.0: тот же кружок, что и на панели задач, но на иконке в трее — работает
// и когда окно свёрнуто туда (у overlay-иконки таскбара в этот момент нет кнопки,
// на которой рисовать, — кружок пропадал ровно тогда, когда нужнее всего).
// Рисуем сами: берём текущую иконку приложения (свою — если сменили в настройках,
// иначе бандловую /icon.png) и кладём поверх неё тот же красный кружок с числом.
let trayBaseCache: { src: string; img: HTMLImageElement } | null = null
async function loadTrayBase(): Promise<HTMLImageElement> {
  const d = (window as any).ponoiDesktop
  const src = (await d?.getTrayIconBase?.()) || '/icon.png'
  if (trayBaseCache && trayBaseCache.src === src) return trayBaseCache.img
  const img = new Image()
  img.src = src
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject })
  trayBaseCache = { src, img }
  return img
}
async function drawTrayIcon(n: number): Promise<string | null> {
  try {
    const base = await loadTrayBase()
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const g = c.getContext('2d')!
    g.drawImage(base, 0, 0, 64, 64)
    if (n > 0) {
      g.beginPath(); g.arc(48, 48, 16, 0, Math.PI * 2); g.fillStyle = '#f23f43'; g.fill()
      g.strokeStyle = '#2b2d31'; g.lineWidth = 3; g.stroke()
      g.fillStyle = '#fff'
      g.font = n > 9 ? 'bold 15px Arial' : 'bold 18px Arial'
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(n > 9 ? '9+' : String(n), 48, 49)
    }
    return c.toDataURL('image/png')
  } catch { return null }
}
let trayGen = 0

function apply() {
  const n = total()
  // Заголовок вкладки (веб): «(3) Ponoi».
  try { document.title = n > 0 ? '(' + (n > 99 ? '99+' : n) + ') Ponoi' : 'Ponoi' } catch {}
  // Системный бейдж PWA (телефоны/установленный веб) — Badging API.
  try {
    const nav = navigator as any
    if (typeof nav.setAppBadge === 'function') { n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge() }
  } catch {}
  // Windows-десктоп: overlay-иконка на панели задач + иконка в трее (пока окно там).
  try {
    const d = (window as any).ponoiDesktop
    if (d?.setBadge) d.setBadge(n > 0 ? drawBadge(n) : null, n)
    if (d?.setTrayIcon) {
      const gen = ++trayGen
      drawTrayIcon(n).then(url => { if (url && gen === trayGen) d.setTrayIcon(url) })
    }
  } catch {}
}
