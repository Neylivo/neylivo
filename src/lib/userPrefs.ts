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
  // v1.187.0: контекстное меню друга в списке ЛС (закреп/мьют/никнейм/«закрыть ЛС»/игнор).
  dm_pinned: string[]                // [friendId] — закреплённые вверху списка
  dm_muted: Record<string, number>   // {friendId: expiryMs} — 0 = навсегда, иначе Date.now() до которого не звучит/не пушит
  dm_closed: string[]                // [friendId] — «Закрыть ЛС», скрыт из списка, пока не напишет снова
  dm_ignored: string[]               // [friendId] — сообщения свёрнуты только у тебя, дружба/переписка не трогаются
  friend_nick: Record<string, string> // {friendId: nickname} — виден только тебе
}

const DEFAULTS: UserPrefsRow = {
  notes: {}, srv_folders: [], ch_muted: {}, srv_notif: {}, srv_privacy: {},
  ch_read: {}, dm_read: {}, gif_favs: [], mus_playlists: [], account: {},
  dm_pinned: [], dm_muted: {}, dm_closed: [], dm_ignored: [], friend_nick: {},
}

let uid: string | null = null
let row: UserPrefsRow = { ...DEFAULTS }
let loaded = false
const LS_KEY = 'ponoi_uprefs'
let realtimeCh: ReturnType<typeof supabase.channel> | null = null

function mirror() { try { localStorage.setItem(LS_KEY, JSON.stringify(row)) } catch {} }

// Вызывается из AuthProvider при входе/смене сессии — подтягивает приватные настройки
// этого аккаунта со всех устройств. До ответа сети используем локальное зеркало, чтобы
// UI не мигал дефолтами при каждом запуске.
export function initUserPrefs(userId: string | null) {
  if (uid === userId && (loaded || !userId)) return
  uid = userId
  if (realtimeCh) { supabase.removeChannel(realtimeCh); realtimeCh = null }
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
  // v1.194.0: правки на другом устройстве (телефон/десктоп/веб) появляются
  // тут же, а не только при следующем логине — требует supabase/51_realtime_sync.sql.
  realtimeCh = supabase.channel('uprefs:' + userId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_prefs', filter: 'user_id=eq.' + userId }, p => {
      if (uid !== userId || !p.new) return
      row = { ...DEFAULTS, ...(p.new as any) }
      mirror()
      window.dispatchEvent(new Event('ponoi-uprefs'))
    })
    .subscribe()
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

// v1.187.0: закреп друга вверху списка ЛС (контекстное меню, «Закрепить»).
export function isDmPinned(friendId: string): boolean { return row.dm_pinned.includes(friendId) }
export function toggleDmPinned(friendId: string) {
  const on = isDmPinned(friendId)
  patchUserPrefs({ dm_pinned: on ? row.dm_pinned.filter(id => id !== friendId) : [...row.dm_pinned, friendId] })
}

// Мьют ЛС с длительностью: expiry === 0 значит «навсегда, пока не включат обратно».
export function isDmMuted(friendId: string): boolean {
  const exp = row.dm_muted[friendId]
  return exp !== undefined && (exp === 0 || Date.now() < exp)
}
export function setDmMuted(friendId: string, expiryMs: number | null) {
  const next = { ...row.dm_muted }
  if (expiryMs === null) delete next[friendId]
  else next[friendId] = expiryMs
  patchUserPrefs({ dm_muted: next })
}

// «Закрыть ЛС» — прячет из списка, пока собеседник не напишет снова (reopenDm
// вызывается автоматически на входящее сообщение, см. DMHome.tsx).
export function isDmClosed(friendId: string): boolean { return row.dm_closed.includes(friendId) }
export function closeDm(friendId: string) {
  if (isDmClosed(friendId)) return
  patchUserPrefs({ dm_closed: [...row.dm_closed, friendId] })
}
export function reopenDm(friendId: string) {
  if (!isDmClosed(friendId)) return
  patchUserPrefs({ dm_closed: row.dm_closed.filter(id => id !== friendId) })
}

// Игнор — лёгкая версия блокировки: сообщения свёрнуты только у тебя, собеседник
// не в курсе, переписка технически продолжается (в отличие от src/lib/block.ts).
export function isDmIgnored(friendId: string): boolean { return row.dm_ignored.includes(friendId) }
export function toggleDmIgnored(friendId: string) {
  const on = isDmIgnored(friendId)
  patchUserPrefs({ dm_ignored: on ? row.dm_ignored.filter(id => id !== friendId) : [...row.dm_ignored, friendId] })
}

// Никнейм друга — виден только тебе, не трогает его настоящее имя в БД.
export function friendNickOf(friendId: string): string | null { return row.friend_nick[friendId] ?? null }
export function setFriendNick(friendId: string, nick: string | null) {
  const next = { ...row.friend_nick }
  if (nick && nick.trim()) next[friendId] = nick.trim()
  else delete next[friendId]
  patchUserPrefs({ friend_nick: next })
}
