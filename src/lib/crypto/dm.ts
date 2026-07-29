import { myIdentity, deviceId, fetchDeviceKeys, type DeviceKey } from './keys'
import { sealMessage, parseEnvelope, openMessage, isEncrypted, NotForThisDevice } from './envelope'
import type { FileKey } from './files'

// v1.295.0: связующий слой между криптографией и личными сообщениями.
//
// Здесь живут кэши и решение «шифровать или отказаться». Главное правило, ради
// которого этот файл вообще отдельный: НИКАКОГО тихого отката к открытому тексту.
// Если зашифровать не удалось — сообщение не уходит, и человек видит причину.
// Молчаливый откат — классический способ превратить защиту в её видимость: люди
// продолжают считать переписку закрытой, а она уже нет.

/** Ключи устройств по пользователю. Живут недолго: человек может завести устройство. */
const keyCache = new Map<string, { keys: DeviceKey[]; at: number }>()
const KEY_TTL = 60_000

async function keysOf(userId: string, force = false): Promise<DeviceKey[]> {
  const hit = keyCache.get(userId)
  if (!force && hit && Date.now() - hit.at < KEY_TTL) return hit.keys
  const keys = await fetchDeviceKeys(userId)
  keyCache.set(userId, { keys, at: Date.now() })
  return keys
}

export class NoRecipientKeys extends Error {}

// v1.300.0: когда к сообщению приложены файлы, внутри конверта едет не голый текст,
// а маленькая структура с текстом и ключами вложений. Отличается она по невидимой
// метке в начале: без неё пришлось бы гадать, текст это или JSON, а сообщение
// «{"t":...}», набранное человеком руками, разобралось бы как структура.
const PAYLOAD_MARK = '⁢p1⁢'

export interface DmPayload { text: string; files: FileKey[] }

function packPayload(text: string, files: FileKey[]): string {
  return files.length ? PAYLOAD_MARK + JSON.stringify({ t: text, f: files }) : text
}

function unpackPayload(raw: string): DmPayload {
  if (!raw.startsWith(PAYLOAD_MARK)) return { text: raw, files: [] }
  try {
    const j = JSON.parse(raw.slice(PAYLOAD_MARK.length))
    return { text: String(j.t ?? ''), files: Array.isArray(j.f) ? j.f : [] }
  } catch {
    return { text: raw, files: [] }
  }
}

/**
 * Зашифровать текст для собеседника и всех своих устройств.
 * Бросает NoRecipientKeys, если шифровать не для кого — отправлять открытым
 * текстом «на всякий случай» нельзя.
 */
export async function sealForPeer(text: string, myUserId: string, peerUserId: string, files: FileKey[] = []): Promise<string> {
  const [mine, theirs] = await Promise.all([keysOf(myUserId), keysOf(peerUserId)])
  if (theirs.length === 0) {
    throw new NoRecipientKeys('У собеседника пока нет ключа — он не заходил в приложение с этой версией')
  }
  const id = await myIdentity()
  // Свои устройства тоже в списке: иначе не прочитаешь собственную переписку
  // ни со второго устройства, ни с этого же после перезапуска.
  const recipients = [...theirs, ...mine]
  return sealMessage(packPayload(text, files), myUserId, deviceId(), id.privateKey, recipients)
}

/** Что показать вместо текста, если расшифровать не вышло. */
export const UNREADABLE_OTHER_DEVICE = 'Сообщение зашифровано для другого устройства'
export const UNREADABLE_BROKEN = 'Сообщение не удалось прочитать'

/**
 * Не удалось ли прочитать это сообщение.
 *
 * v1.345.0: раньше признаком служил эмодзи-замок в начале строки — на него
 * опиралась, например, передача ключа звонка («если начинается с замка, это не
 * ключ»). Признак по внешнему виду текста хрупок: стоит поменять надпись — и
 * нечитаемое сообщение начинает считаться настоящим содержимым. Сравниваем с
 * самими константами, а надписи теперь можно менять свободно.
 */
export const isUnreadable = (text: string | null | undefined): boolean =>
  text === UNREADABLE_BROKEN || text === UNREADABLE_OTHER_DEVICE

/**
 * Прочитать входящее. Возвращает исходный текст, если это не зашифрованное
 * сообщение, — старая переписка и системные сообщения проходят насквозь.
 */
export async function openIncoming(content: string, senderUserId: string): Promise<DmPayload> {
  if (!isEncrypted(content)) return { text: content, files: [] }
  const env = parseEnvelope(content)
  if (!env) return { text: UNREADABLE_BROKEN, files: [] }
  try {
    let keys = await keysOf(senderUserId)
    let senderKey = keys.find(k => k.deviceId === env.sd)
    if (!senderKey) {
      // Устройство отправителя новее нашего кэша — перечитываем, прежде чем
      // объявлять сообщение нечитаемым.
      keys = await keysOf(senderUserId, true)
      senderKey = keys.find(k => k.deviceId === env.sd)
    }
    if (!senderKey) return { text: UNREADABLE_BROKEN, files: [] }
    const id = await myIdentity()
    return unpackPayload(await openMessage(env, deviceId(), id.privateKey, senderKey.publicKey))
  } catch (e) {
    return { text: e instanceof NotForThisDevice ? UNREADABLE_OTHER_DEVICE : UNREADABLE_BROKEN, files: [] }
  }
}
