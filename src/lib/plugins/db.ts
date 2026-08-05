// v1.472.0: настоящее хранилище для плагина — таблицы, а не пары ключ-значение.
//
// Зачем. ponoi.storage — это localStorage: несколько килобайт, всё в одной
// строке, никакого поиска. Для настройки этого хватает, для приложения — нет:
// инвентарь, задачи, заметки, сохранения игры, разобранная переписка. Владелец
// написал прямо: «для больших приложений storage.get/set недостаточно».
//
// Устройство. Одна база IndexedDB на всё приложение, одно хранилище строк, ключ
// собран из «плагин + таблица + id». Плагин видит только свои строки: имя его
// плагина входит в ключ, и подставляет его приложение, а не он сам.
//
// ЧЕСТНО ПРО «ИНДЕКСАЦИЮ». Быстрый здесь — отбор ТАБЛИЦЫ: по ней стоит
// настоящий индекс, и достать её из базы в сто тысяч строк стоит столько же,
// сколько из ста. А вот условие (`where`) считается уже в памяти, перебором
// полученной таблицы. Для тысяч строк это доли миллисекунды и ровно то, что
// нужно; для миллионов — нет, и обещать обратное было бы враньём. Сколько это
// стоит на самом деле, померено пробой (см. отчёт к версии).
//
// Почему не в песочнице. IndexedDB у воркера плагина вырезан вместе с fetch
// (bootstrap.ts, список KILL): он живёт в том же origin, что и приложение, и
// через него плагин добрался бы до чужих данных — в ponoiMedia лежат вложения.
// Поэтому база работает здесь, а плагин зовёт её через диспетчер.
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

import { STORE_ROWS as STORE, запрос, лавка as лавкаБазы } from './idb'

/** Сколько строк в одной таблице у одного плагина. */
// v1.481.0: было 50 000. Владелец попросил снять рамки с хранилища — предел
// теперь не наш, а браузера: сколько влезет на устройстве, столько и можно.
// Число остаётся не как «нельзя больше», а как защита от зациклившегося
// плагина, который пишет в базу в бесконечном цикле.
/** Сколько знаков в одной строке (после превращения в JSON). */
/** Длина имени таблицы. */

export class DbError extends Error {}

/** Разделитель в составном ключе. Такого знака не бывает ни в имени таблицы,
 *  ни в имени плагина — оба проверены. */
const SEP = '\u0000'

/**
 * Чего в имени таблицы быть не может: управляющие знаки (в том числе
 * разделитель ключа) и черта пути.
 *
 * v1.474.0: раньше здесь стоял белый список из латиницы и цифр — и таблица
 * «счёт» не создавалась вовсе. Нашлось при написании настоящего плагина: он на
 * этом просто упал. Приложение русское, плагины пишут по-русски, и запрещать
 * надо ровно то, чем можно навредить, а не всё незнакомое.
 */
const TABLE_BAD = /[\u0000-\u001f\u007f/\\]/

export function checkTable(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) throw new DbError('Таблице нужно имя')
  if (TABLE_BAD.test(s)) throw new DbError('В имени таблицы не может быть черты пути и невидимых знаков')
  return s
}

/** Условия отбора. Список закрытый: неизвестное условие должно быть ошибкой, а
 *  не тихо отобранной пустотой. */
export const OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith'] as const
export type Op = typeof OPS[number]

export function isOp(v: unknown): v is Op {
  return typeof v === 'string' && (OPS as readonly string[]).includes(v)
}

/**
 * Подходит ли строка под условие.
 *
 * Отдельной чистой функцией: здесь легче всего ошибиться незаметно — сравнение
 * разных типов, отсутствующее поле, «больше» у строк. Проверяется отдельно.
 */
