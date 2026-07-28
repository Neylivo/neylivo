import { useEffect, useRef, useState } from 'react'

// v1.381.0: мини-плашка плеера перетаскивается и не мешает.
//
// Она висела в правом нижнем углу намертво и закрывала собой то, что там
// оказалось: кнопку, край списка, последнее сообщение. Убрать её можно было
// только выключив музыку.
//
// Пока тащишь — сворачивается в кружок: полоса шириной в треть экрана,
// летающая за курсором, закрывает ещё больше, чем стояла на месте. Отпустил —
// разворачивается там, где оставил.
//
// Положение помним между запусками: человек поставил её туда, где ему удобно,
// и заново двигать её при каждом входе — издевательство.

const KEY = 'ponoi_mus_mini_pos_v1'

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
  const [dragging, setDragging] = useState(false)
  // Сдвиг курсора от угла плашки: без него она прыгает углом под курсор.
  const grab = useRef<DragPos>({ x: 0, y: 0 })
  // Тащили или просто щёлкнули: по щелчку плашка открывает плеер, и превращать
  // любое движение мыши в перетаскивание нельзя.
  const moved = useRef(false)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      moved.current = true
      const el = ref.current
      const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0
      setPos(clamp({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }, w, h))
    }
    const onUp = () => {
      setDragging(false)
      setPos(p => {
        if (p) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* переполнено */ } }
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
  }, [dragging])

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
    moved.current = false
    setDragging(true)
  }

  /** Было ли это перетаскиванием — чтобы отличить от щелчка. */
  const wasDrag = () => moved.current

  const style: React.CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : undefined

  return { ref, style, dragging, onPointerDown, wasDrag }
}
