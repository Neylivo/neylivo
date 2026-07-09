// Приватные персональные настройки (заметки, папки серверов, заглушение, режим
// уведомлений, приватность сервера, отметки «прочитано», избранные GIF, плейлисты,
// часть общих настроек) — одна строка на пользователя в user_prefs (миграция 39),
// видна только владельцу. В отличие от profilePrefs.ts (публичная карточка профиля),
// это личные данные — но они должны быть одинаковы на всех устройствах аккаунта,
// поэтому больше не живут в localStorage.
import { supabase } from './supabase'

export interface UserPrefsRow {
  notes: Record<string, string>
  srv_folders: any[]
  ch_muted: Record<string, boolean>
  srv_notif: Record<string, string>
  srv_privacy: Record<string, { dm: boolean; activity: boolean }>
  ch_read: Record<string, number>
  dm_read: Record<string, number>
  gif_favs: string[]
  mus_playlists: any[]
  account: Record<string, any>
}

const DEFAULTS: UserPrefsRow = {
  notes: {}, srv_folders: [], ch_muted: {}, srv_notif: {}, srv_privacy: {},
  ch_read: {}, dm_read: {}, gif_favs: [], mus_playlists: [], account: {},
}

let uid: string | null = null
let row: UserPrefsRow = { ...DEFAULTS }
let loaded = false
const LS_KEY = 'ponoi_uprefs'

function mirror() { try { localStorage.setItem(LS_KEY, JSON.stringify(row)) } catch {} }

// Вызывается из AuthProvider при входе/смене сессии — подтягивает приватные настройки
// этого аккаунта со всех устройств. До ответа сети используем локальное зеркало, чтобы
// UI не мигал дефолтами при каждом запуске.
export function initUserPrefs(userId: string | null) {
  if (uid === userId && (loaded || !userId)) return
  uid = userId
  if (!userId) { row = { ...DEFAULTS }; loaded = false; return }
  try { const raw = localStorage.getItem(LS_KEY); if (raw) row = { ...DEFAULTS, ...JSON.parse(raw) } } catch {}
  loaded = false
  supabase.from('user_prefs').select('*').eq('user_id', userId).maybeSingle().then(({ data }) => {
    if (uid !== userId) return
    row = { ...DEFAULTS, ...(data ?? {}) }
    loaded = true
    mirror()
    window.dispatchEvent(new Event('ponoi-uprefs'))
  })
}

export function getUserPrefs(): UserPrefsRow { return row }

export function patchUserPrefs(patch: Partial<UserPrefsRow>) {
  row = { ...row, ...patch }
  mirror()
  if (!uid) return
  supabase.from('user_prefs').upsert({ user_id: uid, ...patch, updated_at: new Date().toISOString() }).then(() => {})
}

// Отметки «прочитано» для каналов/ЛС — раньше жили в localStorage (ponoi_lastread_*),
// поэтому «прочитано» на одном устройстве не убирало непрочитанное на другом.
export function getChRead(channelId: string): number { return row.ch_read[channelId] ?? 0 }
export function setChRead(channelId: string, ms: number) {
  patchUserPrefs({ ch_read: { ...row.ch_read, [channelId]: ms } })
}
export function getDmRead(threadId: string): number { return row.dm_read[threadId] ?? 0 }
export function setDmRead(threadId: string, ms: number) {
  patchUserPrefs({ dm_read: { ...row.dm_read, [threadId]: ms } })
}
