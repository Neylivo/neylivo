// v1.433.0: долгое нажатие — одно на всё приложение.
//
// Зачем. На телефоне правого щелчка нет, и меню сообщения и карточки трека
// открываются долгим нажатием (v1.426.0). Написано это было дважды, в двух
// местах, и в обоих одинаково неверно:
//
// 1. **Отмена по любому движению.** Палец на экране не стоит неподвижно
//    никогда — браузер шлёт pointermove на доли пикселя просто потому, что рука
//    живая. Отмена «на первом же move» означает, что меню не открывается почти
//    никогда: держишь — и ничего. Ровно так же было в плашке плеера, и там
//    ответ уже найден (см. zoomPan.DRAG_SLOP): у нажатия должен быть допуск, и
//    дрожь в несколько пикселей — это по-прежнему нажатие, а не протяжка.
//
// 2. **Слушатели вешались на сам элемент и снимались через e.currentTarget.**
//    В React `currentTarget` после выхода из обработчика равен null, поэтому в
//    карточке трека снятие молча не срабатывало: каждое касание оставляло на
//    элементе три вечных слушателя. А если палец уезжал с элемента, до него не
//    доходил и pointerup — нажатие «зависало» открытым.
//
// Поэтому слушатели здесь — на окне и в фазе перехвата: они увидят и палец,
// уехавший в сторону, и прокрутку списка (событие scroll не всплывает, но в
// перехвате доходит до окна). Прокрутка — это точно не «нажал и держит».

/** Сколько держать, чтобы это считалось долгим нажатием. */
export const LONG_PRESS_MS = 450

/**
 * Допуск на дрожь руки, пиксели.
 *
 * Меньше — и меню перестанет открываться у любого, кто держит телефон в руке, а
 * не кладёт на стол. Больше — и настоящая протяжка (прокрутка списка) успеет
 * сойти за нажатие. Десять — та же величина, что у протяжки в просмотрщике.
 */
export const LONG_PRESS_SLOP = 10

export interface Pt { x: number; y: number }

/** Ушёл ли палец дальше допуска — то есть это уже не нажатие, а движение. */
export function movedTooFar(from: Pt, to: Pt, slop: number = LONG_PRESS_SLOP): boolean {
  const dx = to.x - from.x, dy = to.y - from.y
  return dx * dx + dy * dy > slop * slop
}

/** Минимум от события указателя, который нужен долгому нажатию. */
export interface PressLike {
  pointerType?: string
  clientX: number
  clientY: number
}

/**
 * Начать отсчёт долгого нажатия. Зовётся из onPointerDown.
 *
 * Мышь пропускаем: у неё есть правый щелчок, и там меню уже открывается им.
 * Возвращает функцию отмены — на случай, если вызвавший захочет прервать сам
 * (например, элемент исчез с экрана).
 */
export function startLongPress(e: PressLike, run: (at: Pt) => void, ms: number = LONG_PRESS_MS): () => void {
  if (e.pointerType === 'mouse') return () => {}
  const at: Pt = { x: e.clientX, y: e.clientY }
  const w = window as unknown as {
    setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout
    addEventListener: (t: string, f: (ev: any) => void, c?: boolean) => void
    removeEventListener: (t: string, f: (ev: any) => void, c?: boolean) => void
  }
  const move = (ev: { clientX: number; clientY: number }) => {
    if (movedTooFar(at, { x: ev.clientX, y: ev.clientY })) off()
  }
  const timer = w.setTimeout(() => { off(); run(at) }, ms)
  const off = () => {
    w.clearTimeout(timer)
    w.removeEventListener('pointerup', off, true)
    w.removeEventListener('pointercancel', off, true)
    w.removeEventListener('pointermove', move, true)
    w.removeEventListener('scroll', off, true)
  }
  w.addEventListener('pointerup', off, true)
  w.addEventListener('pointercancel', off, true)
  w.addEventListener('pointermove', move, true)
  w.addEventListener('scroll', off, true)
  return off
}
