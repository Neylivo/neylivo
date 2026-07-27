import { supabase } from '../supabase'
import {
  generateIdentity, exportPublicKey, importPublicKey, fingerprint,
  type IdentityKeyPair,
} from './core'

// v1.293.0: ключи устройства — хранение своего, публикация публичного, получение чужих.
//
// Ключ принадлежит УСТРОЙСТВУ, а не человеку: у телефона и компьютера они разные, и
// приватная часть никогда не переносится между ними. Плата — новое устройство не
// прочитает переписку, которая была до его появления. Выигрыш — приватный ключ
// нигде не существует в переносимом виде, поэтому его нечего перехватить: ни на
// сервере, ни в резервной копии, ни по требованию выдать.
//
// Это тот же выбор, что сделан в Signal при подключении нового устройства.

const DB = 'ponoiKeys'
const STORE = 'identity'
const DEVICE_ID_KEY = 'ponoi_device_id'

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((res, rej) => {
    const g = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    g.onsuccess = () => res(g.result as T | undefined)
    g.onerror = () => rej(g.error)
  })
}

async function idbPut(key: string, val: unknown): Promise<void> {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(val, key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

/** Идентификатор этого устройства. Случайный и ни с чем не связанный — он не должен
 *  давать возможность узнать по нему что-то о человеке или его технике. */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

let cached: IdentityKeyPair | null = null

/**
 * Пара ключей этого устройства: берётся из хранилища или создаётся при первом вызове.
 *
 * Приватный ключ хранится как объект CryptoKey — WebCrypto не отдаёт его байты
 * наружу вообще, поэтому даже полный доступ к IndexedDB не даёт возможности его
 * скопировать. Использовать — можно, унести — нет.
 */
export async function myIdentity(): Promise<IdentityKeyPair> {
  if (cached) return cached
  const priv = await idbGet<CryptoKey>('priv')
  const pub = await idbGet<CryptoKey>('pub')
  if (priv && pub) {
    cached = { privateKey: priv, publicKey: pub }
    return cached
  }
  const kp = await generateIdentity()
  await idbPut('priv', kp.privateKey)
  await idbPut('pub', kp.publicKey)
  cached = kp
  return kp
}

export interface DeviceKey {
  userId: string
  deviceId: string
  publicKey: CryptoKey
  fingerprint: string
}

/**
 * Опубликовать свой публичный ключ. Вызывается при каждом запуске: строка та же,
 * upsert по (user_id, device_id) ничего не меняет, если ключ прежний, — зато
 * устройство «возвращается» в список, если запись почему-то пропала.
 */
export async function publishMyKey(userId: string): Promise<void> {
  const kp = await myIdentity()
  const jwk = await exportPublicKey(kp.publicKey)
  const fp = await fingerprint(kp.publicKey)
  const { error } = await supabase.from('user_keys').upsert({
    user_id: userId,
    device_id: deviceId(),
    public_key: jwk,
    fingerprint: fp,
  }, { onConflict: 'user_id,device_id' })
  if (error) throw error
}

/** Все устройства человека, которым можно писать. */
export async function fetchDeviceKeys(userId: string): Promise<DeviceKey[]> {
  const { data, error } = await supabase
    .from('user_keys')
    .select('user_id, device_id, public_key, fingerprint')
    .eq('user_id', userId)
  if (error) throw error
  const out: DeviceKey[] = []
  for (const row of data ?? []) {
    try {
      out.push({
        userId: row.user_id,
        deviceId: row.device_id,
        publicKey: await importPublicKey(row.public_key as JsonWebKey),
        fingerprint: String(row.fingerprint ?? ''),
      })
    } catch {
      // Битый или чужеродный ключ пропускаем молча: одна плохая запись не должна
      // лишать человека переписки со всеми остальными его устройствами.
    }
  }
  return out
}

/** Мой отпечаток — показывается в настройках для сверки с собеседником. */
export async function myFingerprint(): Promise<string> {
  return fingerprint((await myIdentity()).publicKey)
}

/**
 * Забыть ключи этого устройства. Нужно при выходе из аккаунта: иначе следующий
 * вошедший на этом компьютере унаследовал бы ключи предыдущего и мог бы читать
 * адресованное ему.
 */
export async function forgetIdentity(): Promise<void> {
  cached = null
  const db = await idb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  localStorage.removeItem(DEVICE_ID_KEY)
}
