import {
  deriveSharedKey, generateContentKey, encryptText, decryptText,
  wrapContentKey, unwrapContentKey, b64, unb64, type Sealed,
} from './core'
import type { DeviceKey } from './keys'

// v1.294.0: формат зашифрованного сообщения.
//
// Конверт кладётся в то же поле content обычным текстом, помеченный невидимым
// разделителем — ровно тот же приём, что у системных сообщений (см. sysmsg.ts).
// Поэтому миграция базы под шифрование не нужна, а старые сообщения продолжают
// читаться как раньше: маркера у них нет.
//
// Схема на одно сообщение:
//   1. Создаётся ОДНОРАЗОВЫЙ ключ содержимого — им шифруется текст.
//   2. Этот ключ упаковывается отдельно для каждого устройства получателя И для
//      своих устройств тоже, иначе отправитель не прочитал бы собственное
//      сообщение со второго своего устройства.
//   3. Упаковка делается ключом, выведенным из ECDH между моим приватным и
//      публичным ключом устройства-адресата.
//
// Почему одноразовый ключ, а не шифрование текста напрямую общим секретом: текст
// шифруется РОВНО ОДИН раз независимо от числа устройств, а дублируется только
// маленький ключ. Иначе сообщение на пять устройств весило бы впятеро больше.

/** Невидимый разделитель — тот же символ, что у системных сообщений. */
const MARK = '⁣'
const PREFIX = MARK + 'e2ee' + MARK
const INFO = 'ponoi/dm/v1'

export interface Envelope {
  v: 1
  /** Кто отправил — нужно, чтобы получатель нашёл публичный ключ для ECDH. */
  su: string
  sd: string
  /** Содержимое под одноразовым ключом. */
  iv: string
  ct: string
  /** Одноразовый ключ, упакованный для каждого устройства: id устройства -> упаковка. */
  k: Record<string, Sealed>
}

export function isEncrypted(content: string | null | undefined): boolean {
  return !!content && content.startsWith(PREFIX)
}

/**
 * Запечатать текст для перечисленных устройств.
 *
 * `recipients` должен включать и устройства получателя, и свои собственные —
 * решение о составе принимает вызывающая сторона, здесь мы просто шифруем для всех,
 * кого дали.
 */
export async function sealMessage(
  text: string,
  myUserId: string,
  myDeviceId: string,
  myPrivate: CryptoKey,
  recipients: DeviceKey[],
): Promise<string> {
  if (recipients.length === 0) {
    throw new Error('Не для кого шифровать: у собеседника нет ни одного ключа устройства')
  }
  const cek = await generateContentKey()
  const body = await encryptText(cek, text)

  const k: Record<string, Sealed> = {}
  for (const r of recipients) {
    // Своё устройство тоже получает упаковку — и это принципиально. Сначала я его
    // пропускал, рассуждая, что «своё сообщение и так своё»; но текст нигде не
    // хранится в открытом виде, и после перезапуска приложения отправитель не смог
    // бы прочитать собственную отправленную реплику. ECDH со своей же парой ключей
    // математически корректен и даёт стабильный секрет, так что упаковываем как всем.
    const kek = await deriveSharedKey(myPrivate, r.publicKey, INFO)
    k[r.deviceId] = await wrapContentKey(kek, cek)
  }

  const env: Envelope = { v: 1, su: myUserId, sd: myDeviceId, iv: body.iv, ct: body.ct, k }
  // Через TextEncoder, а не btoa(unescape(encodeURIComponent(...))): тот приём
  // держится на устаревших unescape/escape и ломается на редких символах.
  return PREFIX + b64(new Uint8Array(new TextEncoder().encode(JSON.stringify(env))).slice())
}

export function parseEnvelope(content: string): Envelope | null {
  if (!isEncrypted(content)) return null
  try {
    const json = new TextDecoder().decode(unb64(content.slice(PREFIX.length)))
    const env = JSON.parse(json)
    if (env && env.v === 1 && typeof env.ct === 'string' && env.k && typeof env.sd === 'string') return env
  } catch { /* испорченный конверт — ниже вернётся null и покажется «не удалось прочитать» */ }
  return null
}

/** Ошибка, по которой интерфейс отличает «не мне адресовано» от «сломалось». */
export class NotForThisDevice extends Error {}

/**
 * Распечатать сообщение своим ключом.
 *
 * `senderKey` — публичный ключ УСТРОЙСТВА отправителя (env.sd), а не любого его
 * устройства: общий секрет выводится ровно между парой устройств.
 */
export async function openMessage(
  env: Envelope,
  myDeviceId: string,
  myPrivate: CryptoKey,
  senderKey: CryptoKey,
): Promise<string> {
  const wrapped = env.k[myDeviceId]
  if (!wrapped) {
    // Обычное дело, а не поломка: сообщение отправили до того, как это устройство
    // опубликовало свой ключ. Интерфейс показывает понятную подпись, а не ошибку.
    throw new NotForThisDevice('Это сообщение зашифровано не для этого устройства')
  }
  const kek = await deriveSharedKey(myPrivate, senderKey, INFO)
  const cek = await unwrapContentKey(kek, wrapped)
  return decryptText(cek, { iv: env.iv, ct: env.ct })
}