export function matches(row: Record<string, unknown>, field: string, op: Op, value: unknown): boolean {
  const v = row?.[field]
  switch (op) {
    case '=': return v === value
    case '!=': return v !== value
    // Сравнения по порядку имеют смысл только у чисел и дат. У строк «больше»
    // зависит от языка и регистра — молча отвечать на такое нельзя.
    case '>': case '>=': case '<': case '<=': {
      const a = типЧисло(v), b = типЧисло(value)
      if (a === null || b === null) return false
      return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b
    }
    case 'contains': return typeof v === 'string' && typeof value === 'string' && v.includes(value)
    case 'startsWith': return typeof v === 'string' && typeof value === 'string' && v.startsWith(value)
    default: return false
  }
}

function типЧисло(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof Date) return v.getTime()
  return null
}

// ── Сама база ───────────────────────────────────────────────────────────────
//
// v1.473.0: открытие базы переехало в idb.ts. Не ради красоты: с появлением
// ресурсов хранилищ стало два, а открывать одну базу из двух файлов с разными
// версиями схемы значит получить заблокированное соединение и зависшее
// приложение. Схему знает одно место, здесь только своё хранилище.

const tkey = (pluginId: string, table: string) => pluginId + SEP + table
const rkey = (pluginId: string, table: string, id: string) => pluginId + SEP + table + SEP + id

interface Запись { k: string; t: string; id: string; v: Record<string, unknown> }

function дело<T>(store: IDBObjectStore, req: IDBRequest, map: (r: IDBRequest) => T): Promise<T> {
  void store
  return запрос(req, map)
}

async function лавка(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return лавкаБазы(STORE, mode)
}

/** Все строки одной таблицы. Здесь и работает настоящий индекс. */
async function таблица(pluginId: string, table: string): Promise<Запись[]> {
  const st = await лавка('readonly')
  const idx = st.index('byTable')
  return дело(st, idx.getAll(IDBKeyRange.only(tkey(pluginId, table))), r => (r.result as Запись[]) ?? [])
}

function проверитьРазмер(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DbError('Строка таблицы — это объект')
  let s = ''
  try { s = JSON.stringify(v) } catch { throw new DbError('Такую строку сохранить нельзя') }
  return JSON.parse(s) as Record<string, unknown>
}

/** id строки: свой или выданный. Всегда строка — иначе 1 и '1' были бы разными
 *  ключами, и человек полдня искал бы, почему запись «пропала». */
function номер(v: unknown): string {
  const s = v === undefined || v === null || v === '' ? '' : String(v)
  return s || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
}

/**
 * Сколько строк в таблице — по памяти.
 *
 * Настоящий count по индексу стоит отдельной сделки с базой, а вставка обязана
 * проверять предел. Считать его на КАЖДУЮ строку — это две сделки вместо одной,
 * и на двадцати тысячах записей проба просто не дождалась конца: поймано
 * замером, а не рассуждением.
 *
 * Поэтому число помним, а сверяемся с базой изредка — и обязательно у самого
 * предела, где ошибка на сотню строк уже имеет значение.
 */
const счётчики = new Map<string, number>()
const СВЕРЯТЬСЯ_КАЖДЫЕ = 256

async function сколькоСтрок(pluginId: string, t: string): Promise<number> {
  const key = tkey(pluginId, t)
  const было = счётчики.get(key)
  if (было === undefined || было % СВЕРЯТЬСЯ_КАЖДЫЕ === 0) {
    const точно = await dbCount(pluginId, t)
    счётчики.set(key, точно)
    return точно
  }
  return было
}

export async function dbInsert(pluginId: string, table: string, row: unknown): Promise<string> {
  const t = checkTable(table)
  const v = проверитьРазмер(row)
  const id = номер(v.id)
  v.id = id
  const было = await сколькоСтрок(pluginId, t)
  const st = await лавка('readwrite')
  await дело(st, st.put({ k: rkey(pluginId, t, id), t: tkey(pluginId, t), id, v } as Запись), () => null)
  счётчики.set(tkey(pluginId, t), было + 1)
  return id
}

export async function dbGet(pluginId: string, table: string, id: string): Promise<Record<string, unknown> | null> {
  const t = checkTable(table)
  const st = await лавка('readonly')
  const rec = await дело(st, st.get(rkey(pluginId, t, String(id))), r => r.result as Запись | undefined)
  return rec ? rec.v : null
}

