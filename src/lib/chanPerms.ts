// v1.443.0: перекрытия прав канала — та же арифметика, что в базе.
//
// Зачем отдельный файл. Раньше вкладка «Права доступа» показывала tri-state
// «Отправлять сообщения» для @everyone, а работал он через
// channels.settings.perms.send — то есть одно право, одна цель (@everyone) и
// никаких ролей. Теперь у канала есть channels.perm_overrides (миграция
// supabase/103_channel_perms.sql), и правила RLS считают итог по битам.
//
// ГЛАВНОЕ: и экран, и сохранение зовут ОДНИ И ТЕ ЖЕ функции отсюда, а сами
// функции повторяют channel_permissions() из миграции бит в бит. Иначе выходит
// самая частая поломка этого проекта — экран считает одно, а база делает другое.
//
// Проверки: src/lib/__settings_test.ts (npm run test:settings) сверяют эту
// арифметику, а scripts/db-test/rls-test.mjs (npm run test:db) прогоняет те же
// случаи на настоящем Postgres.

/** Видеть канал. Бит существует только на уровне канала. */
export const CH_VIEW = 1048576
/** Писать в канал. */
export const CH_SEND = 2097152
/** Управление каналами — обладателя перекрытия не касаются. */
export const MANAGE_CHANNELS = 4

/** Выданы по умолчанию: канал без перекрытий ведёт себя как до миграции. */
export const CH_DEFAULT = CH_VIEW | CH_SEND

export type Tri = 'allow' | 'deny' | 'default'
export type Ov = { a: number; d: number }
/** Ключи: 'everyone' | '<uuid роли>' | 'u:<uuid участника>'. */
export type Overrides = Record<string, Ov>

/** Ключ участника отличается от ключа роли приставкой — как в миграции. */
export const userKey = (userId: string) => 'u:' + userId
export const isUserKey = (k: string) => k.startsWith('u:')
export const keyUserId = (k: string) => k.slice(2)

/** Мусор считаем нулём, а не «разрешить всё» — как ov_bits() в миграции. */
function bits(row: Ov | undefined, f: 'a' | 'd'): number {
  const v = row?.[f]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Читает то, что пришло из базы, отбрасывая мусор. */
export function parseOverrides(raw: unknown): Overrides {
  const out: Overrides = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || !v || typeof v !== 'object') continue
    const a = bits(v as Ov, 'a'), d = bits(v as Ov, 'd')
    if (a || d) out[k] = { a, d }
  }
  return out
}

/** Состояние одной галки: что именно записано про этот бит у этой цели. */
export function triOf(ov: Overrides, key: string, bit: number): Tri {
  const row = ov[key]
  if (bits(row, 'd') & bit) return 'deny'
  if (bits(row, 'a') & bit) return 'allow'
  return 'default'
}

/** Меняет одну галку. Пустые записи удаляются, чтобы «ничего не настроено»
 *  выглядело в базе как {} и вкладка не показывала пустых целей. */
export function setTri(ov: Overrides, key: string, bit: number, tri: Tri): Overrides {
  const out: Overrides = {}
  for (const [k, v] of Object.entries(ov)) out[k] = { a: v.a, d: v.d }
  const row = out[key] ?? { a: 0, d: 0 }
  let { a, d } = row
  a &= ~bit; d &= ~bit
  if (tri === 'allow') a |= bit
  if (tri === 'deny') d |= bit
  if (a || d) out[key] = { a, d }
  else delete out[key]
  return out
}

/** Итоговые права человека в канале. Порядок — как в channel_permissions():
 *  сервер → @everyone → все роли (сначала запреты, потом разрешения) → лично он. */
export function channelPermissions(opts: {
  ov: Overrides
  serverPerms: number
  roleIds: string[]
  userId: string
  isOwner: boolean
}): number {
  let perm = opts.serverPerms | CH_DEFAULT
  // Владелец и управляющий каналами — вне перекрытий: иначе можно закрыть себе
  // вход в собственный канал и остаться без способа это починить.
  if (opts.isOwner || (perm & MANAGE_CHANNELS) !== 0) return perm

  const ev = opts.ov['everyone']
  perm = (perm & ~bits(ev, 'd')) | bits(ev, 'a')

  // Роли собираем и применяем разом: порядок ролей в списке не должен менять итог.
  let allow = 0, deny = 0
  for (const id of opts.roleIds) {
    const row = opts.ov[id]
    deny |= bits(row, 'd')
    allow |= bits(row, 'a')
  }
  perm = (perm & ~deny) | allow

  const me = opts.ov[userKey(opts.userId)]
  return (perm & ~bits(me, 'd')) | bits(me, 'a')
}

/** Прежняя настройка «канал только для чтения» (channels.settings.perms.send)
 *  переносится в перекрытие @everyone. Без этого канал, настроенный до
 *  миграции, выглядел бы на вкладке как «ничего не запрещено», хотя писать в
 *  него по-прежнему нельзя, — ровно тот разрыв показа и действия, который тут
 *  ловят чаще всего. */
export function mergeLegacy(ov: Overrides, legacy: Record<string, Tri> | null | undefined): Overrides {
  if (legacy?.send !== 'deny') return ov
  if (triOf(ov, 'everyone', CH_SEND) !== 'default') return ov
  return setTri(ov, 'everyone', CH_SEND, 'deny')
}

/** Что из старой карты settings.perms оставить после переноса. */
export function stripLegacy(legacy: Record<string, Tri> | null | undefined): Record<string, Tri> {
  const out: Record<string, Tri> = {}
  for (const [k, v] of Object.entries(legacy ?? {})) if (k !== 'send' && v && v !== 'default') out[k] = v
  return out
}

/** Старая карта, приведённая в соответствие с перекрытиями.
 *
 *  Зачем писать обе. Правило channel_can_send из миграции 103 смотрит и на
 *  перекрытие, и на прежнее settings.perms.send. Если сохранять только
 *  перекрытие, то на сервере без применённой миграции колонки perm_overrides
 *  нет вовсе — запрет молча пропал бы, и канал объявлений снова стал бы
 *  открытым для всех. Поэтому «только для чтения» держится в обоих местах, и
 *  они всегда согласованы. */
export function legacyFromOverrides(ov: Overrides, legacy: Record<string, Tri> | null | undefined): Record<string, Tri> {
  const out = stripLegacy(legacy)
  if (triOf(ov, 'everyone', CH_SEND) === 'deny') out.send = 'deny'
  return out
}

/** Одинаковая запись при любом порядке ключей — для сравнения «изменилось ли». */
export function normOverrides(ov: Overrides): string {
  const keys = Object.keys(ov).sort()
  return JSON.stringify(keys.map(k => [k, ov[k].a, ov[k].d]))
}

/** Обратно из normOverrides — нужно кнопке «Сбросить»: экран хранит последний
 *  сохранённый вид одной строкой и по ней возвращает состояние. */
export function fromNorm(s: string): Overrides {
  const out: Overrides = {}
  try {
    for (const row of JSON.parse(s) as [string, number, number][]) {
      if (Array.isArray(row) && typeof row[0] === 'string') out[row[0]] = { a: Number(row[1]) || 0, d: Number(row[2]) || 0 }
    }
  } catch {}
  return out
}

export const PERM_ROWS: { bit: number; t: string; d: string }[] = [
  { bit: CH_VIEW, t: 'Просматривать канал', d: 'Запрет прячет канал из списка и закрывает доступ к его сообщениям.' },
  { bit: CH_SEND, t: 'Отправлять сообщения', d: 'Запрет у @everyone делает канал только для чтения — так делают каналы объявлений.' },
]
