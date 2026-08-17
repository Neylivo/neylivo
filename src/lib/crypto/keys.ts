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

/**
 * Выход из аккаунта. Отдельная функция, а не «не забыть вызвать forgetIdentity
 * рядом с signOut»: мест выхода в приложении несколько, и в v1.293.0 забывание
 * ключей уже оказалось написанным, но ни к одному из них не подключённым.
 */
export async function signOutAndForgetKeys(): Promise<void> {
  // Сначала забываем ключи, потом выходим: если выход оборвётся на сети, ключи
  // всё равно уже не достанутся следующему вошедшему на этом компьютере.
  try { await forgetIdentity() } catch { /* хранилище недоступно — выйти всё равно надо */ }
  // v1.563.0: подписанные ссылки на вложения теперь переживают перезапуск, а
  // они предъявительские — кто их взял, тот качает файл до конца срока.
  // Оставлять их следующему вошедшему на этом компьютере нельзя.
  try { (await import('../attachUrl')).забыть() } catch { /* то же самое */ }
  await supabase.auth.signOut()
}

// ── Резервная копия ключа под паролем (v1.366.0) ────────────────────────────
//
// Ключ жил только на устройстве и стирался при выходе — вместе со всей
// перепиской. Теперь он ещё и лежит на сервере, запертый паролем: при входе
// открывается, при выходе с устройства пропадает, как и раньше.
//
// На сервер уходит только запертое. Пароль там не появляется ни на секунду.

import { exportPrivateKey, importPrivateKey } from './core'

// Сам механизм копии подгружаем на месте, а не сверху файла: этот модуль лежит в
// стартовом куске (выход из аккаунта нужен сразу), а копия делается ровно дважды
// за сеанс — при входе и при выходе. Тащить её в запуск незачем.
const backup = () => import('./backup')

/** Положить (или обновить) копию своего ключа. Тихо ничего не делает, если нечего класть. */
export async function backupMyKey(userId: string, password: string, own = false): Promise<void> {
  const kp = await myIdentity()
  let jwk: JsonWebKey
  try {
    jwk = await exportPrivateKey(kp.privateKey)
  } catch {
    // Ключ создан до v1.366.0 — он неизвлекаем, и скопировать его нельзя вовсе.
    // Это не ошибка человека: молчим, копия появится при следующем новом ключе.
    return
  }
  const { newSalt, wrapPrivateKey } = await backup()
  const salt = newSalt()
  const wrapped = await wrapPrivateKey(jwk, password, salt)
  // Признак «заперто своим паролем» едет внутри jsonb-поля wrapped: отдельная
  // колонка потребовала бы миграции, а их и так очередь ждёт владельца.
  if (own) (wrapped as any).own = true
  await supabase.from('key_backups').upsert({
    user_id: userId, salt, wrapped, device_id: deviceId(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

export type RestoreResult = 'restored' | 'none' | 'wrong-password' | 'own-password' | 'broken' | 'unavailable'

/**
 * Запереть копию ключа ОТДЕЛЬНЫМ паролем (v1.559.0, находка F3 аудита).
 *
 * Пароль аккаунта проходит через сервер входа: тот, кто им управляет, может
 * перехватить его и открыть копию. Отдельный пароль нигде, кроме этого
 * шифрования, не используется — и тогда сервер копию открыть не может.
 *
 * Требует, чтобы ключ был на устройстве сейчас: перезапереть можно только то,
 * что открыто.
 */
export async function setBackupPassword(userId: string, ownPassword: string): Promise<boolean> {
  try { await backupMyKey(userId, ownPassword, true); return true } catch { return false }
}

/** Заперта ли копия своим паролем. Нужно, чтобы не перезаписать её паролем аккаунта. */
export async function backupIsOwnLocked(userId: string): Promise<boolean> {
  const { data } = await supabase.from('key_backups').select('wrapped').eq('user_id', userId).maybeSingle()
  return !!(data?.wrapped as any)?.own
}

/** Вернуть копию под пароль аккаунта. */
export async function dropBackupPassword(userId: string, accountPassword: string): Promise<boolean> {
  try { await backupMyKey(userId, accountPassword, false); return true } catch { return false }
}

/**
 * Достать ключ из копии и положить его на это устройство.
 *
 * Возвращает словами, что вышло: человеку нужны разные сообщения на «копии нет»,
 * «пароль не тот» и «копия испорчена», и путать их нельзя.
 */
export async function restoreMyKey(userId: string, password: string): Promise<RestoreResult> {
  const { data, error } = await supabase
    .from('key_backups').select('salt, wrapped').eq('user_id', userId).maybeSingle()
  // Таблицы ещё нет (миграция не применена) — это не «копии нет», а «спросить негде».
  if (error) return 'unavailable'
  if (!data) return 'none'
  const { unwrapPrivateKey, isWrongPassword } = await backup()
  let jwk: JsonWebKey
  try {
    jwk = await unwrapPrivateKey(data.wrapped as any, password, String(data.salt))
  } catch (e) {
    if (!isWrongPassword(e)) return 'broken'
    // Заперто своим паролем — это НЕ «пароль не тот», и перезаписывать копию
    // паролем аккаунта нельзя: человек потерял бы переписку молча.
    return (data.wrapped as any)?.own ? 'own-password' : 'wrong-password'
  }
  try {
    const priv = await importPrivateKey(jwk)
    // Публичную часть берём из той же JWK: у ECDH она лежит рядом с приватной,
    // выводить её отдельно не нужно и негде.
    const pubJwk: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: [] }
    const pub = await importPublicKey(pubJwk)
    await idbPut('priv', priv)
    await idbPut('pub', pub)
    cached = { privateKey: priv, publicKey: pub }
    return 'restored'
  } catch { return 'broken' }
}
