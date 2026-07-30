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
/**
 * То же хранилище, но для обычных данных, а не только для двоичных (v1.435.0).
 *
 * Понадобилось для Трекотеки: восемь тысяч треков — это около двух мегабайт
 * JSON, и localStorage такое либо не примет вовсе, либо вытеснит собой всё
 * остальное. IndexedDB кладёт объекты как есть, без превращения в строку.
 */
export async function idbPut(key: string, val: unknown) {
  const db = await open()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}
export async function idbGetAny<T>(key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly'); const g = tx.objectStore(STORE).get(key)
    g.onsuccess = () => res(g.result as T | undefined); g.onerror = () => rej(g.error)
  })
}

export async function idbDel(key: string) {
  const db = await open()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}
