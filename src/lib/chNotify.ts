// Режим уведомлений отдельного канала (как в Discord): по умолчанию канал наследует
// общий режим сервера (notifModeOf, см. srvNotify.ts) — своё значение появляется тут,
// только если пользователь явно переопределил именно этот канал. Старое булево
// заглушение (ch_muted, chMute.ts) остаётся рабочим источником «mute» для каналов,
// заглушённых до этой версии, — отдельной миграции данных не требуется.
import { getUserPrefs, patchUserPrefs } from './userPrefs'
import { notifModeOf, type NotifMode } from './srvNotify'

export function chNotifModeOf(channelId: string, serverId: string): NotifMode {
  const ov = getUserPrefs().ch_notif[channelId] as NotifMode | undefined
  if (ov) return ov
  if (getUserPrefs().ch_muted[channelId]) return 'mute'
  return notifModeOf(serverId)
}

export function setChNotifMode(channelId: string, mode: NotifMode | 'default') {
  const all = { ...getUserPrefs().ch_notif }
  if (mode === 'default') delete all[channelId]
  else all[channelId] = mode
  patchUserPrefs({ ch_notif: all })
  window.dispatchEvent(new Event('ponoi-notif'))
}
