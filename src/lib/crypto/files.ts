import { generateContentKey, b64, unb64, type Sealed } from './core'

// v1.299.0: шифрование вложений.
//
// Файлы лежат в общем хранилище и до сих пор были доступны всем, у кого есть
// ссылка, — то есть переписка шифровалась, а отправленная в ней фотография нет.
// Здесь файл шифруется на своём одноразовом ключе перед отправкой, а сам ключ
// уезжает внутри зашифрованного сообщения (см. dm.ts), поэтому достать его можно
// только расшифровав переписку.
//
// Почему у файла отдельный ключ, а не тот же, что у текста: ссылку на вложение
// можно переслать, а вместе с ней не должен уезжать ключ от всей беседы.

const AES = 'AES-GCM'
const IV_BYTES = 12
/** Потолок на расшифровку в памяти. Шифрование потоком WebCrypto не умеет, поэтому
 *  файл целиком оказывается в памяти — на больших видео это недопустимо. */
export const MAX_ENCRYPTABLE = 100 * 1024 * 1024

/** Ключ файла в переносимом виде — именно он кладётся в зашифрованное сообщение. */
export interface FileKey { k: string; iv: string; name: string; type: string }

export class TooLargeToEncrypt extends Error {}

/**
 * Зашифровать файл целиком. Возвращает шифротекст для загрузки и ключ, который
 * нужно доставить получателю внутри сообщения.
 */
export async function encryptFile(file: File): Promise<{ blob: Blob; key: FileKey }> {
  if (file.size > MAX_ENCRYPTABLE) {
    throw new TooLargeToEncrypt(
      `Файл больше ${MAX_ENCRYPTABLE / 1024 / 1024} МБ — такой можно отправить только без шифрования`)
  }
  const cek = await generateContentKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = new Uint8Array(await file.arrayBuffer())
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, cek, data)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', cek))
  return {
    // Тип намеренно нейтральный: хранилище не должно знать, картинка это или
    // документ — по типу содержимого тоже можно многое понять о переписке.
    blob: new Blob([ct], { type: 'application/octet-stream' }),
    key: { k: b64(raw), iv: b64(iv), name: file.name, type: file.type || 'application/octet-stream' },
  }
}

/** Расшифровать скачанное вложение обратно в пригодный для показа объект. */
export async function decryptFile(cipher: ArrayBuffer, key: FileKey): Promise<Blob> {
  const cek = await crypto.subtle.importKey('raw', unb64(key.k), { name: AES, length: 256 }, false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: AES, iv: unb64(key.iv) }, cek, cipher)
  // Тип возвращаем настоящий — он нужен, чтобы браузер показал картинку картинкой.
  return new Blob([pt], { type: key.type })
}

/** Пометка в ссылке, по которой видно, что вложение зашифровано. */
const ENC_MARK = '#enc'
export function markEncrypted(url: string): string { return url + ENC_MARK }
export function isEncryptedUrl(url: string): boolean { return url.endsWith(ENC_MARK) }
export function stripEncMark(url: string): string {
  return isEncryptedUrl(url) ? url.slice(0, -ENC_MARK.length) : url
}

/** Для проверок: упаковка ключа файла как Sealed не нужна — он и так едет внутри
 *  зашифрованного сообщения, но тип экспортируем, чтобы им пользовался dm.ts. */
export type { Sealed }
