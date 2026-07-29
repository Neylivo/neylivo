import { useEffect, useRef, useState } from 'react'

// v1.381.0: мини-плашка плеера перетаскивается и не мешает.
//
// Она висела в правом нижнем углу намертво и закрывала собой то, что там
// оказалось: кнопку, край списка, последнее сообщение. Убрать её можно было
// только выключив музыку.
//
// Положение помним между запусками: человек поставил её туда, где ему удобно,
// и заново двигать её при каждом входе — издевательство.
//
// v1.391.0: перетаскивание начинается только после пяти пикселей движения.
// Раньше им становилось любое нажатие, в котором рука дрогнула хоть на пиксель:
// плашка при этом мгновенно сжималась в кружок прямо под курсором, кнопка паузы
// уезжала из-под пальца, а щелчок засчитывался как перетаскивание — то есть
// плеер не открывался и музыка не ставилась на паузу. Пять пикселей человек не
// замечает, а промахнуться на них проще простого.

const KEY = 'ponoi_mus_mini_pos_v1'
/** Ниже этого порога движение — это ещё щелчок, а не перетаскивание. */
const THRESHOLD = 5

export interface DragPos { x: number; y: number }

function load(): DragPos | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null
  } catch { return null }
}

/** Не даём плашке уехать за край: окно могли уменьшить с прошлого раза. */
function clamp(p: DragPos, w: number, h: number): DragPos {
  const maxX = Math.max(0, window.innerWidth - w)
  const maxY = Math.max(0, window.innerHeight - h)
  return { x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) }
}

export function useDragBar() {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<DragPos | null>(load)
  // pressing — кнопка мыши зажата на плашке; dragging — порог пройден и плашка
  // действительно едет. Пока порог не пройден, на вид не меняется ничего.
  const [pressing, setPressing] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Сдвиг курсора от угла плашки: без него она прыгает углом под курсор.
  const grab = useRef<DragPos>({ x: 0, y: 0 })
  const start = useRef<DragPos>({ x: 0, y: 0 })
  // Тащили или просто щёлкнули: по щелчку плашка открывает плеер, и превращать
  // любое движение мыши в перетаскивание нельзя.
  const moved = useRef(false)

  useEffect(() => {
    if (!pressing) return
    const onMove = (e: PointerEvent) => {
      if (!moved.current) {
        const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y
        if (Math.hypot(dx, dy) < THRESHOLD) return
        moved.current = true
        setDragging(true)
      }
      const el = ref.current
      const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0
      setPos(clamp({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }, w, h))
    }
    const onUp = () => {
      setPressing(false)
      setDragging(false)
      setPos(p => {
        if (p && moved.current) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* переполнено */ } }
        return p
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [pressing])

  // Окно уменьшили — возвращаем плашку в видимую часть.
  useEffect(() => {
    const onResize = () => setPos(p => {
      if (!p) return p
      const el = ref.current
      return clamp(p, el?.offsetWidth ?? 0, el?.offsetHeight ?? 0)
    })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onPointerDown(e: React.PointerEvent) {
    // Тянем только основной кнопкой и только за саму плашку, не за её кнопки.
    if (e.button !== 0) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    grab.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    start.current = { x: e.clientX, y: e.clientY }
    moved.current = false
    setPressing(true)
  }

  /** Было ли это перетаскиванием — чтобы отличить от щелчка. */
  const wasDrag = () => moved.current

  const style: React.CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : undefined

  return { ref, style, dragging, onPointerDown, wasDrag }
}
