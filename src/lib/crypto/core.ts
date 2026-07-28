// v1.292.0: криптографическое ядро сквозного шифрования.
//
// Здесь только чистые функции над WebCrypto — ни сети, ни базы, ни React. Так их
// можно проверить отдельно и целиком, что для криптографии обязательно: ошибка тут
// не «кнопка не нажимается», а «переписку можно прочитать».
//
// Выбор примитивов и почему именно они:
//
//   ECDH P-256  — согласование общего секрета между двумя устройствами. X25519 был
//                 бы предпочтительнее, но в Chromium этой версии его в WebCrypto
//                 нет (проверено), а P-256 поддерживается везде и даёт тот же
//                 уровень стойкости (~128 бит).
//   HKDF-SHA256 — из общего секрета ECDH делаем ключ шифрования. Голый результат
//                 ECDH использовать как ключ нельзя: он не равномерен.
//   AES-256-GCM — само шифрование. GCM даёт ещё и целостность: изменённый на
//                 сервере шифротекст не расшифруется, а не расшифруется «во что-то».
//
// Приватный ключ создаётся НЕИЗВЛЕКАЕМЫМ (extractable: false). Это значит, что его
// не может прочитать никакой код в приложении — ни наш, ни плагина, ни внедрённый
// через дыру: WebCrypto просто не отдаёт байты наружу. Ключ можно только
// использовать для вычислений, и живёт он в IndexedDB как объект CryptoKey.

const KDF_HASH = 'SHA-256'
const AES = 'AES-GCM'
const IV_BYTES = 12          // рекомендованный размер для GCM
const CURVE = 'P-256'

export interface IdentityKeyPair { publicKey: CryptoKey; privateKey: CryptoKey }

/**
 * Новая пара ключей устройства.
 *
 * v1.366.0: приватный ключ стал извлекаемым — и это осознанная уступка, а не
 * недосмотр. Раньше он не существовал в переносимом виде вовсе: его нечего было
 * украсть или потребовать выдать. Но вместе с ним при каждом выходе пропадала и
 * переписка человека — он видел «Сообщение зашифровано для другого устройства»
 * вместо собственных сообщений, и вернуть их было нечем.
 *
 * Теперь ключ можно выгрузить, чтобы положить его резервную копию, запертую
 * паролем (см. backup.ts). Выгружает его только владелец и только в браузере;
 * наружу уходит уже запертое. Цена: тот, кто получит и базу, и пароль, прочитает
 * переписку. Плата за то, чтобы человек не терял свои сообщения.
 */
export async function generateIdentity(extractable = true): Promise<IdentityKeyPair> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE },
    extractable,
    ['deriveBits'],
  ) as CryptoKeyPair
  return { publicKey: kp.publicKey, privateKey: kp.privateKey }
}

/** Приватный ключ в JWK — только для резервной копии, наружу в открытом виде не идёт. */
export async function exportPrivateKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key)
}

/** Обратно из копии. Восстановленный ключ снова извлекаем — копию надо уметь обновить. */
export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits'])
}

/** Публичный ключ в виде JWK — его и публикуем, он не секрет. */
export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key)
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: CURVE }, true, [])
}

/**
 * Общий ключ шифрования для пары устройств.
 *
 * `info` привязывает ключ к назначению и к паре собеседников: даже при одном и том
 * же ECDH-секрете ключи для разных целей получаются разными. Это стандартная
 * практика (доменное разделение) — без неё ключ, утёкший в одном месте, годился бы
 * везде.
 */
export async function deriveSharedKey(
  myPrivate: CryptoKey,
  theirPublic: CryptoKey,
  info: string,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublic }, myPrivate, 256,
  )
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF', hash: KDF_HASH,
      // Соль пустая осознанно: ECDH-секрет уже уникален для пары ключей, а
      // случайную соль пришлось бы передавать вместе с каждым сообщением.
      // Разделение по назначению делает info.
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    hkdfKey,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Одноразовый ключ содержимого. Им шифруется само сообщение. */
export async function generateContentKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES, length: 256 }, true, ['encrypt', 'decrypt'])
}

export interface Sealed { iv: string; ct: string }

async function seal(key: CryptoKey, data: BufferSource): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, key, data)
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) }
}

async function open(key: CryptoKey, s: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt({ name: AES, iv: unb64(s.iv) }, key, unb64(s.ct))
  return new Uint8Array(pt)
}

/** Зашифровать текст ключом содержимого. */
export async function encryptText(key: CryptoKey, text: string): Promise<Sealed> {
  const bytes = new TextEncoder().encode(text)
  return seal(key, new Uint8Array(bytes).slice())
}

/** Расшифровать текст. Бросает, если ключ не тот или шифротекст подменён. */
export async function decryptText(key: CryptoKey, s: Sealed): Promise<string> {
  return new TextDecoder().decode(await open(key, s))
}

/** Упаковать ключ содержимого для одного устройства-получателя. */
export async function wrapContentKey(kek: CryptoKey, cek: CryptoKey): Promise<Sealed> {
  const raw = await crypto.subtle.exportKey('raw', cek)
  return seal(kek, raw)
}

export async function unwrapContentKey(kek: CryptoKey, wrapped: Sealed): Promise<CryptoKey> {
  const raw = await open(kek, wrapped)
  return crypto.subtle.importKey('raw', raw, { name: AES, length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Отпечаток публичного ключа — чтобы люди могли сверить ключи голосом («цифры совпали?»). */
export async function fingerprint(pub: CryptoKey): Promise<string> {
  const jwk = await exportPublicKey(pub)
  const raw = new TextEncoder().encode(`${jwk.crv}|${jwk.x}|${jwk.y}`)
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
  // Пять групп по пять цифр — читается вслух без путаницы, в отличие от hex.
  let out = ''
  for (let i = 0; i < 25; i++) {
    if (i && i % 5 === 0) out += ' '
    out += (h[i] % 10).toString()
  }
  return out
}

// ---- base64 без зависимостей -------------------------------------------------
export function b64(u8: Uint8Array<ArrayBuffer>): string {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}
// Возвращаем Uint8Array поверх ЯВНОГО ArrayBuffer: WebCrypto в свежих типах
// принимает только его, а не Uint8Array<ArrayBufferLike> (тот может оказаться и
// SharedArrayBuffer, который для крипто-операций не годится).
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const u8 = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}
