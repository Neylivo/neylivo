// v1.541.0: вход в аккаунт по коду с телефона.
//
// Владелец: «добавь заход в аккаунт по QR-коду с компа на телефон или наоборот
// — когда надо через ПК зайти, а залогинен в телефоне, можно отсканировать и
// без пароля зайдёшь».
//
// СУТЬ. Компьютер, где никто не вошёл, показывает QR. Телефон, где человек уже
// вошёл, его читает, спрашивает «это правда ты?» и передаёт свою сессию.
// Компьютер оказывается внутри, пароль не набирается нигде.
//
// ГЛАВНОЕ ПРАВИЛО, ради которого этот файл отдельный: сессия не бывает на
// сервере в открытом виде. Компьютер делает одноразовую пару ключей и печатает
// ОТКРЫТУЮ половину прямо в QR-код. Телефон шифрует ею. В базе лежит шифротекст,
// и ключа к нему там нет.
//
// Почему открытый ключ именно в QR, а не в базе: если бы телефон брал ключ
// оттуда, сервер мог бы подсунуть свой и прочитать сессию, оставшись
// незамеченным. QR — единственный путь, который сервер не контролирует: с
// экрана в камеру.
//
// Здесь чистая часть: как выглядит содержимое кода, как оно разбирается и что
// считается негодным. Работа с сервером и камерой — в компонентах, потому что
// там нечего проверять числами, а это — можно (npm run test:ui).

/** Метка версии в начале кода: по ней отличается наш QR от чужого. */
export const QR_PREFIX = 'NEYLIVO1'

/** Сколько живёт заявка. Столько же стоит в 109_qr_login.sql. */
export const QR_TTL_MS = 2 * 60 * 1000

/**
 * Алфавит base32 (RFC 4648, без padding).
 *
 * Почему не base64. QR-код умеет «буквенно-цифровой» режим, в который входят
 * только цифры, ЗАГЛАВНЫЕ латинские буквы и десяток знаков. Строка из этого
 * набора кодируется вдвое плотнее, чем произвольная: тот же ключ даёт заметно
 * более крупные квадратики, а крупные квадратики — это то, что телефон ловит с
 * первого раза, а не с пятого. base64 с его строчными буквами и подчёркиванием
 * выбрасывает код в побайтовый режим.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function b32(u8: Uint8Array): string {
  let бит = 0, накоплено = 0, из = ''
  for (const б of u8) {
    накоплено = (накоплено << 8) | б
    бит += 8
    while (бит >= 5) {
      из += B32[(накоплено >>> (бит - 5)) & 31]
      бит -= 5
    }
  }
  if (бит > 0) из += B32[(накоплено << (5 - бит)) & 31]
  return из
}

export function unb32(s: string): Uint8Array {
  let бит = 0, накоплено = 0
  const из: number[] = []
  for (const ч of s.toUpperCase()) {
    const i = B32.indexOf(ч)
    if (i < 0) continue
    накоплено = (накоплено << 5) | i
    бит += 5
    if (бит >= 8) {
      из.push((накоплено >>> (бит - 8)) & 255)
      бит -= 8
    }
  }
  return new Uint8Array(из)
}

export interface QrPayload {
  /** Секрет заявки. На сервер уходит только его отпечаток. */
  code: string
  /** Открытая половина одноразового ключа компьютера, base32. */
  pub: string
}

/** Собрать содержимое QR-кода. */
export function qrPayload(p: QrPayload): string {
  return QR_PREFIX + ':' + p.code + ':' + p.pub
}

/**
 * Разобрать прочитанное камерой.
 *
 * Возвращает null на всём, что не наше: камера ловит любые коды, что попадутся
 * в кадр, — от ценника в магазине до чужого wi-fi. Молчаливый отказ здесь лучше
 * ошибки: человек просто наводит дальше.
 */
export function parseQr(текст: string): QrPayload | null {
  const части = String(текст || '').trim().split(':')
  if (части.length !== 3) return null
  if (части[0] !== QR_PREFIX) return null
  const [, code, pub] = части
  // Длины проверяем строго: короткий «код» — это либо обрезанное распознавание,
  // либо чья-то попытка подсунуть заявку со слабым секретом.
  if (!/^[A-Z2-7]{26,}$/.test(code)) return null
  if (!/^[A-Z2-7]{100,}$/.test(pub)) return null
  return { code, pub }
}

/** Отпечаток секрета: на сервер уходит он, а не сам секрет. */
export async function codeHash(code: string): Promise<string> {
  const b = new TextEncoder().encode(QR_PREFIX + ':' + code)
  const h = await crypto.subtle.digest('SHA-256', b)
  return b32(new Uint8Array(h))
}

