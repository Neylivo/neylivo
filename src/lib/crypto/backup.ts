import { b64, unb64, type Sealed } from './core'

// v1.366.0: резервная копия ключа личных сообщений, запертая паролем.
//
// Зачем. Ключ жил только на устройстве и стирался при выходе. Вместе с ним
// пропадала переписка: после перезахода человек видел «Сообщение зашифровано для
// другого устройства» вместо собственных сообщений.
//
// Как. Из пароля выводим ключ (PBKDF2), им запираем приватный ключ, и на сервер
// уходит только запертое. Пароль туда не попадает никогда.
//
// Почему PBKDF2 с большим числом повторов: пароль человека — короткий и угадываемый,
// а строка на сервере может однажды утечь. Повторы делают перебор дорогим. 250 000 —
// то, что современный браузер считает примерно за четверть секунды, то есть
// незаметно при входе и очень заметно при переборе миллионов вариантов.

const ITERATIONS = 250_000
const SALT_BYTES = 16

/** Соль — не секрет, но обязана быть разной у всех: одна на всех делает перебор общим. */
export function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
}

/** Ключ-замок из пароля. Наружу не отдаётся и никуда не сохраняется. */
async function kekFromPassword(password: string, salt: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Запереть приватный ключ паролем.
 *
 * Ключ приходит уже выгруженным в JWK: выгрузить его может только тот, кто им
 * владеет, и только если он создан извлекаемым (см. generateIdentity).
 */
export async function wrapPrivateKey(jwk: JsonWebKey, password: string, salt: string): Promise<Sealed> {
  const kek = await kekFromPassword(password, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, kek, new TextEncoder().encode(JSON.stringify(jwk)),
  )
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) }
}

/**
 * Открыть копию паролем. Неверный пароль — исключение, а не мусор: AES-GCM
 * проверяет целостность сам, подобрать «почти правильный» ключ нельзя.
 */
export async function unwrapPrivateKey(sealed: Sealed, password: string, salt: string): Promise<JsonWebKey> {
  const kek = await kekFromPassword(password, salt)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(sealed.iv) }, kek, unb64(sealed.ct),
  )
  return JSON.parse(new TextDecoder().decode(pt)) as JsonWebKey
}

/** Понятно ли, что пароль просто не тот. Отличаем от «копия испорчена». */
export function isWrongPassword(e: unknown): boolean {
  // WebCrypto на неверном ключе бросает OperationError без подробностей — это
  // и есть «пароль не тот». Всё остальное (нет полей, не разобрался JSON) —
  // испорченная копия, и путать одно с другим нельзя: человеку нужны разные слова.
  const name = (e as any)?.name
  return name === 'OperationError' || e instanceof DOMException
}
