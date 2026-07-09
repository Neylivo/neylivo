// Режим уведомлений на сервер (как в Discord): все / только @упоминания / без уведомлений.
// v1.164.0: раньше жил только в localStorage — теперь синхронизируется через
// user_prefs (миграция 39), как остальные личные настройки.
import { getUserPrefs, patchUserPrefs } from './userPrefs'

export type NotifMode = 'all' | 'mentions' | 'mute'

export function notifModeOf(serverId: string): NotifMode {
  return (getUserPrefs().srv_notif[serverId] as NotifMode) ?? 'all'
}

export function setNotifMode(serverId: string, mode: NotifMode) {
  const all = { ...getUserPrefs().srv_notif }
  if (mode === 'all') delete all[serverId]
  else all[serverId] = mode
  patchUserPrefs({ srv_notif: all })
  window.dispatchEvent(new Event('ponoi-notif'))
}

export const NOTIF_LABEL: Record<NotifMode, string> = {
  all: 'Все сообщения',
  mentions: 'Только @упоминания',
  mute: 'Без уведомлений',
}
