import { useEffect, useState } from 'react'
import { getSettings } from './settings'

// v1.100.0: красный кружок с числом непрочитанного на иконке приложения — как в Discord.
// Считаем новые ЛИЧНЫЕ сообщения и @упоминания на серверах. Счётчики по источникам
// («dm:<threadId>» / «srv:<serverId>») — кружок гаснет по мере прочтения источников.
// Куда рисуем: Windows-десктоп — overlay-иконка на панели задач (через IPC в main-процесс),
// PWA/веб — системный Badging API + число в заголовке вкладки «(3) Ponoi».
//
// v1.203.0: у заглушенных ЛС и обычных (не-упоминание) сообщений на сервере раньше
// не было вообще никакого следа на иконке — только полноценный красный кружок с
// числом (заглушенное ЛС) или его полное отсутствие (не-упоминание). Как в Discord —
// добавлен второй уровень: простая белая точка без числа для «что-то было, но не
// срочно», не увеличивающая счётчик. Идёт по отдельному набору ключей (softKeys) —
// не участвует в total(), так что число в кружке/заголовке/PWA-бейдже от неё не растёт.
//
// v1.204.0: кружок/точка на иконке в трее и на панели задач (Windows) раньше просто
// появлялись мгновенно. Теперь при КАЖДОМ росте (новое сообщение — не при снятии)
// рисуется короткая серия кадров растущего круга с лёгким перехлёстом («вылупляется
// из маленького взрыва») перед тем, как осесть на итоговом кружке/точке — то же,
// что кладётся в setBadge/setTrayIcon, только несколько кадров подряд вместо одного.

const counts: Record<string, number> = {}
const softKeys = new Set<string>()
let activeDm: string | null = null

// v1.212.0: раньше counts был чисто внутренним для трея/панели задач — теперь
// красные бейджики с числом нужны и прямо в интерфейсе (иконки серверов, как в
// мобильном Discord), так что счётчик по ключу должен быть читаем из React.
const listeners = new Set<() => void>()
export function subscribeBadges(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn) }
/** Число непрочитанных (упоминаний) для ключа вида 'srv:<id>' / 'dm:<id>'. 0, если нет. */
export function getBadgeCount(key: string): number { return counts[key] ?? 0 }

/** Реактивный счётчик для рендера красного бейджика на иконке сервера/ЛС. */
export function useBadgeCount(key: string): number {
  const [n, setN] = useState(() => getBadgeCount(key))
  useEffect(() => {
    setN(getBadgeCount(key))
    return subscribeBadges(() => setN(getBadgeCount(key)))
  }, [key])
  return n
}

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

function bumpSrv(serverId: string) {
  counts['srv:' + serverId] = (counts['srv:' + serverId] ?? 0) + 1
  apply()
}

/** @упоминание меня в сообщении на сервере. */
export function bumpMention(serverId: string) { bumpSrv(serverId) }

// v1.269.0: обычное (без упоминания) сообщение раньше давало только белую точку
// без числа (bumpSoft) — как в Discord для десктопа. Пользователь попросил такой
// же кружок с числом, как у упоминаний, и для обычных непрочитанных тоже —
// пишем в тот же counts['srv:<id>'], так что SrvPingBadge и итог на иконке
// приложения/трее сами получают верное число без отдельной логики.
/** Обычное сообщение на сервере (без упоминания), которое я ещё не видел. */
export function bumpUnread(serverId: string) { bumpSrv(serverId) }

/** Тихая точка без числа: заглушенное ЛС или сообщение на сервере без упоминания меня. */
export function bumpSoft(key: string) {
  if (softKeys.has(key)) return
  softKeys.add(key)
  apply()
}

