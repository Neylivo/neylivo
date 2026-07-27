import { myIdentity, deviceId, fetchDeviceKeys, type DeviceKey } from './keys'
import { sealMessage, parseEnvelope, openMessage, isEncrypted, NotForThisDevice } from './envelope'

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

/** Сбросить кэш ключей — например, когда пришло уведомление о новом устройстве. */
export function forgetCachedKeys(userId?: string) {
  if (userId) keyCache.delete(userId); else keyCache.clear()
}

export class NoRecipientKeys extends Error {}

/**
 * Зашифровать текст для собеседника и всех своих устройств.
 * Бросает NoRecipientKeys, если шифровать не для кого — отправлять открытым
 * текстом «на всякий случай» нельзя.
 */
export async function sealForPeer(text: string, myUserId: string, peerUserId: string): Promise<string> {
  const [mine, theirs] = await Promise.all([keysOf(myUserId), keysOf(peerUserId)])
  if (theirs.length === 0) {
    throw new NoRecipientKeys('У собеседника пока нет ключа — он не заходил в приложение с этой версией')
  }
  const id = await myIdentity()
  // Свои устройства тоже в списке: иначе не прочитаешь собственную переписку
  // ни со второго устройства, ни с этого же после перезапуска.
  const recipients = [...theirs, ...mine]
  return sealMessage(text, myUserId, deviceId(), id.privateKey, recipients)
}

/** Что показать вместо текста, если расшифровать не вышло. */
export const UNREADABLE_OTHER_DEVICE = '🔒 Сообщение зашифровано для другого устройства'
export const UNREADABLE_BROKEN = '🔒 Не удалось расшифровать сообщение'

/**
 * Прочитать входящее. Возвращает исходный текст, если это не зашифрованное
 * сообщение, — старая переписка и системные сообщения проходят насквозь.
 */
export async function openIncoming(content: string, senderUserId: string): Promise<string> {
  if (!isEncrypted(content)) return content
  const env = parseEnvelope(content)
  if (!env) return UNREADABLE_BROKEN
  try {
    let keys = await keysOf(senderUserId)
    let senderKey = keys.find(k => k.deviceId === env.sd)
    if (!senderKey) {
      // Устройство отправителя новее нашего кэша — перечитываем, прежде чем
      // объявлять сообщение нечитаемым.
      keys = await keysOf(senderUserId, true)
      senderKey = keys.find(k => k.deviceId === env.sd)
    }
    if (!senderKey) return UNREADABLE_BROKEN
    const id = await myIdentity()
    return await openMessage(env, deviceId(), id.privateKey, senderKey.publicKey)
  } catch (e) {
    return e instanceof NotForThisDevice ? UNREADABLE_OTHER_DEVICE : UNREADABLE_BROKEN
  }
}

/** Есть ли у собеседника хоть один ключ — для индикатора «шифрование доступно». */
export async function peerHasKeys(peerUserId: string): Promise<boolean> {
  try { return (await keysOf(peerUserId)).length > 0 } catch { return false }
}
