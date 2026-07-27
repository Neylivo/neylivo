import {
  generateIdentity, exportPublicKey, importPublicKey, deriveSharedKey,
  generateContentKey, encryptText, decryptText, wrapContentKey, unwrapContentKey,
  fingerprint, b64, unb64, type IdentityKeyPair,
} from './core'

const lines: string[] = []
const ok = (name: string, cond: boolean, extra = '') =>
  lines.push(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
const paint = () => { document.getElementById('out')!.textContent = lines.join('\n') }

async function sameBytes(blob: Blob, expect: Uint8Array): Promise<boolean> {
  const got = new Uint8Array(await blob.arrayBuffer())
  if (got.length !== expect.length) return false
  for (let i = 0; i < got.length; i++) if (got[i] !== expect[i]) return false
  return true
}

async function mustThrow(name: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(name, false, 'НЕ бросило исключение — это дыра') }
  catch { ok(name, true, 'отказ, как и должно') }
}

async function main() {
  // --- 1. Пара ключей и неизвлекаемость -------------------------------------
  const alice = await generateIdentity()
  const bob = await generateIdentity()
  ok('приватный ключ неизвлекаем', alice.privateKey.extractable === false)
  await mustThrow('попытка выгрузить приватный ключ', () =>
    crypto.subtle.exportKey('jwk', alice.privateKey))

  // --- 2. ECDH симметричен: обе стороны получают ОДИН ключ ------------------
  const aPub = await importPublicKey(await exportPublicKey(alice.publicKey))
  const bPub = await importPublicKey(await exportPublicKey(bob.publicKey))
  const kAlice = await deriveSharedKey(alice.privateKey, bPub, 'ponoi/dm/v1')
  const kBob = await deriveSharedKey(bob.privateKey, aPub, 'ponoi/dm/v1')

  const s1 = await encryptText(kAlice, 'привет, это секрет 🔒')
  ok('Боб расшифровывает написанное Алисой', await decryptText(kBob, s1) === 'привет, это секрет 🔒')

  const s2 = await encryptText(kBob, 'и тебе привет')
  ok('Алиса расшифровывает написанное Бобом', await decryptText(kAlice, s2) === 'и тебе привет')

  // --- 3. Чужой не расшифрует ------------------------------------------------
  const eve = await generateIdentity()
  const kEve = await deriveSharedKey(eve.privateKey, aPub, 'ponoi/dm/v1')
  await mustThrow('посторонний с своей парой ключей', () => decryptText(kEve, s1))

  // --- 4. Подмена шифротекста ловится (целостность GCM) ----------------------
  const tampered = { ...s1 }
  const raw = unb64(tampered.ct); raw[0] ^= 1; tampered.ct = b64(raw)
  await mustThrow('подменённый на сервере шифротекст', () => decryptText(kBob, tampered))

  const badIv = { ...s1 }
  const ivb = unb64(badIv.iv); ivb[0] ^= 1; badIv.iv = b64(ivb)
  await mustThrow('подменённый вектор инициализации', () => decryptText(kBob, badIv))

  // --- 5. Разделение по назначению ------------------------------------------
  const kOther = await deriveSharedKey(bob.privateKey, aPub, 'ponoi/files/v1')
  await mustThrow('ключ от другого назначения (info)', () => decryptText(kOther, s1))

  // --- 6. Одноразовый ключ содержимого и его упаковка -----------------------
  const cek = await generateContentKey()
  const msg = await encryptText(cek, 'сообщение под одноразовым ключом')
  const wrapped = await wrapContentKey(kAlice, cek)
  const cek2 = await unwrapContentKey(kBob, wrapped)
  ok('получатель распаковал ключ и прочитал',
    await decryptText(cek2, msg) === 'сообщение под одноразовым ключом')
  await mustThrow('распаковка ключа чужим', () => unwrapContentKey(kEve, wrapped))

  // --- 7. Каждое шифрование даёт разный шифротекст ---------------------------
  const t1 = await encryptText(kAlice, 'одно и то же')
  const t2 = await encryptText(kAlice, 'одно и то же')
  ok('одинаковый текст шифруется по-разному', t1.ct !== t2.ct && t1.iv !== t2.iv,
    'иначе по базе было бы видно, что сообщения совпадают')

  // --- 8. Отпечаток ----------------------------------------------------------
  const f1 = await fingerprint(alice.publicKey)
  const f2 = await fingerprint(await importPublicKey(await exportPublicKey(alice.publicKey)))
  const fb = await fingerprint(bob.publicKey)
  ok('отпечаток устойчив', f1 === f2, f1)
  ok('у разных ключей отпечатки разные', f1 !== fb)

  // --- 9. Длинное сообщение и юникод ----------------------------------------
  const long = 'Ж'.repeat(50000) + '👾🔐'
  ok('длинный текст с эмодзи', await decryptText(kBob, await encryptText(kAlice, long)) === long)

  // --- 10. Ключ переживает перезапуск (IndexedDB) ---------------------------
  await new Promise<void>((res, rej) => {
    const r = indexedDB.open('ponoiCryptoTest', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('k')
    r.onerror = () => rej(r.error)
    r.onsuccess = () => {
      const tx = r.result.transaction('k', 'readwrite')
      tx.objectStore('k').put(alice.privateKey, 'priv')
      tx.oncomplete = () => {
        const r2 = indexedDB.open('ponoiCryptoTest', 1)
        r2.onsuccess = async () => {
          const g = r2.result.transaction('k', 'readonly').objectStore('k').get('priv')
          g.onsuccess = async () => {
            const restored = g.result as CryptoKey
            try {
              const k = await deriveSharedKey(restored, bPub, 'ponoi/dm/v1')
              ok('ключ из хранилища работает после перезапуска',
                await decryptText(k, s2) === 'и тебе привет')
              ok('и остаётся неизвлекаемым', restored.extractable === false)
            } catch (e: any) { ok('ключ из хранилища работает', false, e.message) }
            res()
          }
        }
      }
      tx.onerror = () => rej(tx.error)
    }
  })

  // --- 11. Ключи устройства: создание, сохранение, забывание -----------------
  const { myIdentity, deviceId, forgetIdentity } = await import('./keys')

  await forgetIdentity()               // начинаем с чистого листа
  const dev1 = deviceId()
  ok('идентификатор устройства выдан', /^[0-9a-f-]{36}$/i.test(dev1), dev1)
  ok('и он постоянен', deviceId() === dev1)

  const id1 = await myIdentity()
  const id2 = await myIdentity()
  ok('повторный вызов даёт ту же пару', id1.privateKey === id2.privateKey)
  ok('приватный ключ устройства неизвлекаем', id1.privateKey.extractable === false)

  // Проверяем главное свойство: забытые ключи не восстанавливаются, и переписка,
  // зашифрованная для старого устройства, новым ключом не читается.
  const probe = await deriveSharedKey(id1.privateKey, bPub, 'ponoi/dm/v1')
  const sealed = await encryptText(probe, 'после перезапуска')
  await forgetIdentity()
  const id3 = await myIdentity()
  ok('после забывания ключей выдаётся ДРУГАЯ пара', id3.privateKey !== id1.privateKey)
  const probe2 = await deriveSharedKey(id3.privateKey, bPub, 'ponoi/dm/v1')
  await mustThrow('старое сообщение новым ключом не читается', () => decryptText(probe2, sealed))
  ok('идентификатор устройства тоже сменился', deviceId() !== dev1)

  // --- 12. Конверт сообщения: несколько устройств, чужие, подмена -------------
  const { sealMessage, parseEnvelope, openMessage, isEncrypted, NotForThisDevice } = await import('./envelope')
  type DK = import('./keys').DeviceKey

  // Алиса с одного устройства пишет Бобу, у которого их два, и себе на второе.
  const aliceDev2 = await generateIdentity()
  const bobDev1 = bob
  const bobDev2 = await generateIdentity()
  const mk = async (userId: string, deviceId: string, kp: IdentityKeyPair): Promise<DK> => ({
    userId, deviceId, publicKey: await importPublicKey(await exportPublicKey(kp.publicKey)), fingerprint: '',
  })
  const recips: DK[] = [
    await mk('bob', 'bob-phone', bobDev1),
    await mk('bob', 'bob-pc', bobDev2),
    await mk('alice', 'alice-phone', aliceDev2),
    await mk('alice', 'alice-pc', alice),      // своё же — должно быть пропущено
  ]
  const envStr = await sealMessage('секрет для двоих устройств', 'alice', 'alice-pc', alice.privateKey, recips)

  ok('конверт помечен как зашифрованный', isEncrypted(envStr))
  ok('обычный текст зашифрованным не считается', !isEncrypted('просто сообщение'))
  ok('в конверте не видно исходного текста', !envStr.includes('секрет'))

  const env = parseEnvelope(envStr)!
  ok('конверт разбирается', !!env && env.su === 'alice' && env.sd === 'alice-pc')
  ok('ключ упакован для ВСЕХ четырёх устройств', Object.keys(env.k).length === 4, Object.keys(env.k).join(', '))

  const alicePub = await importPublicKey(await exportPublicKey(alice.publicKey))
  ok('телефон Боба читает',
    await openMessage(env, 'bob-phone', bobDev1.privateKey, alicePub) === 'секрет для двоих устройств')
  ok('компьютер Боба читает',
    await openMessage(env, 'bob-pc', bobDev2.privateKey, alicePub) === 'секрет для двоих устройств')
  ok('второе устройство самой Алисы читает',
    await openMessage(env, 'alice-phone', aliceDev2.privateKey, alicePub) === 'секрет для двоих устройств')
  // Самое коварное: отправитель перезапустил приложение и открыл свою же переписку.
  // Текст нигде не хранится открытым, поэтому без упаковки для СВОЕГО устройства
  // он увидел бы собственное сообщение нечитаемым.
  ok('ОТПРАВИТЕЛЬ читает своё сообщение после перезапуска',
    await openMessage(env, 'alice-pc', alice.privateKey, alicePub) === 'секрет для двоих устройств')

  // Посторонний не читает, даже зная конверт целиком
  await mustThrow('посторонний с чужим ключом', () =>
    openMessage(env, 'bob-phone', eve.privateKey, alicePub))
  // Устройства нет среди получателей
  try {
    await openMessage(env, 'неизвестное-устройство', bobDev1.privateKey, alicePub)
    ok('устройство не в списке получателей', false, 'НЕ бросило')
  } catch (e) {
    ok('устройство не в списке получателей', e instanceof NotForThisDevice, 'отдельная ошибка, а не общий сбой')
  }

  // Подмена содержимого на сервере
  const tamperedEnv = JSON.parse(JSON.stringify(env))
  const tb = unb64(tamperedEnv.ct); tb[0] ^= 1; tamperedEnv.ct = b64(tb)
  await mustThrow('подменённое содержимое конверта', () =>
    openMessage(tamperedEnv, 'bob-phone', bobDev1.privateKey, alicePub))

  // Подмена упакованного ключа
  const tamperedKey = JSON.parse(JSON.stringify(env))
  const tk = unb64(tamperedKey.k['bob-phone'].ct); tk[0] ^= 1; tamperedKey.k['bob-phone'].ct = b64(tk)
  await mustThrow('подменённый упакованный ключ', () =>
    openMessage(tamperedKey, 'bob-phone', bobDev1.privateKey, alicePub))

  ok('мусор вместо конверта даёт null', parseEnvelope('⁣e2ee⁣не-база64!!!') === null)
  ok('пустой список получателей отвергается', await (async () => {
    try { await sealMessage('x', 'alice', 'alice-pc', alice.privateKey, []); return false } catch { return true }
  })())

  const longSecret = 'Тайна '.repeat(5000) + '🔒'
  const envLong = parseEnvelope(await sealMessage(longSecret, 'alice', 'alice-pc', alice.privateKey, recips))!
  ok('длинное сообщение с юникодом',
    await openMessage(envLong, 'bob-phone', bobDev1.privateKey, alicePub) === longSecret)

  // --- 13. Вложения ----------------------------------------------------------
  const { encryptFile, decryptFile, markEncrypted, isEncryptedUrl, stripEncMark, TooLargeToEncrypt, MAX_ENCRYPTABLE } = await import('./files')

  const bytes = new Uint8Array(4096)
  crypto.getRandomValues(bytes)
  const original = new File([bytes], 'секрет.png', { type: 'image/png' })

  const { blob, key } = await encryptFile(original)
  ok('шифротекст не совпадает с исходником', blob.size !== 0 && !(await sameBytes(blob, bytes)))
  ok('тип файла в хранилище обезличен', blob.type === 'application/octet-stream',
    'иначе по типу видно, картинка это или документ')
  ok('имя и настоящий тип уехали в ключ, а не в хранилище',
    key.name === 'секрет.png' && key.type === 'image/png')

  const back = await decryptFile(await blob.arrayBuffer(), key)
  ok('файл расшифровывается байт в байт', await sameBytes(back, bytes))
  ok('и получает обратно настоящий тип', back.type === 'image/png')

  const wrongKey = { ...key }
  const kb = unb64(wrongKey.k); kb[0] ^= 1; wrongKey.k = b64(kb)
  const cipherBuf = await blob.arrayBuffer()
  await mustThrow('чужой ключ файла', () => decryptFile(cipherBuf, wrongKey))

  const tamperedBuf = new Uint8Array(await blob.arrayBuffer()); tamperedBuf[0] ^= 1
  await mustThrow('подменённое вложение', () => decryptFile(tamperedBuf.buffer as ArrayBuffer, key))

  ok('пометка в ссылке ставится и снимается',
    isEncryptedUrl(markEncrypted('https://x/y')) && stripEncMark(markEncrypted('https://x/y')) === 'https://x/y')
  ok('обычная ссылка не считается зашифрованной', !isEncryptedUrl('https://x/y'))

  const huge = new File([new Uint8Array(10)], 'big.bin')
  Object.defineProperty(huge, 'size', { value: MAX_ENCRYPTABLE + 1 })
  try { await encryptFile(huge); ok('слишком большой файл отвергается', false, 'НЕ бросило') }
  catch (e) { ok('слишком большой файл отвергается', e instanceof TooLargeToEncrypt, 'с понятной причиной') }

  const failed = lines.filter(l => l.startsWith('ПРОВАЛ')).length
  lines.push('')
  lines.push(failed ? `ИТОГ: ПРОВАЛЕНО ПРОВЕРОК — ${failed}` : `ИТОГ: все ${lines.length - 2} проверок пройдены`)
  paint()
  ;(window as any).__done = true
  ;(window as any).__failed = failed
}

main().catch(e => { lines.push('УПАЛО: ' + e.message); paint(); (window as any).__done = true; (window as any).__failed = 1 })
