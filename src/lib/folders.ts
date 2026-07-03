// Папки серверов в левой колонке (как в Discord).
// Хранятся локально (localStorage) — это персональная организация серверов,
// на других устройствах пользователь может сгруппировать по-своему.
export interface SrvFolder { id: string; name: string; color: string; servers: string[]; open: boolean }

const KEY = 'ponoi_srv_folders'

export function loadFolders(): SrvFolder[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function save(f: SrvFolder[]) {
  localStorage.setItem(KEY, JSON.stringify(f))
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
