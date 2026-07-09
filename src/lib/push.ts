// Web-push client: registers the service worker, subscribes the browser to push,
// stores the subscription in Supabase (`push_subscriptions`), and asks the
// `send-push` Edge Function to deliver a push to a set of users.
//
// Best-effort by design: if the VAPID public key isn't configured, if the browser
// lacks push support, or if we're running under Electron file:// (no service
// workers), every function quietly no-ops so the app keeps working. This is the
// real-push path that fires even when the app/tab is closed; the in-app
// Notification API path (notify.ts) still covers the open-but-unfocused case.
import { supabase } from './supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && location.protocol !== 'file:' // Electron file:// can't use service workers
}

// Register SW + subscribe + persist. Call once after login.
export async function registerPush(userId: string): Promise<void> {
  try {
    if (!userId || !VAPID_PUBLIC || !pushSupported()) return
    if (Notification.permission === 'default') {
      const p = await Notification.requestPermission()
      if (p !== 'granted') return
    } else if (Notification.permission !== 'granted') return

    const reg = await navigator.serviceWorker.register('./sw.js')
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
    }
    const json: any = sub.toJSON()
    await supabase.from('push_subscriptions').upsert({
      endpoint: sub.endpoint,
      user_id: userId,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    })
  } catch (e) {
    // best-effort — never break the app because of push
    console.warn('registerPush failed', e)
  }
}

// Ask the Edge Function to push to these users (fires even if their app is closed).
export async function sendPush(userIds: string[], title: string, body: string, url = '/'): Promise<void> {
  try {
    const targets = Array.from(new Set(userIds.filter(Boolean)))
    if (!targets.length) return
    await supabase.functions.invoke('send-push', { body: { userIds: targets, title, body, url } })
  } catch (e) {
    console.warn('sendPush failed', e)
  }
}