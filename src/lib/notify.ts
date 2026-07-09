// Desktop notifications via the Web Notification API (no backend / service worker).
// Shows a native notification for an incoming message when the app is open but the
// tab is not focused. This is the "notifications" first step; true push (delivered
// when the app/tab is closed) would need a service worker + VAPID + a sender.
import { getSettings } from './settings'
import { getUserPrefs } from './userPrefs'

export function initNotifications() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  } catch {}
}

export function notifyMessage(title: string, body: string, icon?: string | null) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    // Only notify when the user isn't actively looking at the app.
    if (document.visibilityState === 'visible' && document.hasFocus()) return
    const n = new Notification(title, { body: body || 'Вложение', icon: icon || undefined })
    n.onclick = () => { try { window.focus() } catch {} ; n.close() }
    setTimeout(() => { try { n.close() } catch {} }, 8000)
  } catch {}
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
function tone(freq: number, vol: number, dur = 0.09, when = 0) {
  const c = actx(); if (!c) return
  const o = c.createOscillator(); const g = c.createGain()
  o.type = 'sine'; o.frequency.value = freq
  g.gain.setValueAtTime(0, c.currentTime + when)
  g.gain.linearRampToValueAtTime(vol, c.currentTime + when + 0.01)
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
    if (focused) tone(880, 0.035, 0.07)
    else { tone(620, 0.09); tone(830, 0.07, 0.12, 0.09) }
  } catch {}
}

/** Мягкий двухнотный сигнал успеха (создание канала и т.п.). */
export function uiChime() {
  try { tone(740, 0.05); tone(988, 0.05, 0.12, 0.07) } catch {}
}
