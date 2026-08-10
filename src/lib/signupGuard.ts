// v1.537.0: защита регистрации от ботов — своими силами, без чужих служб.
//
// Владелец: «любой бот или школьник сможет зарегистрировать аккаунт на чужую
// или несуществующую почту… обязательно добавь защиту от спама на самом
// клиенте (капча вроде Turnstile или хотя бы задержка и лимит)».
//
// ПОЧЕМУ НЕ КАПЧА. Turnstile и подобное — это чужая служба, которой уходит
// отпечаток каждого, кто открыл окно регистрации. Для приложения, которое
// обещает «сервер ничего о вас не знает», это противоречие в самом видном
// месте. Кроме того, у нас всё должно работать без сети к третьим лицам.
//
// ЧТО ЗДЕСЬ ВМЕСТО НЕЁ — три простые вещи, и каждая мешает своему:
//
//   1. Ловушка (honeypot). В форме есть поле, невидимое человеку. Человек его
//      не заполнит никогда, простой бот заполняет всё подряд. Стоит ноль,
//      отсекает самых дешёвых.
//
//   2. Время заполнения. Человек не может ввести почту, пароль и имя за
//      полторы секунды. Бот может. Это отсекает уже не самых дешёвых.
//
//   3. Работа доказательством (proof-of-work). Прежде чем отправить форму,
//      устройство обязано подобрать число, у которого хеш начинается с нулей.
//      Человеку это стоит секунду ожидания один раз в жизни, а тому, кто хочет
//      завести тысячу аккаунтов, — тысячу секунд процессорного времени на
//      каждую тысячу. Это не запрет, это цена.
//
// ЧЕГО ЭТО НЕ ДЕЛАЕТ, и говорить иначе нельзя: настоящего злоумышленника с
// сервером и десятью строчками кода это не остановит. Останавливать его — работа
// сервера (ограничение по адресу, подтверждение почты). Здесь — фильтр от
// потока дешёвого мусора и честная цена за каждый новый аккаунт.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

/** Быстрее этого форму заполняет только машина. */
export const MIN_FILL_MS = 1500

/** Сколько попыток регистрации разрешено с устройства за час. */
export const MAX_TRIES = 3
export const TRIES_WINDOW_MS = 60 * 60 * 1000

export interface SignupAttempt {
  /** Когда открыли форму, мс. */
  opened: number
  /** Что попало в поле-ловушку. Человек его не видит. */
  honeypot: string
  /** Времена прошлых попыток с этого устройства, мс. */
  history: number[]
}

export type SignupVerdict =
  | { ok: true }
  | { ok: false; why: 'bot' | 'fast' | 'too-many'; text: string; retryIn?: number }

/**
 * Можно ли отправлять форму.
 *
 * Порядок проверок не случаен: сначала бесплатные, потом дорогие. И тексты
 * разные — «слишком часто» человеку понятно и поправимо, а боту всё равно.
 */
export function signupAllowed(a: SignupAttempt, now = Date.now()): SignupVerdict {
  if (a.honeypot.trim()) {
    // Человеку это поле не показывают, значит заполнить его он не мог. Пишем
    // ровно то же, что и в других случаях: подсказывать боту, на чём он попался,
    // незачем.
    return { ok: false, why: 'bot', text: 'Не получилось создать аккаунт. Попробуй ещё раз.' }
  }
  if (now - a.opened < MIN_FILL_MS) {
    return { ok: false, why: 'fast', text: 'Слишком быстро — проверь, всё ли заполнено верно.' }
  }
  const свежие = a.history.filter(t => now - t < TRIES_WINDOW_MS)
  if (свежие.length >= MAX_TRIES) {
    const самая = Math.min(...свежие)
    const ждать = самая + TRIES_WINDOW_MS - now
    return {
      ok: false, why: 'too-many', retryIn: ждать,
      text: 'С этого устройства уже создано ' + MAX_TRIES + ' аккаунта. Следующий — через ' +
        Math.max(1, Math.ceil(ждать / 60000)) + ' мин.',
    }
  }
  return { ok: true }
}

// ── Работа доказательством ───────────────────────────────────────────────────

/** Сколько нулевых битов требуем. 16 — около секунды на обычном телефоне. */
export const POW_BITS = 16

/** Сколько нулевых битов в начале хеша. */
export function leadingZeroBits(hash: Uint8Array): number {
  let n = 0
  for (const b of hash) {
    if (b === 0) { n += 8; continue }
    let m = 0x80
    while (m && !(b & m)) { n++; m >>= 1 }
    break
  }
  return n
}

/**
 * Подобрать число, при котором хеш задачи начинается с нужного числа нулей.
 *
 * Задача — это почта и метка времени: подобранное для одной регистрации не
 * годится для другой, и заготовить ответы заранее нельзя.
 *
 * Отдаёт управление между попытками: иначе окно замирает, и человек решает, что
 * приложение повисло.
 */
export async function solvePow(challenge: string, bits = POW_BITS): Promise<number> {
  const enc = new TextEncoder()
  for (let n = 0; ; n++) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(challenge + ':' + n)))
    if (leadingZeroBits(h) >= bits) return n
    if (n % 500 === 499) await new Promise(r => setTimeout(r, 0))
  }
}

/** Проверить чужой ответ — тем же счётом, что и подбирали. */
export async function checkPow(challenge: string, nonce: number, bits = POW_BITS): Promise<boolean> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(challenge + ':' + nonce)))
  return leadingZeroBits(h) >= bits
}

// ── Память попыток на устройстве ─────────────────────────────────────────────

const КЛЮЧ = 'ponoi_signup_tries'

export function loadTries(): number[] {
  try {
    const j = JSON.parse(localStorage.getItem(КЛЮЧ) || '[]')
    return Array.isArray(j) ? j.filter((n: unknown) => typeof n === 'number') : []
  } catch { return [] }
}

export function noteTry(now = Date.now()): void {
  try {
    const свежие = loadTries().filter(t => now - t < TRIES_WINDOW_MS)
    свежие.push(now)
    localStorage.setItem(КЛЮЧ, JSON.stringify(свежие))
  } catch { /* приватный режим — переживём */ }
}
