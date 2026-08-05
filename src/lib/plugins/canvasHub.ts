// v1.465.0: холст в панели плагина.
//
// Зачем. Панель умела показывать строки: подпись, полосу, ползунок, картинку по
// ссылке. Для настройки этого хватает, для КАРТИНКИ — нет: визуализатор музыки,
// свой график, разбор переписки в виде диаграммы, простая игра — всё это рисуется
// попиксельно, и описать его строками нельзя.
//
// Как это не ломает песочницу. Плагин по-прежнему не касается страницы. Ему
// уходит OffscreenCanvas — отдельный холст, у которого есть только собственные
// пиксели. Через него нельзя ни прочитать страницу, ни узнать, что на ней, ни
// нарисовать что-либо за пределами своего прямоугольника в своей панели. Это
// ровно тот же приём, что и со строками: приложение даёт МЕСТО, а не доступ.
//
// Почему элемент живёт здесь, а не в компоненте панели. Управление холстом
// отдаётся воркеру ровно ОДИН раз: transferControlToOffscreen нельзя позвать
// дважды, а второй вызов бросает исключение. Панель же — обычный компонент,
// который размонтируется при переходе на другой экран и монтируется снова.
// Держи мы элемент в компоненте — после первого же ухода с экрана холст плагина
// умирал бы навсегда. Поэтому элемент создаётся здесь, переживает любое число
// перерисовок, а панель лишь вставляет его в себя.
//
// Проверки: src/lib/plugins/__test.ts.

/** Ширина буфера рисования. Панель узкая, больше незачем; по CSS холст тянется
 *  на всю ширину, то есть картинка масштабируется, а не обрезается. */
export const CANVAS_W = 600

export class CanvasError extends Error {}

interface Slot {
  el: HTMLCanvasElement
  /** Управление уже отдано воркеру — второй раз нельзя. */
  taken: boolean
  h: number
}

const slots = new Map<string, Slot>()
const keyOf = (pluginId: string, key: string) => pluginId + '\u0000' + key

export function canvasHeight(raw: unknown): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return 160
  // v1.489.0: высоту холста больше не зажимаем — какую попросил, такая и будет.
  return Math.max(1, n)
}

function countFor(pluginId: string): number {
  let n = 0
  for (const k of slots.keys()) if (k.startsWith(pluginId + '\u0000')) n++
  return n
}

/**
 * Элемент холста. Создаётся при первом обращении и живёт до остановки плагина.
 *
 * Высота может измениться (плагин прислал панель заново) — меняем и буфер
 * рисования тоже, иначе картинка растянулась бы. Смена размера чистит холст, и
 * это правильно: плагину о ней сообщают событием 'canvas'.
 */
export function ensureCanvas(pluginId: string, key: string, height: number): HTMLCanvasElement {
  const k = keyOf(pluginId, key)
  const have = slots.get(k)
  if (have) {
    if (have.h !== height && !have.taken) {
      have.h = height
      have.el.height = height
    }
    return have.el
  }
  if (typeof document === 'undefined') throw new CanvasError('Холст недоступен вне окна')
  const el = document.createElement('canvas')
  el.width = CANVAS_W
  el.height = height
  el.className = 'plugpanel-canvas'
  slots.set(k, { el, taken: false, h: height })
  return el
}

/**
 * Отдать управление воркеру. Второй раз по тому же ключу — отказ с объяснением,
 * а не исключение браузера: плагин, позвавший getCanvas дважды, должен понять,
 * что холст у него уже есть.
 */
export function takeOffscreen(pluginId: string, key: string, height: number): OffscreenCanvas {
  const el = ensureCanvas(pluginId, key, height)
  const slot = slots.get(keyOf(pluginId, key))!
  if (slot.taken) throw new CanvasError(`Холст «${key}» уже отдан этому плагину — второй раз его не получить.`)
  const anyEl = el as unknown as { transferControlToOffscreen?: () => OffscreenCanvas }
  if (typeof anyEl.transferControlToOffscreen !== 'function') {
    throw new CanvasError('Это окно не умеет отдавать холст в песочницу (старый браузер).')
  }
  const off = anyEl.transferControlToOffscreen()
  slot.taken = true
  return off
}

/** Есть ли уже холст под этим ключом — панели нужно знать, что вставлять. */
export function peekCanvas(pluginId: string, key: string): HTMLCanvasElement | null {
  return slots.get(keyOf(pluginId, key))?.el ?? null
}

export function canvasSize(pluginId: string, key: string): { width: number; height: number } | null {
  const s = slots.get(keyOf(pluginId, key))
  return s ? { width: s.el.width, height: s.el.height } : null
}

/** Убрать всё, что нарисовал плагин: при выключении и при удалении. */
export function clearCanvases(pluginId: string) {
  for (const [k, s] of [...slots]) {
    if (!k.startsWith(pluginId + '\u0000')) continue
    s.el.remove()
    slots.delete(k)
  }
}

/** Аварийный режим: убрать все холсты. */
export function clearAllCanvases() {
  for (const [, s] of slots) s.el.remove()
  slots.clear()
}

/** Для проверок. */
export function canvasCount(): number { return slots.size }
