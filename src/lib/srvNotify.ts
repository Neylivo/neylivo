// Режим уведомлений на сервер (как в Discord): все / только @упоминания / без уведомлений.
// Хранится в localStorage — персональная настройка, не синхронизируется.

export type NotifMode = 'all' | 'mentions' | 'mute'

const KEY = 'ponoi_srv_notif'

function load(): Record<string, NotifMode> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

export function notifModeOf(serverId: string): NotifMode {
  return load()[serverId] ?? 'all'
}

export function setNotifMode(serverId: string, mode: NotifMode) {
  const all = load()
  if (mode === 'all') delete all[serverId]
  else all[serverId] = mode
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(new Event('ponoi-notif'))
}

export const NOTIF_LABEL: Record<NotifMode, string> = {
  all: 'Все сообщения',
  mentions: 'Только @упоминания',
  mute: 'Без уведомлений',
}
