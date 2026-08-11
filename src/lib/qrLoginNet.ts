// v1.541.0: вход по коду с телефона — работа с сервером и ключами.
//
// Чистая часть (что лежит в коде, как разбирается, что негодно) — в qrLogin.ts,
// она проверяется числами. Здесь то, что без сервера не проверишь.
//
// Обе стороны считают общий ключ по Диффи — Хеллману: компьютер делает
// одноразовую пару и печатает открытую половину в QR, телефон делает свою и
// кладёт открытую половину в заявку. Общий ключ получается у обоих, а на
// сервере его нет и быть не может — там лежат только две открытые половины и
// шифротекст.
import { supabase } from './supabase'
import {
  codeHash, newCode, qrPayload, qrMyDeviceLabel, qrPair, qrPubToB32, qrPubFromB32,
  qrSharedKey, qrSeal, qrOpen, type QrSession,
} from './qrLogin'

export interface QrRequest {
  /** Что печатать в QR-коде. */
  payload: string
  /** Отпечаток секрета — им заявка ищется на сервере. */
  hash: string
  /** Приватная половина. Не покидает эту вкладку. */
  priv: CryptoKey
  созданаМс: number
}

/** Компьютер: создать заявку и получить содержимое QR-кода. */
export async function startQrLogin(): Promise<QrRequest> {
  const kp = await qrPair()
  const pub = await qrPubToB32(kp.publicKey)
  const code = newCode()
  const hash = await codeHash(code)
  const { error } = await supabase.rpc('login_qr_start', {
    p_code_hash: hash, p_pc_pub: pub, p_device: qrMyDeviceLabel(),
  })
  if (error) throw error
  return { payload: qrPayload({ code, pub }), hash, priv: kp.privateKey, созданаМс: Date.now() }
}

/**
 * Компьютер: забрать сессию, если телефон уже подтвердил.
 *
 * null — «ещё нет», это не ошибка: так выглядит ожидание.
 */
export async function claimQrLogin(з: QrRequest): Promise<QrSession | null> {
  const { data, error } = await supabase.rpc('login_qr_claim', { p_code_hash: з.hash })
  if (error) throw error
  const строка = Array.isArray(data) ? data[0] : data
  if (!строка || !строка.sealed_ct) return null
  const ключ = await qrSharedKey(з.priv, await qrPubFromB32(строка.phone_pub))
  // Расшифровалось — значит, ключ сошёлся, значит, шифровал тот, у кого был наш
  // QR. Содержимое qrOpen проверяет сам: мало ли что там окажется.
  return await qrOpen(ключ, строка.sealed_iv, строка.sealed_ct)
}

export interface QrInfo { pc_pub: string; device: string; expires_at: string }

/** Телефон: что за заявка. Возвращает null, если её уже нет или она просрочена. */
export async function qrInfo(hash: string): Promise<QrInfo | null> {
  const { data, error } = await supabase.rpc('login_qr_info', { p_code_hash: hash })
  if (error) throw error
  const строка = Array.isArray(data) ? data[0] : data
  return строка || null
}

/**
 * Телефон: подтвердить вход и передать свою сессию.
 *
 * `pubИзКода` — открытый ключ, прочитанный КАМЕРОЙ. Он же сверяется с тем, что
 * лежит на сервере: не сойдётся — значит, заявку подменили, и мы молча ничего
 * не отправляем. Именно эта сверка не даёт серверу подставить свой ключ и
 * прочитать чужую сессию.
 */
export async function approveQrLogin(hash: string, pubИзКода: string): Promise<void> {
  const инфо = await qrInfo(hash)
  if (!инфо) throw new Error('заявка не найдена или устарела')
  if (инфо.pc_pub !== pubИзКода) throw new Error('код не сходится с заявкой — вход отменён')

  const { data: сес } = await supabase.auth.getSession()
  const s = сес?.session
  if (!s?.access_token || !s?.refresh_token) throw new Error('нет своей сессии')

  const kp = await qrPair()
  const ключ = await qrSharedKey(kp.privateKey, await qrPubFromB32(pubИзКода))
  const тело: QrSession = { access_token: s.access_token, refresh_token: s.refresh_token }
  const запечатано = await qrSeal(ключ, тело)
  const { data, error } = await supabase.rpc('login_qr_approve', {
    p_code_hash: hash,
    p_phone_pub: await qrPubToB32(kp.publicKey),
    p_iv: запечатано.iv,
    p_ct: запечатано.ct,
  })
  if (error) throw error
  if (data === false) throw new Error('заявку уже подтвердили или она устарела')
}
