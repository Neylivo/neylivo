// v1.439.0: сколько объёмных питомцев может жить на экране одновременно.
//
// Зачем это вообще нужно. Каждый <model-viewer> — это отдельный холст WebGL со
// своим контекстом. Браузер держит их ограниченное число (у Chromium порядка
// шестнадцати), и при переполнении он молча убивает САМЫЙ СТАРЫЙ: на экране
// остаётся чёрный квадрат вместо питомца, а иногда роняет и соседние. В списке
// участников, где у каждого может стоять свой питомец, до этого предела
// добраться легко — и выглядит это как «3D-питомцы глючат».
//
// Плюс каждый такой холст крутится вечно (auto-rotate) и жрёт кадры, даже когда
// его никто не видит.
//
// Поэтому: живых холстов не больше MAX_LIVE, остальные показываются картинкой-
// заглушкой. Место освобождается, как только питомец уходит с экрана.

/**
 * Сколько объёмных питомцев показывать по-настоящему.
 *
 * Четыре — с большим запасом до предела браузера: даже если где-то в приложении
 * откроется ещё пара холстов (просмотр модели в настройках, предпросмотр), места
 * хватит всем. Больше четырёх объёмных фигурок на экране всё равно не
 * рассматривают.
 */
export const MAX_LIVE = 4

const live = new Set<string>()
const listeners = new Set<() => void>()

export function subscribeSlots(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
const notify = () => listeners.forEach(f => { try { f() } catch {} })

/** Занять место. false — мест нет, показывай заглушку. */
export function takeSlot(id: string): boolean {
  if (live.has(id)) return true
  if (live.size >= MAX_LIVE) return false
  live.add(id)
  notify()
  return true
}

/** Освободить место. Зовётся, когда питомец ушёл с экрана или размонтирован. */
export function freeSlot(id: string) {
  if (!live.delete(id)) return
  notify()
}

export const hasSlot = (id: string): boolean => live.has(id)
export const liveCount = (): number => live.size

/** Только для проверок: вернуть всё в исходное. */
export function resetSlots() {
  live.clear()
  notify()
}
