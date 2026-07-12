// Режим уведомлений отдельного канала (как в Discord): по умолчанию канал наследует
// общий режим сервера (notifModeOf, см. srvNotify.ts) — своё значение появляется тут,
// только если пользователь явно переопределил именно этот канал. Старое булево
// заглушение (ch_muted, chMute.ts) остаётся рабочим источником «mute» для каналов,
// заглушённых до этой версии, — отдельной миграции данных не требуется.
import { getUserPrefs, patchUserPrefs } from './userPrefs'
import { notifModeOf, type NotifMode } from './srvNotify'

// v1.260.0: временное заглушение канала — тот же приём, что и в srvNotify.ts:
// 'mute:<until_ms>' в той же строковой ячейке, без миграции схемы.
function parseMode(raw: string | undefined): NotifMode | null {
  if (!raw) return null
  if (raw === 'mute') return 'mute'
  if (raw.startsWith('mute:')) {
    const until = Number(raw.slice(5))
    return until && Date.now() >= until ? null : 'mute'
  }
  return raw as NotifMode
}

// Явное переопределение канала (без наследования от сервера) — null, если канал
// наследует режим сервера. Используется UI-модалкой, чтобы отметить нужную радиокнопку.
export function chOverrideOf(channelId: string): NotifMode | null {
  return parseMode(getUserPrefs().ch_notif[channelId]) ?? (getUserPrefs().ch_muted[channelId] ? 'mute' : null)
}

export function chNotifModeOf(channelId: string, serverId: string): NotifMode {
  return chOverrideOf(channelId) ?? notifModeOf(serverId)
}

// muteUntil: undefined/0 — заглушить насовсем; timestamp (мс) — до какого момента.
export function setChNotifMode(channelId: string, mode: NotifMode | 'default', muteUntil?: number) {
  const all = { ...getUserPrefs().ch_notif }
  if (mode === 'default') delete all[channelId]
  else if (mode === 'mute' && muteUntil) all[channelId] = 'mute:' + muteUntil
  else all[channelId] = mode
  patchUserPrefs({ ch_notif: all })
  window.dispatchEvent(new Event('ponoi-notif'))
}

// До какого момента заглушён канал (для подписи «до 14:30»); null — не заглушён
// (или заглушён насовсем/через ch_muted).
export function chMuteUntilOf(channelId: string): number | null {
  const raw = getUserPrefs().ch_notif[channelId]
  if (!raw?.startsWith('mute:')) return null
  const until = Number(raw.slice(5))
  return until && Date.now() < until ? until : null
}
