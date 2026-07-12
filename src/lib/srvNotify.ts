// Режим уведомлений на сервер (как в Discord): все / только @упоминания / без уведомлений.
// v1.164.0: раньше жил только в localStorage — теперь синхронизируется через
// user_prefs (миграция 39), как остальные личные настройки.
import { getUserPrefs, patchUserPrefs } from './userPrefs'
import { getSettings } from './settings'

export type NotifMode = 'all' | 'mentions' | 'mute'

// v1.246.0: сервер без явного выбора берёт общий дефолт из настроек (Уведомления →
// «Новые серверы»), а не жёстко 'all' — чтобы не приходилось на каждом новом
// сервере вручную переключать на «только упоминания», если так привычнее.
// v1.260.0: заглушение может быть временным — храним как 'mute:<until_ms>' в той же
// строковой ячейке (без миграции схемы), как уже сделано для ЛС (dm_muted в
// userPrefs.ts). Истёкшее временное заглушение просто перестаёт действовать здесь
// же, при чтении — отдельно чистить ключ не нужно, следующий mute его перезапишет.
function parseMode(raw: string | undefined, fallback: NotifMode): NotifMode {
  if (!raw) return fallback
  if (raw === 'mute') return 'mute'
  if (raw.startsWith('mute:')) {
    const until = Number(raw.slice(5))
    return until && Date.now() >= until ? fallback : 'mute'
  }
  return raw as NotifMode
}

export function notifModeOf(serverId: string): NotifMode {
  return parseMode(getUserPrefs().srv_notif[serverId], getSettings().defaultServerNotif)
}

// muteUntil: undefined/0 — заглушить насовсем; timestamp (мс) — до какого момента.
export function setNotifMode(serverId: string, mode: NotifMode, muteUntil?: number) {
  const all = { ...getUserPrefs().srv_notif }
  if (mode === 'all') delete all[serverId]
  else if (mode === 'mute' && muteUntil) all[serverId] = 'mute:' + muteUntil
  else all[serverId] = mode
  patchUserPrefs({ srv_notif: all })
  window.dispatchEvent(new Event('ponoi-notif'))
}

// До какого момента заглушён сервер (для подписи «до 14:30» в UI); null — не
// заглушён или заглушён насовсем.
export function muteUntilOf(serverId: string): number | null {
  const raw = getUserPrefs().srv_notif[serverId]
  if (!raw?.startsWith('mute:')) return null
  const until = Number(raw.slice(5))
  return until && Date.now() < until ? until : null
}

export const NOTIF_LABEL: Record<NotifMode, string> = {
  all: 'Все сообщения',
  mentions: 'Только @упоминания',
  mute: 'Без уведомлений',
}