/** Новый секрет заявки: 16 случайных байт, 26 знаков base32. */
export function newCode(): string {
  return b32(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * Заявка просрочена?
 *
 * Считается на стороне того, кто спрашивает, и ЕЩЁ РАЗ на сервере. Здесь — чтобы
 * не показывать человеку живой QR, который уже мёртв; там — чтобы просроченную
 * нельзя было подтвердить, даже если часы на устройстве перевели.
 */
export function qrExpired(созданаМс: number, сейчас = Date.now()): boolean {
  return сейчас - созданаМс >= QR_TTL_MS
}

/** Сколько секунд осталось — для подписи «код обновится через 47 с». */
export function qrLeftSec(созданаМс: number, сейчас = Date.now()): number {
  return Math.max(0, Math.ceil((QR_TTL_MS - (сейчас - созданаМс)) / 1000))
}

/**
 * Что показать на телефоне вместо голого «войти?».
 *
 * Человек должен понимать, ЧТО он впускает. Строка собирается из того, что
 * прислал компьютер, и обрезается: подпись устройства приходит с чужой стороны,
 * и в неё можно затолкать что угодно — хоть три экрана текста, хоть перевод
 * строки, лишь бы кнопка «нет» уехала за край.
 */
export function qrDeviceLabel(сырое: string): string {
  const t = String(сырое || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 60) : 'Неизвестное устройство'
}

/** Что за устройство просит вход — для подписи на телефоне. */
export function qrMyDeviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const десктоп = typeof window !== 'undefined' && !!(window as unknown as { neylivoDesktop?: unknown }).neylivoDesktop
  const система = /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
      : /Android/i.test(ua) ? 'Android'
        : /Linux/i.test(ua) ? 'Linux' : 'Неизвестная система'
  return система + ' · ' + (десктоп ? 'приложение NeyLivo' : 'браузер')
}

/** Сессия, которую телефон передаёт компьютеру. Больше в шифротекст не кладём. */
export interface QrSession {
  access_token: string
  refresh_token: string
}

/** Годится ли то, что расшифровали, на роль сессии. */
export function validSession(x: unknown): x is QrSession {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.access_token === 'string' && o.access_token.length > 20
    && typeof o.refresh_token === 'string' && o.refresh_token.length > 10
}

// ── Ключи ───────────────────────────────────────────────────────────────────
//
// Обе стороны считают общий ключ по Диффи — Хеллману: компьютер делает
// одноразовую пару и печатает открытую половину в QR, телефон делает свою и
// кладёт открытую половину в заявку. Общий ключ получается у обоих, а на сервере
// его нет и быть не может — там лежат только две открытые половины и шифротекст.
//
// Живёт здесь, а не рядом с запросами к серверу, ровно затем, чтобы это можно
// было проверить числами: сходится ли ключ у своей пары и НЕ сходится ли у
// чужой. Без второго утверждения первое ничего не стоит.
const CURVE = 'P-256'
const AES = 'AES-GCM'
/** Разделение по назначению: этот же общий секрет больше нигде не используется. */
const INFO = 'ponoi-qr-login-v1'

export async function qrPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE }, false, ['deriveBits'],
  ) as CryptoKeyPair
}

export async function qrPubToB32(k: CryptoKey): Promise<string> {
  return b32(new Uint8Array(await crypto.subtle.exportKey('raw', k)))
}

export async function qrPubFromB32(s: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb32(s).slice(), { name: 'ECDH', namedCurve: CURVE }, false, [])
}

export async function qrSharedKey(свой: CryptoKey, чужой: CryptoKey): Promise<CryptoKey> {
  const биты = await crypto.subtle.deriveBits({ name: 'ECDH', public: чужой }, свой, 256)
  const hk = await crypto.subtle.importKey('raw', биты, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(INFO) },
    hk, { name: AES, length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

/** Запечатать сессию для того, чей открытый ключ нарисован в коде. */
export async function qrSeal(ключ: CryptoKey, тело: QrSession): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: AES, iv: iv.slice() }, ключ, new TextEncoder().encode(JSON.stringify(тело)),
  )
  return { iv: b32(iv), ct: b32(new Uint8Array(ct)) }
}

/** Распечатать. Бросает, если ключ не тот — это и есть защита от подмены. */
export async function qrOpen(ключ: CryptoKey, iv: string, ct: string): Promise<QrSession> {
  const открыто = await crypto.subtle.decrypt(
    { name: AES, iv: unb32(iv).slice() }, ключ, unb32(ct).slice(),
  )
  const сессия = JSON.parse(new TextDecoder().decode(открыто))
  if (!validSession(сессия)) throw new Error('в ответе не сессия')
  return сессия
}