/** Источник прочитан (открыли диалог/сервер) — снимаем и число, и точку. */
export function clearBadgeKey(key: string) {
  const had = !!counts[key] || softKeys.has(key)
  if (!had) return
  delete counts[key]
  softKeys.delete(key)
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

// scale — текущий кадр «взрыва»: 0 в начале, >1 на перехлёсте, 1 в покое.
function drawBadge(n: number, scale = 1): string {
  const c = document.createElement('canvas')
  c.width = 32; c.height = 32
  const g = c.getContext('2d')!
  const r = 16 * scale
  if (r > 0.5) {
    g.beginPath(); g.arc(16, 16, r, 0, Math.PI * 2); g.fillStyle = '#f23f43'; g.fill()
    if (scale > 0.55) {
      g.fillStyle = '#fff'
      g.font = 'bold ' + Math.round((n > 9 ? 16 : 20) * scale) + 'px Arial'
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(n > 9 ? '9+' : String(n), 16, 17)
    }
  }
  return c.toDataURL('image/png')
}

// Простая белая точка без числа — «что-то было, но не срочно» (тот же смысл, что у
// .unread-dot в левой колонке серверов, но на иконке приложения/трея).
function drawDot(scale = 1): string {
  const c = document.createElement('canvas')
  c.width = 32; c.height = 32
  const g = c.getContext('2d')!
  const r = 10 * scale
  if (r > 0.5) { g.beginPath(); g.arc(16, 16, r, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill() }
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
async function drawTrayIcon(n: number, soft: boolean, scale = 1): Promise<string | null> {
  try {
    const base = await loadTrayBase()
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const g = c.getContext('2d')!
    g.drawImage(base, 0, 0, 64, 64)
    if (n > 0) {
      const r = 16 * scale
      if (r > 0.5) {
        g.beginPath(); g.arc(48, 48, r, 0, Math.PI * 2); g.fillStyle = '#f23f43'; g.fill()
        g.strokeStyle = '#2b2d31'; g.lineWidth = 3; g.stroke()
        if (scale > 0.55) {
          g.fillStyle = '#fff'
          g.font = 'bold ' + Math.round((n > 9 ? 15 : 18) * scale) + 'px Arial'
          g.textAlign = 'center'; g.textBaseline = 'middle'
          g.fillText(n > 9 ? '9+' : String(n), 48, 49)
        }
      }
    } else if (soft) {
      const r = 10 * scale
      if (r > 0.5) {
        g.beginPath(); g.arc(48, 48, r, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill()
        g.strokeStyle = '#2b2d31'; g.lineWidth = 3; g.stroke()
      }
    }
    return c.toDataURL('image/png')
  } catch { return null }
}

// Кадры «взрыва»: быстрый рост с небольшим перехлёстом (1.2), потом усадка на
// место — тот самый эффект «рождается из мелкого взрыва», ~200мс на весь кружок.
const POP_FRAMES = [0.12, 0.45, 0.8, 1.2, 1]
let animGen = 0
let trayGen = 0

async function playPop(n: number, soft: boolean) {
  const gen = ++animGen
  const d = (window as any).ponoiDesktop
  if (!d?.setBadge && !d?.setTrayIcon) return
  for (const scale of POP_FRAMES) {
    if (gen !== animGen) return   // догнало более новое изменение — не мешаем ему кадрами похуже
    try { d.setBadge?.(n > 0 ? drawBadge(n, scale) : (soft ? drawDot(scale) : null), n) } catch {}
    try {
      if (d.setTrayIcon) {
        const url = await drawTrayIcon(n, soft, scale)
        if (url && gen === animGen) d.setTrayIcon(url)
      }
    } catch {}
    await new Promise(r => setTimeout(r, 45))
  }
}

let prevSignal = 0   // total() * 2 + (мягкая точка ? 1 : 0) — растёт при любом новом «событии»
function apply() {
  // v1.269.0: настройка «Счётчик на иконке» (Настройки -> Уведомления) была
  // заведена ещё в v1.100.0, но нигде не читалась — выключить её было нельзя.
  // Скрывает ЧИСЛО именно на иконке приложения/трее/заголовке вкладки (не в
  // самом интерфейсе — там SrvPingBadge/DmPingBadge всегда с числом): при
  // выключенном тумблере вместо числа остаётся обычная тихая точка «есть новое».
  const rawN = total()
  const n = getSettings().unreadBadge ? rawN : 0
  const soft = !n && (softKeys.size > 0 || rawN > 0)
  const signal = n * 2 + (soft ? 1 : 0)
  const grew = signal > prevSignal
  prevSignal = signal
  // Заголовок вкладки (веб): «(3) Ponoi». Тихая точка число не показывает.
  try { document.title = n > 0 ? '(' + (n > 99 ? '99+' : n) + ') Ponoi' : 'Ponoi' } catch {}
  // Системный бейдж PWA (телефоны/установленный веб) — Badging API. Вызов без
  // аргумента показывает просто точку без числа (часть спецификации Badging API) —
  // ровно то, что нужно для «тихого» состояния. Своей анимации у Badging API нет —
  // рисуем «взрыв» только там, где сами рисуем пиксели (трей/панель задач ниже).
  try {
    const nav = navigator as any
    if (typeof nav.setAppBadge === 'function') {
      if (n > 0) nav.setAppBadge(n)
      else if (soft) nav.setAppBadge()
      else nav.clearAppBadge()
    }
  } catch {}
  // Windows-десктоп: overlay-иконка на панели задач + иконка в трее (пока окно там).
  try {
    const d = (window as any).ponoiDesktop
    if (n === 0 && !soft) {
      // Снятие (зашли в чат/сервер) — сразу гасим, без анимации.
      animGen++   // отменяем недоигранный «взрыв», если он ещё шёл
      if (d?.setBadge) d.setBadge(null, 0)
      if (d?.setTrayIcon) {
        const gen = ++trayGen
        drawTrayIcon(0, false).then(url => { if (url && gen === trayGen) d.setTrayIcon(url) })
      }
    } else if (grew) {
      playPop(n, soft)
    } else {
      // Число уменьшилось (закрыли один из нескольких открытых источников) —
      // тоже без анимации, просто перерисовываем итоговый кадр.
      if (d?.setBadge) d.setBadge(n > 0 ? drawBadge(n) : drawDot(), n)
      if (d?.setTrayIcon) {
        const gen = ++trayGen
        drawTrayIcon(n, soft).then(url => { if (url && gen === trayGen) d.setTrayIcon(url) })
      }
    }
  } catch {}
  listeners.forEach(fn => { try { fn() } catch {} })
}
