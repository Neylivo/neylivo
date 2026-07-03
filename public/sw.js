/* Ponoi service worker — web-push receiver.
   Served at ./sw.js (from Vite public/). Handles 'push' (show notification)
   and 'notificationclick' (focus/open the app). Payload is JSON:
   { title, body, url, icon }. */
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { body: event.data && event.data.text() } }
  const title = data.title || 'Ponoi'
  const options = {
    body: data.body || '',
    icon: data.icon || undefined,
    badge: data.icon || undefined,
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus() }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})