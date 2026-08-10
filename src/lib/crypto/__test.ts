import { newSalt, wrapPrivateKey, unwrapPrivateKey, isWrongPassword } from './backup'
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
  // --- 1. Пара ключей -------------------------------------------------------
  //
  // v1.366.0: до этой версии приватный ключ был неизвлекаем, и здесь проверялось
  // именно это. Гарантию сменили осознанно: неизвлекаемый ключ означал, что при
  // каждом выходе из аккаунта человек терял всю свою переписку — вместо своих
  // сообщений он видел «зашифровано для другого устройства», и вернуть их было
  // нечем. Теперь ключ выгружается, чтобы лечь в резервную копию под паролем.
  //
  // Гарантия стала другой, но она есть, и проверяется ниже: наружу приватный
  // ключ уходит ТОЛЬКО запертым, открытым текстом — никогда.
  const alice = await generateIdentity()
  const bob = await generateIdentity()
  ok('приватный ключ можно выгрузить для резервной копии', alice.privateKey.extractable === true)
  ok('по-прежнему можно завести ключ без права выгрузки',
    (await generateIdentity(false)).privateKey.extractable === false)

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
              // Восстановленный из хранилища ключ обязан оставаться пригодным для
              // копии: иначе после первого же перезапуска копию стало бы нечем обновить.
              ok('и остаётся пригодным для резервной копии', restored.extractable === true)
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
  ok('ключ устройства пригоден для резервной копии', id1.privateKey.extractable === true)

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

  // --- 14. Снятие метаданных с изображений ----------------------------------
  const { stripImageMetadata, needsStrip } = await import('../stripMeta')

  // Собираем настоящий JPEG и вживляем в него сегмент EXIF с «координатами».
  const cv = document.createElement('canvas')
  cv.width = 64; cv.height = 48
  const cx = cv.getContext('2d')!
  cx.fillStyle = '#c0ffee'; cx.fillRect(0, 0, 64, 48)
  const jpegBlob = await new Promise<Blob>(r => cv.toBlob(b => r(b!), 'image/jpeg', 0.9))
  const plainJpeg = new Uint8Array(await jpegBlob.arrayBuffer())

  const SECRET = 'GPS 55.7558 37.6173 IPHONE-OWNER'
  const payload = new TextEncoder().encode('Exif\0\0' + SECRET)
  const app1 = new Uint8Array(4 + payload.length)
  app1[0] = 0xFF; app1[1] = 0xE1                       // маркер APP1
  app1[2] = ((payload.length + 2) >> 8) & 0xFF; app1[3] = (payload.length + 2) & 0xFF
  app1.set(payload, 4)
  const withExif = new Uint8Array(2 + app1.length + (plainJpeg.length - 2))
  withExif.set(plainJpeg.subarray(0, 2), 0)            // SOI
  withExif.set(app1, 2)
  withExif.set(plainJpeg.subarray(2), 2 + app1.length)

  const dirty = new File([withExif], 'photo.jpg', { type: 'image/jpeg' })
  const hasSecret = async (f: Blob) => new TextDecoder('latin1')
    .decode(new Uint8Array(await f.arrayBuffer())).includes(SECRET)

  ok('подопытный файл действительно содержит метаданные', await hasSecret(dirty),
    'иначе проверка ниже ничего не значила бы')

  const cleaned = await stripImageMetadata(dirty)
  ok('очищенный файл получен', !!cleaned)
  if (cleaned) {
    ok('координат и модели в нём НЕТ', !(await hasSecret(cleaned)))
    const bm = await createImageBitmap(cleaned)
    ok('картинка не испорчена и размер прежний', bm.width === 64 && bm.height === 48,
      bm.width + 'x' + bm.height)
    bm.close()
  }

  ok('анимированный GIF не перекодируется', !needsStrip(new File([new Uint8Array(4)], 'a.gif', { type: 'image/gif' })),
    'иначе от анимации остался бы один кадр')
  ok('обычный файл не трогаем', !needsStrip(new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' })))

  const { UNREADABLE_BROKEN, UNREADABLE_OTHER_DEVICE, isUnreadable } = await import('./dm')

  // --- 15. Ключ звонка: та же дорога, что и у сообщения ----------------------
  // Звонки целиком проверить нечем (нужны два человека и сервер), но МОЯ половина —
  // выработка ключа, его запечатывание и распечатывание — проверяема, и именно в
  // ней вероятнее всего ошибка. Библиотечная половина сверена по её исходникам.
  const callKey = b64(crypto.getRandomValues(new Uint8Array(32)))
  ok('ключ звонка нужной длины', unb64(callKey).length === 32, callKey.slice(0, 12) + '…')

  const callEnv = parseEnvelope(await sealMessage(callKey, 'alice', 'alice-pc', alice.privateKey, recips))!
  const gotKey = await openMessage(callEnv, 'bob-phone', bobDev1.privateKey, alicePub)
  ok('собеседник получает ТОТ ЖЕ ключ звонка', gotKey === callKey)
  ok('в конверте ключа звонка его самого не видно',
    !JSON.stringify(callEnv).includes(callKey))

  // Проверка защиты из DMHome: неудачную расшифровку отличаем по замку в начале.
  // Ключ — base64, а в его алфавите замка нет, поэтому спутать нельзя.
  ok('признак неудачи не совпадёт с настоящим ключом',
    !isUnreadable(callKey) && isUnreadable(UNREADABLE_BROKEN) && isUnreadable(UNREADABLE_OTHER_DEVICE))

  await mustThrow('чужой не достанет ключ звонка', () =>
    openMessage(callEnv, 'bob-phone', eve.privateKey, alicePub))

  // --- 16. Проверка адресов из сообщений -------------------------------------
  const { isSafeUrl } = await import('../safeUrl')

  // Опасные схемы. javascript: особенно: браузер блокирует его в <a href>, но
  // window.open ВЫПОЛНЯЕТ — проверено в этой среде, — и выполняет в окне того же
  // происхождения, то есть с доступом к токену сессии в localStorage.
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'jAvAsCrIpT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/System32/config/SAM',
  ]) {
    ok('отклонён опасный адрес: ' + bad.slice(0, 34), !isSafeUrl(bad))
  }
  for (const good of [
    'https://example.com/a.png',
    'http://example.com/a.png',
    'blob:file:///1234-5678',
    '/local/asset.png',
  ]) {
    ok('пропущен обычный адрес: ' + good.slice(0, 34), isSafeUrl(good))
  }
  ok('пустой адрес отклонён', !isSafeUrl('') && !isSafeUrl(null) && !isSafeUrl(undefined))

  // ── Резервная копия ключа под паролем (v1.366.0) ──────────────────────
  //
  // Здесь ошибка означает не «кнопка не нажимается», а «переписку прочитал
  // посторонний» либо «человек потерял её навсегда». Проверяем оба конца:
  // что с правильным паролем ключ возвращается ровно тот же, и что с любым
  // другим — не возвращается вовсе.
  {
    const salt = newSalt()
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    ) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)

    const sealed = await wrapPrivateKey(jwk, 'верный-пароль-123', salt)

    ok('копия не содержит ключа открытым текстом',
      !JSON.stringify(sealed).includes(String(jwk.d ?? 'нет-d')))
    ok('соли получаются разные', newSalt() !== newSalt())
    ok('одна и та же копия дважды не одинакова',
      JSON.stringify(await wrapPrivateKey(jwk, 'верный-пароль-123', salt)) !== JSON.stringify(sealed))

    const back = await unwrapPrivateKey(sealed, 'верный-пароль-123', salt)
    ok('верный пароль возвращает тот же ключ', back.d === jwk.d && back.x === jwk.x && back.y === jwk.y)

    let wrongRejected = false
    try { await unwrapPrivateKey(sealed, 'верный-пароль-124', salt) } catch (e) { wrongRejected = isWrongPassword(e) }
    ok('неверный пароль отвергнут, а не даёт мусор', wrongRejected)

    let emptyRejected = false
    try { await unwrapPrivateKey(sealed, '', salt) } catch { emptyRejected = true }
    ok('пустой пароль не подходит', emptyRejected)

    let saltRejected = false
    try { await unwrapPrivateKey(sealed, 'верный-пароль-123', newSalt()) } catch { saltRejected = true }
    ok('чужая соль не подходит даже с верным паролем', saltRejected)

    // Восстановленный ключ обязан РАБОТАТЬ, а не просто совпадать по полям:
    // совпадение байтов ничего не стоит, если ключ потом не выводит общий секрет.
    const restored = await crypto.subtle.importKey(
      'jwk', back, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
    )
    const other = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    ) as CryptoKeyPair
    const bitsA = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: other.publicKey }, restored, 256))
    const bitsB = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: kp.publicKey }, other.privateKey, 256))
    ok('восстановленным ключом выводится тот же общий секрет',
      bitsA.length === 32 && bitsA.every((v, i) => v === bitsB[i]))

    // Испорченная копия и неверный пароль — разные беды, и слова человеку нужны разные.
    const broken = { iv: sealed.iv, ct: sealed.ct.slice(0, -4) + 'AAAA' }
    let brokenCaught = false
    try { await unwrapPrivateKey(broken as any, 'верный-пароль-123', salt) } catch { brokenCaught = true }
    ok('испорченная копия не открывается', brokenCaught)
  }

  // --- Длина сообщения ничего не выдаёт (v1.531.0) ---------------------------
  //
  // Владелец: «расшифровка даже не знает, отправлен ли один символ или тысяча».
  // Сам текст был закрыт и раньше, а вот ДЛИНА шифротекста повторяла длину
  // текста почти байт в байт: не читая ни слова, со стороны видно, «да» это или
  // страница. В разговоре «да/нет» это и есть ответ.
  {
    const ключ = await generateContentKey()
    const длины: number[] = []
    for (const т of ['да', 'нет', 'может быть', 'а' .repeat(400)]) {
      const s = await encryptText(ключ, т)
      длины.push(s.ct.length)
    }
    ok('короткие сообщения снаружи одинаковой длины',
      длины[0] === длины[1] && длины[1] === длины[2] && длины[2] === длины[3],
      'длины: ' + длины.join(', '))

    // Текст читается обратно ровно тем же.
    const пробы = ['да', '', 'многострочный' + String.fromCharCode(10) + 'текст', 'эмодзи 🐾 и хвост', 'x'.repeat(5000)]
    let целы = true
    for (const т of пробы) {
      const назад = await decryptText(ключ, await encryptText(ключ, т))
      if (назад !== т) { целы = false; break }
    }
    ok('текст возвращается ровно таким, каким был', целы)

    // Длинные сообщения тоже неразличимы между собой — пока попадают в одну
    // ступень. Сравнивать «во сколько раз больше короткого» бессмысленно: у
    // ступеней разный шаг, и первая моя оценка провалилась именно на этом,
    // хотя всё работало правильно.
    const д1 = (await encryptText(ключ, 'ю'.repeat(3000))).ct.length
    const д2 = (await encryptText(ключ, 'я'.repeat(4000))).ct.length
    ok('два разных длинных сообщения снаружи одинаковы',
      д1 === д2, '3000 знаков: ' + д1 + ', 4000 знаков: ' + д2)
    ok('но короткое и длинное различаются ступенью — платить килобайтами за мегабайт незачем',
      д1 > (await encryptText(ключ, 'да')).ct.length)

    // Шум настоящий: два шифрования одного текста дают разные байты (это и так
    // верно из-за iv, но здесь важно, что блок не набит нулями).
    const a = await encryptText(ключ, 'да')
    const b = await encryptText(ключ, 'да')
    ok('одно и то же сообщение дважды выглядит по-разному', a.ct !== b.ct)

    // Скорость: блок в килобайт не должен стоить заметного времени.
    const начало = performance.now()
    for (let i = 0; i < 200; i++) await encryptText(ключ, 'проверка скорости')
    const мс = (performance.now() - начало) / 200
    ok('шифрование одного сообщения быстрее миллисекунды', мс < 1,
      мс.toFixed(3) + ' мс на сообщение')
  }

  const failed = lines.filter(l => l.startsWith('ПРОВАЛ')).length
  lines.push('')
  lines.push(failed ? `ИТОГ: ПРОВАЛЕНО ПРОВЕРОК — ${failed}` : `ИТОГ: все ${lines.length - 2} проверок пройдены`)
  paint()
  ;(window as any).__done = true
  ;(window as any).__failed = failed
}

main().catch(e => { lines.push('УПАЛО: ' + e.message); paint(); (window as any).__done = true; (window as any).__failed = 1 })
