// Desktop notifications via the Web Notification API (no backend / service worker).
// Shows a native notification for an incoming message when the app is open but the
// tab is not focused. This is the "notifications" first step; true push (delivered
// when the app/tab is closed) would need a service worker + VAPID + a sender.

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