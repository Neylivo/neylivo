// v1.535.0: защита входа уровня Steam — привязка устройства и код восстановления.
//
// Владелец описал, чего хочет, по образцу Steam Guard:
//   • вход с нового устройства не даёт сразу делать опасное;
//   • на старые устройства приходит оповещение «это были вы?»;
//   • есть код восстановления, который знает только владелец, — им можно
//     вернуть доступ, даже если увели и пароль, и почту.
//
// Здесь ПРАВИЛА и КОД: что считать новым устройством, что ему запрещено и на
// сколько, как выглядит код восстановления и как он проверяется. Работа с базой
// и разметка — отдельно: правила должны проверяться числами.
//
// ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ. Кода восстановления в открытом виде на сервере не
// бывает: сервер хранит только его отпечаток. Иначе тот, кто добрался до базы,
// получил бы главный ключ от всех аккаунтов разом — а весь смысл кода в том,
// что он есть ТОЛЬКО у человека.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

const ЧАС = 60 * 60 * 1000

/** Сколько новое устройство считается новым и не допускается к опасному. */
export const NEW_DEVICE_LOCK_MS = 24 * ЧАС

/** Действия, закрытые для нового устройства. */
export type Critical = 'keys' | 'email' | 'delete' | 'export' | 'logout-all'

export const CRITICAL: Critical[] = ['keys', 'email', 'delete', 'export']

export interface DeviceRecord {
  id: string
  /** Когда это устройство увидели впервые, мс. */
  firstSeen: number
  /** Человек сам пометил его доверенным (подтвердил «это я»). */
  trusted?: boolean
}

/**
 * Закрыто ли опасное действие на этом устройстве.
 *
 * Закрыто, если устройство новое (меньше суток) и человек не подтвердил, что
 * это он. Подтверждение снимает замок сразу: заставлять ждать того, кто уже
 * доказал, что он владелец, — это наказание без пользы.
 *
 * `logout-all` не закрывается никогда: это единственное действие, которым
 * человек защищается, и запирать его — значит помогать тому, кто увёл аккаунт.
 */
export function criticalLocked(action: Critical, d: DeviceRecord | null, now = Date.now()): boolean {
  if (action === 'logout-all') return false
  if (!d) return true
  if (d.trusted) return false
  return now - d.firstSeen < NEW_DEVICE_LOCK_MS
}

/** Сколько осталось до снятия замка, мс. Ноль — уже снят. */
export function lockLeft(d: DeviceRecord | null, now = Date.now()): number {
  if (!d) return NEW_DEVICE_LOCK_MS
  if (d.trusted) return 0
  return Math.max(0, d.firstSeen + NEW_DEVICE_LOCK_MS - now)
}

/** Человеческое имя устройства из строки браузера — для списка и оповещений. */
export function deviceLabel(ua: string): string {
  const u = String(ua || '')
  const система = /Android/i.test(u) ? 'Android'
    : /iPhone|iPad|iOS/i.test(u) ? 'iPhone'
    : /Windows/i.test(u) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(u) ? 'macOS'
    : /Linux/i.test(u) ? 'Linux' : 'устройство'
  const где = /Electron|NeyLivo/i.test(u) ? 'приложение'
    : /Firefox/i.test(u) ? 'Firefox'
    : /Edg\//i.test(u) ? 'Edge'
    : /Chrome/i.test(u) ? 'Chrome'
    : /Safari/i.test(u) ? 'Safari' : 'браузер'
  return система + ' · ' + где
}

// ── Код восстановления ───────────────────────────────────────────────────────

/**
 * Буквы и цифры БЕЗ похожих друг на друга.
 *
 * Код переписывают с экрана на бумагу и обратно руками. Ноль и «O», единица и
 * «I» с «L» в этот момент неразличимы, и человек, ошибившись один раз, теряет
 * единственный ключ от своего аккаунта. Поэтому их здесь нет вовсе — как и «U»,
 * которая в рукописном виде становится «V».
 *
 * Букву «L» я сперва оставил, и проверка это поймала: она сравнивает алфавит со
 * списком путаемых знаков, а не верит на слово.
 */
const АЛФАВИТ = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Длина без учёта префикса и дефисов. */
const ЗНАКОВ = 16

/**
 * Выдать новый код восстановления.
 *
 * Вид: R-XXXX-XXXX-XXXX-XXXX. Буква R впереди — чтобы код узнавался с одного
 * взгляда среди прочих строк (так же сделано в Steam).
 */
export function newRecoveryCode(random: (n: number) => Uint8Array = случайные): string {
  const b = random(ЗНАКОВ)
  let код = ''
  for (let i = 0; i < ЗНАКОВ; i++) {
    if (i > 0 && i % 4 === 0) код += '-'
    код += АЛФАВИТ[b[i] % АЛФАВИТ.length]
  }
  return 'R-' + код
}

/**
 * Привести введённое к тому виду, в котором код сравнивается.
 *
 * Человек вводит как получится: строчными, без дефисов, с пробелами, с
 * приписанным «R-» или без него. Отказывать из-за этого — значит потерять
 * аккаунт на ровном месте.
 */
export function normalizeCode(input: string): string {
  const т = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
  // Похожих знаков в алфавите нет вовсе (ни 0/O, ни 1/I/l), поэтому чинить
  // опечатки не требуется: то, что человек списал, либо годится, либо нет.
  return т.startsWith('R') ? т.slice(1) : т
}

/** Годится ли введённое по виду (до похода в базу). */
export function codeLooksValid(input: string): boolean {
  const н = normalizeCode(input)
  return н.length === ЗНАКОВ && [...н].every(c => АЛФАВИТ.includes(c))
}

/**
 * Отпечаток кода — только он и хранится на сервере.
 *
 * SHA-256 от нормализованного кода. Соли нет намеренно: код длинный и случайный
 * (32^16 ≈ 10^24 вариантов), перебрать его нельзя, а соль потребовала бы хранить
 * рядом ещё и её — то есть добавила бы сложности без выигрыша.
 */
export async function codeFingerprint(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeCode(input))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function случайные(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}
