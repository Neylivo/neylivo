// Per-server client-side preferences (avatar data URL + accent color).
// The `servers` table has no avatar/accent columns, and Ponoi is a personal
// app, so these live in localStorage keyed by server id.
export interface ServerPrefs { avatar?: string | null; accent?: string | null }

const KEY = 'ponoi_server_prefs'

function all(): Record<string, ServerPrefs> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
export function getServerPrefs(id: string): ServerPrefs {
  return all()[id] ?? {}
}
export function setServerPrefs(id: string, patch: ServerPrefs) {
  const a = all()
  a[id] = { ...a[id], ...patch }
  localStorage.setItem(KEY, JSON.stringify(a))
  window.dispatchEvent(new CustomEvent('ponoi-server-prefs', { detail: { id } }))
}

// Read a File as a data URL (for avatar upload previews stored locally).
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
