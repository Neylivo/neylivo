// v1.431.0: приближение и перетаскивание картинки в просмотрщике.
//
// Что было. Колесо мыши меняло масштаб, и всё: увеличивалось от ЦЕНТРА картинки,
// а сдвинуть её было нельзя вообще. То есть приблизить угол фотографии или
// прочитать надпись у края — невозможно: увеличил, а нужное уехало за экран и
// достать его нечем. На телефоне не было и этого: щипок двумя пальцами
// просмотрщик не понимал, а колеса там нет.
//
// Здесь чистая часть: вся арифметика приближения и границ сдвига. Отдельно —
// потому что именно в ней вся суть и все ошибки: «увеличить к точке под
// курсором» это не «умножить масштаб», а «умножить и подвинуть так, чтобы точка
// осталась на месте». Проверить это глазами почти нельзя, а промах в знаке
// уводит картинку в сторону.

export interface ZoomState {
  /** Масштаб: 1 — картинка вписана в экран. */
  zoom: number
  /** Сдвиг в пикселях экрана от центра. */
  x: number
  y: number
}

export const ZOOM_MIN = 1
export const ZOOM_MAX = 8
/** Двойной щелчок приближает сразу к этому масштабу. */
export const ZOOM_STEP = 2.5

export const zoomStart: ZoomState = { zoom: 1, x: 0, y: 0 }

export const clampZoom = (z: number): number =>
  !Number.isFinite(z) ? 1 : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/**
 * Увеличить в точке (px, py) — координаты относительно ЦЕНТРА картинки.
 *
 * Смысл: точка под курсором (или между пальцами) обязана остаться на месте.
 * Иначе увеличение всё время «убегает» в центр, и приблизить край невозможно —
 * ровно на это и жаловались.
 */
export function zoomAt(st: ZoomState, factor: number, px: number, py: number): ZoomState {
  const z = clampZoom(st.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1))
  const k = z / st.zoom
  if (!Number.isFinite(k) || k === 1) return { ...st, zoom: z }
  // Точка в системе картинки: (px - x) / zoom. После смены масштаба она должна
  // остаться в той же точке экрана — отсюда новый сдвиг.
  return { zoom: z, x: px - (px - st.x) * k, y: py - (py - st.y) * k }
}

/**
 * Не дать увести картинку за пределы разумного.
 *
 * Правило: пока сторона картинки меньше окна — она стоит по центру (двигать
 * нечего); когда больше — её край не заходит внутрь окна. Без этого картинку
 * можно было бы «выбросить» за экран и потерять.
 */
export function clampPan(st: ZoomState, viewW: number, viewH: number, imgW: number, imgH: number): ZoomState {
  const w = imgW * st.zoom, h = imgH * st.zoom
  const maxX = Math.max(0, (w - viewW) / 2)
  const maxY = Math.max(0, (h - viewH) / 2)
  const x = Math.min(maxX, Math.max(-maxX, Number.isFinite(st.x) ? st.x : 0))
  const y = Math.min(maxY, Math.max(-maxY, Number.isFinite(st.y) ? st.y : 0))
  return { zoom: st.zoom, x, y }
}

/** Масштаб по щипку: во сколько раз разъехались пальцы. */
export function pinchZoom(startZoom: number, distStart: number, distNow: number): number {
  if (!(distStart > 0) || !(distNow > 0)) return clampZoom(startZoom)
  return clampZoom(startZoom * (distNow / distStart))
}

/** Расстояние между двумя пальцами. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/** Середина между двумя пальцами — к ней и приближаем. */
export function mid(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  return { x: (ax + bx) / 2, y: (ay + by) / 2 }
}

/**
 * Двойной щелчок (или двойной тап): если картинка не приближена — приблизить в
 * этой точке, если приближена — вернуть как было. Именно так это работает во
 * всех просмотрщиках, и человек ожидает того же.
 */
export function toggleZoomAt(st: ZoomState, px: number, py: number): ZoomState {
  if (st.zoom > 1.01) return { ...zoomStart }
  return zoomAt(st, ZOOM_STEP, px, py)
}

/** Двигали ли картинку настолько, что это перетаскивание, а не щелчок. */
export const DRAG_SLOP = 6
export const wasDragged = (dx: number, dy: number): boolean => Math.hypot(dx, dy) > DRAG_SLOP
