// Режим уведомлений на сервер (как в Discord): все / только @упоминания / без уведомлений.
// v1.164.0: раньше жил только в localStorage — теперь синхронизируется через
// user_prefs (миграция 39), как остальные личные настройки.
import { getUserPrefs, patchUserPrefs } from './userPrefs'
import { getSettings } from './settings'

export type NotifMode = 'all' | 'mentions' | 'mute'

// v1.246.0: сервер без явного выбора берёт общий дефолт из настроек (Уведомления →
// «Новые серверы»), а не жёстко 'all' — чтобы не приходилось на каждом новом
// сервере вручную переключать на «только упоминания», если так привычнее.
export function notifModeOf(serverId: string): NotifMode {
  return (getUserPrefs().srv_notif[serverId] as NotifMode) ?? getSettings().defaultServerNotif
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
