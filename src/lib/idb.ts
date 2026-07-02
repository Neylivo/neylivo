// Tiny IndexedDB key-value store (db 'ponoiMedia', store 'kv') for large binary blobs
// that must survive reload (unlike object-URL blobs kept only in localStorage).
const DB = 'ponoiMedia', STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
export async function idbSet(key: string, val: Blob) {
  const db = await open()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}
export async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await open()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly'); const g = tx.objectStore(STORE).get(key)
    g.onsuccess = () => res(g.result as Blob | undefined); g.onerror = () => rej(g.error)
  })
}
export async function idbDel(key: string) {
  const db = await open()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}
