// Папки серверов в левой колонке (как в Discord).
// v1.164.0: раньше жили только в localStorage (на других устройствах терялись) —
// теперь синхронизируются через user_prefs (миграция 39), как остальные личные настройки.
import { getUserPrefs, patchUserPrefs } from './userPrefs'

export interface SrvFolder { id: string; name: string; color: string; servers: string[]; open: boolean }

export function loadFolders(): SrvFolder[] {
  return getUserPrefs().srv_folders as SrvFolder[]
}
function save(f: SrvFolder[]) {
  patchUserPrefs({ srv_folders: f })
  window.dispatchEvent(new Event('ponoi-folders'))
}
export function folderOf(folders: SrvFolder[], serverId: string): SrvFolder | undefined {
  return folders.find(f => f.servers.includes(serverId))
}
// folderId: id существующей папки | 'new' (создать) | null (убрать из папки)
export function moveToFolder(serverId: string, folderId: string | null, name?: string, color?: string) {
  let fs = loadFolders().map(f => ({ ...f, servers: f.servers.filter(s => s !== serverId) }))
  if (folderId === 'new') {
    fs.push({ id: crypto.randomUUID(), name: name || 'Папка', color: color || '#5865f2', servers: [serverId], open: false })
  } else if (folderId) {
    fs = fs.map(f => f.id === folderId ? { ...f, servers: [...f.servers, serverId] } : f)
  }
  save(fs.filter(f => f.servers.length > 0))
}
export function toggleFolder(id: string) {
  save(loadFolders().map(f => f.id === id ? { ...f, open: !f.open } : f))
}
