// v1.445.0: выбор нескольких сообщений и удаление пачкой.
//
// Что было. Удалять можно было только по одному: правая кнопка → «Удалить
// сообщение» → подтверждение. Почистить за собой десяток строк означало
// повторить это десять раз. Shift снимал подтверждение (v1.352.0), но и только:
// сами нажатия никуда не девались.
//
// Как теперь. Режим выбора: отмечаешь сообщения (в том числе диапазоном — с
// Shift, как в проводнике), сверху видно, сколько выбрано и сколько из них
// правда получится удалить, и одна кнопка удаляет всё разом.
//
// ГЛАВНОЕ ЗДЕСЬ. Число на кнопке и то, что уйдёт в базу, считает ОДНА функция —
// deletable(). Иначе выходит самая частая поломка этого проекта: экран говорит
// «удалить 12», а уходит 9, потому что три чужих. Тут этого не может быть по
// устройству: показ берёт длину того же списка, который отправляется.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

/** Разом больше сотни не удаляем: это сотня запросов к базе подряд, и на
 *  середине человек уже не понимает, что происходит. Столько же за раз берёт
 *  Discord. */
export const BULK_MAX = 100

export type Selectable = { id: string }

/** Отметить/снять одно. */
export function toggleOne(sel: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(sel)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Диапазон по Shift: от последнего отмеченного до нового, по порядку ленты.
 * Если якоря нет (первое нажатие) — ведёт себя как обычное нажатие.
 */
export function selectRange(
  sel: ReadonlySet<string>, all: readonly Selectable[], anchorId: string | null, id: string,
): Set<string> {
  if (!anchorId || anchorId === id) return toggleOne(sel, id)
  const a = all.findIndex(m => m.id === anchorId)
  const b = all.findIndex(m => m.id === id)
  if (a < 0 || b < 0) return toggleOne(sel, id)
  const next = new Set(sel)
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(all[i].id)
  return next
}

/** Убрать из выбора то, чего больше нет в ленте: сообщение могли удалить с
 *  другого устройства, и «выбрано 5» при четырёх строках — это ложь. */
export function pruneSelection(sel: ReadonlySet<string>, all: readonly Selectable[]): Set<string> {
  const live = new Set(all.map(m => m.id))
  const next = new Set<string>()
  for (const id of sel) if (live.has(id)) next.add(id)
  return next
}

/**
 * Что из выбранного правда можно удалить — в порядке ленты и не больше BULK_MAX.
 *
 * Этой же функцией считается число на кнопке. Другого источника правды нет
 * намеренно.
 */
export function deletable<T extends Selectable>(
  sel: ReadonlySet<string>, all: readonly T[], can: (m: T) => boolean,
): T[] {
  const out: T[] = []
  for (const m of all) {
    if (!sel.has(m.id) || !can(m)) continue
    out.push(m)
    if (out.length >= BULK_MAX) break
  }
  return out
}

/** Сколько выбрано, но удалить нельзя — чужие. Об этом надо сказать прямо, а не
 *  молча удалить меньше, чем человек отметил. */
export function skippedCount<T extends Selectable>(
  sel: ReadonlySet<string>, all: readonly T[], can: (m: T) => boolean,
): number {
  return pruneSelection(sel, all).size - deletable(sel, all, can).length
}

/** Подпись кнопки удаления. Пусто — кнопка не показывается. */
export function bulkLabel(n: number): string {
  if (n <= 0) return ''
  const m10 = n % 10, m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? 'сообщение'
    : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'сообщения'
    : 'сообщений'
  return `Удалить ${n} ${word}`
}

/** Что сказать про пропущенные. Пусто — говорить нечего. */
export function skippedNote(skipped: number, over: boolean): string {
  const parts: string[] = []
  if (skipped > 0) parts.push(`${skipped} чужих удалить нельзя`)
  if (over) parts.push(`за раз удаляется не больше ${BULK_MAX}`)
  return parts.join(' · ')
}

export type BulkResult = { done: number; failed: number }

/**
 * Удалить пачкой. Отказ по одному сообщению не отменяет остальные: чаще всего
 * это чужая строка, а не пропавшие права, и бросать из-за неё всю уборку глупо.
 * Возвращает то, что произошло на самом деле, — врать «удалено 12», когда ушло
 * 9, нельзя.
 */
export async function runBulk<T extends Selectable>(
  items: readonly T[], del: (id: string) => Promise<boolean>,
): Promise<BulkResult> {
  let done = 0, failed = 0
  for (const m of items) {
    if (await del(m.id)) done++
    else failed++
  }
  return { done, failed }
}

/** Что показать по итогам. */
export function bulkReport(r: BulkResult): string {
  if (r.done === 0) return 'Не удалось удалить ни одного сообщения'
  if (r.failed === 0) return `Удалено ${r.done}`
  return `Удалено ${r.done}, не удалось ${r.failed}`
}

// v1.532.0: выбранные сообщения можно скопировать.
//
// Владелец: «сделай, чтобы выбранные сообщения можно было копировать». Режим
// выбора умел удалять (только своё) и пересылать (любое) — а простое «скопировать
// переписку куском» приходилось делать мышью по одному сообщению.
//
// Что копируется. Разговор в том виде, в каком он читается: «Имя: текст», по
// строке на сообщение, в порядке ленты, а не в порядке нажатий. Вложение без
// текста не превращается в пустую строку — вместо него пометка, иначе в
// скопированном куске появлялись бы дыры без объяснения.

export interface CopyMsg {
  id: string
  author_name?: string | null
  content?: string | null
  attach_url?: string | null
}

/** Собрать текст выбранных сообщений в порядке ленты. */
export function copyText(sel: ReadonlySet<string>, all: readonly CopyMsg[]): string {
  const строки: string[] = []
  for (const m of all) {
    if (!sel.has(m.id)) continue
    const кто = (m.author_name ?? '').trim()
    const текст = (m.content ?? '').trim()
    const тело = текст || (m.attach_url ? '[вложение]' : '')
    if (!тело) continue
    строки.push(кто ? кто + ': ' + тело : тело)
  }
  return строки.join('\n')
}

/** Сколько строк уйдёт в буфер — это число и стоит на кнопке. */
export function copyCount(sel: ReadonlySet<string>, all: readonly CopyMsg[]): number {
  return copyText(sel, all) ? copyText(sel, all).split('\n').length : 0
}
