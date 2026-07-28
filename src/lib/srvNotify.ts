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

/**
 * Режим по умолчанию, заданный НА СЕРВЕРЕ его владельцем («Настройки сервера» →
 * «Уведомления по умолчанию»), — как в Discord.
 *
 * v1.332.0: настройка сохранялась в settings сервера и не читалась нигде: сервер,
 * который просил «по умолчанию только упоминания», всё равно звенел на каждое
 * сообщение. Держим её в отдельном реестре, потому что notifModeOf() знает только
 * id сервера, а тянуть сюда сам объект сервера пришлось бы через десяток мест.
 */
const srvDefaults = new Map<string, NotifMode>()
export function setServerNotifDefaults(servers: { id: string; settings?: any }[]) {
  for (const s of servers) {
    const v = s.settings?.default_notif
    if (v === 'all' || v === 'mentions' || v === 'mute') srvDefaults.set(s.id, v)
    else srvDefaults.delete(s.id)
  }
}

export function notifModeOf(serverId: string): NotifMode {
  // Порядок как в Discord: выбор человека на этом сервере важнее умолчания
  // сервера, а умолчание сервера — важнее общего «Новые серверы» в настройках.
  const fallback = srvDefaults.get(serverId) ?? getSettings().defaultServerNotif
  return parseMode(getUserPrefs().srv_notif[serverId], fallback)
}

/**
 * Звучать ли на это сообщение: режим канала/сервера плюс общий тумблер
 * «Уведомлять только о @упоминаниях» из настроек.
 *
 * v1.332.0: тумблер mentionsOnly не читался нигде — он сохранялся, синхронизировался
 * между устройствами и ни на что не влиял. Складываем его с режимом сервера так же,
 * как в Discord: общая настройка может только ужесточить выбранное на сервере, но не
 * ослабить, иначе заглушённый сервер снова начал бы звенеть. Личных сообщений это не
 * касается — ЛС и так адресовано лично тебе (в Discord «только упоминания» их тоже не
 * трогает).
 */
export function shouldNotify(mode: NotifMode, mentioned: boolean): boolean {
  if (mode === 'mute') return false
  if (mode === 'mentions') return mentioned
  return getSettings().mentionsOnly ? mentioned : true
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