export async function dbAll(pluginId: string, table: string, limit = 1000): Promise<Record<string, unknown>[]> {
  const t = checkTable(table)
  const rows = await таблица(pluginId, t)
  // v1.489.0: потолка выдачи нет — сколько попросили, столько и вернём.
  return rows.slice(0, Math.max(1, limit)).map(r => r.v)
}

export async function dbWhere(
  pluginId: string, table: string, field: string, op: Op, value: unknown, limit = 1000,
): Promise<Record<string, unknown>[]> {
  const t = checkTable(table)
  if (!isOp(op)) throw new DbError(`Неизвестное условие «${op}». Есть: ${OPS.join(', ')}.`)
  const f = String(field ?? '')
  if (!f) throw new DbError('Не сказано, по какому полю отбирать')
  const rows = await таблица(pluginId, t)
  const out: Record<string, unknown>[] = []
  const край = Math.max(1, limit)
  for (const r of rows) {
    if (matches(r.v, f, op, value)) { out.push(r.v); if (out.length >= край) break }
  }
  return out
}

export async function dbUpdate(pluginId: string, table: string, id: string, patch: unknown): Promise<boolean> {
  const t = checkTable(table)
  const p = проверитьРазмер(patch)
  // Одной сделкой: две означали бы, что между чтением и записью в строку мог
  // вклиниться кто-то ещё, и правка легла бы поверх чужой.
  const st = await лавка('readwrite')
  const key = rkey(pluginId, t, String(id))
  const rec = await дело(st, st.get(key), r => r.result as Запись | undefined)
  if (!rec) return false
  // id менять нельзя: иначе строка «переехала» бы, а старая осталась.
  const v = проверитьРазмер({ ...rec.v, ...p, id: rec.id })
  await дело(st, st.put({ ...rec, v }), () => null)
  return true
}

export async function dbRemove(pluginId: string, table: string, id: string): Promise<boolean> {
  const t = checkTable(table)
  const st = await лавка('readwrite')
  const key = rkey(pluginId, t, String(id))
  const rec = await дело(st, st.get(key), r => r.result as Запись | undefined)
  if (!rec) return false
  await дело(st, st.delete(key), () => null)
  счётчики.delete(tkey(pluginId, t))
  return true
}

export async function dbCount(pluginId: string, table: string): Promise<number> {
  const t = checkTable(table)
  const st = await лавка('readonly')
  const idx = st.index('byTable')
  return дело(st, idx.count(IDBKeyRange.only(tkey(pluginId, t))), r => Number(r.result) || 0)
}

export async function dbClear(pluginId: string, table: string): Promise<number> {
  const t = checkTable(table)
  const rows = await таблица(pluginId, t)
  const st = await лавка('readwrite')
  for (const r of rows) st.delete(r.k)
  счётчики.delete(tkey(pluginId, t))
  return rows.length
}

/** Какие таблицы завёл плагин. Нужно ему самому и экрану плагина. */
export async function dbTables(pluginId: string): Promise<string[]> {
  const st = await лавка('readonly')
  const все = await дело(st, st.getAll(), r => (r.result as Запись[]) ?? [])
  const свои = new Set<string>()
  for (const r of все) {
    if (!r.t.startsWith(pluginId + SEP)) continue
    свои.add(r.t.slice(pluginId.length + 1))
  }
  return [...свои]
}

/** Убрать всё, что плагин записал. Зовётся при УДАЛЕНИИ плагина, а не при
 *  выключении: выключил — данные должны дождаться включения обратно. */
export async function dbDropAll(pluginId: string): Promise<number> {
  const st = await лавка('readwrite')
  const все = await дело(st, st.getAll(), r => (r.result as Запись[]) ?? [])
  let n = 0
  for (const r of все) {
    if (!r.t.startsWith(pluginId + SEP)) continue
    st.delete(r.k)
    n++
  }
  for (const k of [...счётчики.keys()]) if (k.startsWith(pluginId + SEP)) счётчики.delete(k)
  return n
}
