// Desktop notifications via the Web Notification API (no backend / service worker).
// Shows a native notification for an incoming message when the app is open but the
// tab is not focused. This is the "notifications" first step; true push (delivered
// when the app/tab is closed) would need a service worker + VAPID + a sender.
import { getSettings } from './settings'
import { getUserPrefs } from './userPrefs'
import { fmtNotification, type NotifyInput } from './notifyFormat'
import { openMsgLink } from './deepLink'

export function initNotifications() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  } catch {}
}

// v1.199.0: раньше icon никогда не передавался ни одним вызывающим — уведомление
// всегда показывалось с пустой/системной иконкой. Теперь есть дефолт (логотип
// Ponoi) и вызывающие передают аватар автора сообщения, если он есть под рукой.
const DEFAULT_ICON = '/icon.png'

// Открытые уведомления по тегу (обычно id канала/треда) — чтобы новое сообщение
// из ТОГО ЖЕ источника заменяло предыдущий тост, а не копилось второй-третьей
// плашкой поверх, и чтобы можно было закрыть его руками (closeNotif), когда
// пользователь сам открыл этот канал/чат, не дожидаясь автозакрытия по таймеру.
const openNotifs = new Map<string, Notification>()

/**
 * Сколько сообщений пришло из этого места, пока человек не смотрел (v1.440.0).
 *
 * Раньше каждое следующее сообщение из того же чата ПОЛНОСТЬЮ заменяло собой
 * предыдущее уведомление, и было не понять, пришло одно сообщение или двадцать.
 * Теперь считаем и дописываем «и ещё N».
 */
const pending = new Map<string, number>()

/** Куда идти по нажатию: тег -> ссылка вида ponoi://msg/... */
const routes = new Map<string, string>()

/**
 * Показать уведомление о сообщении (v1.440.0 — переписано).
 *
 * Что изменилось:
 *   • текст готовит одна функция (notifyFormat.ts), а не каждое место по-своему:
 *     из тела уходят служебные вставки, разметка и простыни на тысячу знаков;
 *   • нажатие ОТКРЫВАЕТ нужный чат, а не просто поднимает окно — раньше человек
 *     нажимал на уведомление и оставался там же, где был;
 *   • повторы из одного места считаются: «и ещё 3 сообщения»;
 *   • разрешение спрашивается при первом же уведомлении, если его ещё не
 *     спрашивали: раньше вопрос задавался один раз при запуске, и отказавшийся
 *     случайно оставался без уведомлений навсегда.
 */
export function notifyMessage(input: NotifyInput & { icon?: string | null; tag?: string; route?: string }) {
  try {
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') { Notification.requestPermission().catch(() => {}); return }
    if (Notification.permission !== 'granted') return
    // v1.332.0: тумблер «Системные уведомления» в настройках не читался ЗДЕСЬ и
    // нигде больше — то есть выключить их было нельзя, они показывались всегда.
    // Проверка стоит в одном месте, у самого показа: любой новый вызывающий
    // получает её даром и не может забыть.
    if (!getSettings().notifSystem) return
    // Only notify when the user isn't actively looking at the app.
    if (document.visibilityState === 'visible' && document.hasFocus()) return
    const tag = input.tag
    if (tag) { try { openNotifs.get(tag)?.close() } catch {} }
    const more = tag ? (pending.get(tag) ?? 0) : 0
    const { title, body } = fmtNotification({ ...input, more })
    if (tag) { pending.set(tag, more + 1); if (input.route) routes.set(tag, input.route) }
    const n = new Notification(title, {
      body, icon: input.icon || DEFAULT_ICON, tag,
      // renotify — чтобы система показала плашку ещё раз, а не молча подменила
      // текст уже показанной: иначе второе сообщение можно вовсе не заметить.
      ...(tag ? { renotify: true } as any : {}),
    })
    if (tag) openNotifs.set(tag, n)
    const forget = () => { if (tag && openNotifs.get(tag) === n) openNotifs.delete(tag) }
    n.onclick = () => {
      try { window.focus() } catch {}
      const route = input.route || (tag ? routes.get(tag) : undefined)
      if (route) { try { openMsgLink(route) } catch {} }
      if (tag) { pending.delete(tag); routes.delete(tag) }
      n.close()
    }
    n.onclose = forget
    setTimeout(() => { try { n.close() } catch {} ; forget() }, 8000)
  } catch {}
}

/** Закрыть уведомление по тегу руками — например, когда пользователь сам открыл этот канал/чат. */
export function closeNotif(tag: string) {
  // v1.440.0: заодно сбрасываем счётчик — человек открыл это место сам, и
  // «и ещё 3 сообщения» в следующем уведомлении было бы неправдой.
  try { openNotifs.get(tag)?.close(); openNotifs.delete(tag); pending.delete(tag); routes.delete(tag) } catch {}
}

// --- Звуки сообщений и интерфейса через WebAudio (без аудиофайлов) ---
let ac: AudioContext | null = null
function actx(): AudioContext | null {
  try {
    if (!ac) ac = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ac.state === 'suspended') ac.resume().catch(() => {})
    return ac
  } catch { return null }
}
// v1.199.0: раньше эти встроенные тоны игнорировали «Громкость динамика» из
// настроек (её учитывал только загруженный свой файл) и сами по себе были
// слишком тихими (0.03-0.09) — почти не слышно поверх любого фонового шума.
// Подняли базовую громкость примерно втрое и завели общий множитель spkVol.
function tone(freq: number, vol: number, dur = 0.09, when = 0) {
  const c = actx(); if (!c) return
  const v = vol * (getSettings().spkVol / 100)
  const o = c.createOscillator(); const g = c.createGain()
  o.type = 'sine'; o.frequency.value = freq
  g.gain.setValueAtTime(0, c.currentTime + when)
  g.gain.linearRampToValueAtTime(v, c.currentTime + when + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur)
  o.connect(g); g.connect(c.destination)
  o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + 0.05)
}

// v1.166.0: свой звук уведомления вместо встроенного тона (Настройки -> Звуки),
// плюс переключатель «Звуки уведомлений» — раньше существовал в настройках,
// но ни на что не влиял (реальный баг).
let notifAudio: HTMLAudioElement | null = null
function playCustomSound(url: string) {
  try {
    if (!notifAudio || notifAudio.src !== url) { notifAudio = new Audio(url) }
    notifAudio.volume = getSettings().spkVol / 100
    notifAudio.currentTime = 0
    notifAudio.play().catch(() => {})
  } catch {}
}

/** Звук входящего сообщения: в фокусе — короткий и тихий, не в фокусе — ниже и заметнее. */
export function msgSound() {
  try {
    if (!getSettings().notifSounds) return
    const url = getUserPrefs().account.notifSoundUrl
    if (url) { playCustomSound(url); return }
    const focused = document.visibilityState === 'visible' && document.hasFocus()
    if (focused) tone(880, 0.11, 0.07)
    else { tone(620, 0.26); tone(830, 0.22, 0.12, 0.09) }
  } catch {}
}

/** Мягкий двухнотный сигнал успеха (создание канала и т.п.). */
export function uiChime() {
  try { tone(740, 0.14); tone(988, 0.14, 0.12, 0.07) } catch {}
}
