// Персональное заглушение каналов (как в Discord): хранится в localStorage,
// влияет на звук/подсветку непрочитанного и на пункт «Скрыть заглушённые каналы».
const KEY = 'ponoi_ch_muted'

export function loadChMuted(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

export function setChMuted(id: string, muted: boolean) {
  const all = loadChMuted()
  if (muted) all[id] = true
  else delete all[id]
  localStorage.setItem(KEY, JSON.stringify(all))
}
