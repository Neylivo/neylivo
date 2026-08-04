// v1.468.0: код передачи и его правила — отдельно от сети.
//
// Почему отдельным файлом. Рядом с запросами к базе эти функции проверить
// нечем: любой импорт grants.ts тянет за собой клиент Supabase, а тот при
// сборке проверки требует настроек окружения и падает ещё до первой проверки.
// Ровно на это уже напоролись в v1.463.0 с подсчётом истории активностей.
//
// Здесь только то, что можно посчитать и проверить: сам код, его вид, срок и
// число получений. Всё, что ходит в сеть, — в grants.ts.
//
// Проверки: src/lib/plugins/__test.ts (npm run test:plugins).

/**
 * Алфавит кода. Без 0/O, 1/I/L — их путают при переписывании с экрана, а код
 * человек именно переписывает или диктует.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LEN = 12

export const MAX_USES = 1000
export const MAX_DAYS = 365

/**
 * Код передачи. Двенадцать знаков из тридцати одного — около шестидесяти бит:
 * перебрать нельзя, а списать с экрана можно.
 *
 * Источник случайности — криптографический, а не Math.random: код это пропуск к
 * чужой работе, и предсказуемый пропуск не пропуск.
 */
export function makeCode(rand: (n: number) => Uint8Array = сильныйСлучай): string {
  const bytes = rand(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

function сильныйСлучай(n: number): Uint8Array {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return a
}

/** Код, введённый человеком: пробелы, дефисы и регистр прощаем. */
export function normCode(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Похоже ли это вообще на код — чтобы не ходить в сеть за очевидной опиской. */
export function looksLikeCode(raw: string): boolean {
  const c = normCode(raw)
  return c.length === CODE_LEN && [...c].every(ch => CODE_ALPHABET.includes(ch))
}

/** Красивая запись для показа: ABCD-EFGH-2345 читается и диктуется. */
export function prettyCode(code: string): string {
  return normCode(code).replace(/(.{4})(?=.)/g, '$1-')
}

/** Срок в ISO или null. Отдельной функцией: «через N дней» на границах месяца и
 *  года руками считают неправильно чаще всего. */
export function expiryFromDays(days: number, now = Date.now()): string | null {
  const d = Math.floor(Number(days))
  if (!Number.isFinite(d) || d <= 0) return null
  return new Date(now + Math.min(d, MAX_DAYS) * 86_400_000).toISOString()
}

export function clampUses(v: unknown): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_USES)
}

/**
 * Текст, который человек обязан прочитать на экране передачи.
 *
 * Здесь, а не в разметке, — чтобы его нельзя было потерять при перевёрстке и
 * чтобы проверка могла убедиться, что он на месте и говорит прямо. Обещать
 * защиту от копирования нельзя: это неправда, а неправда в таком месте хуже,
 * чем отсутствие самой возможности.
 */
export const GRANT_HONESTY =
  'Это не защита от копирования. Получив плагин, человек видит весь его код и может '
  + 'передать файл дальше — помешать этому нельзя ничем. Передача даёт другое: код '
  + 'работает только у того, кому ты его назначил, только столько раз, сколько ты '
  + 'разрешил, и видно, кто и когда его забрал.'
