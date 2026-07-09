// Персональное заглушение каналов (как в Discord): влияет на звук/подсветку
// непрочитанного и на пункт «Скрыть заглушённые каналы».
// v1.164.0: раньше жило только в localStorage — теперь синхронизируется через
// user_prefs (миграция 39), как остальные личные настройки.
import { getUserPrefs, patchUserPrefs } from './userPrefs'

export function loadChMuted(): Record<string, boolean> {
  return getUserPrefs().ch_muted
}

export function setChMuted(id: string, muted: boolean) {
  const all = { ...loadChMuted() }
  if (muted) all[id] = true
  else delete all[id]
  patchUserPrefs({ ch_muted: all })
}
