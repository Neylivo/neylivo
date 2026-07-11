// v1.225.0: общий хук для всех всплывающих панелек, открывающихся по клику/правому
// клику (контекстные меню, пикеры эмодзи и т.п.) — раньше почти каждая такая
// панелька сама прикидывала на глазок, сколько места ей нужно (Math.min(y,
// window.innerHeight - 440) и подобное), и эта прикидка регулярно расходилась с
// реальной высотой (у сообщения может быть то 5 пунктов меню, то 13 — заранее не
// известно). Правильный способ — как уже было сделано в MiniProfile.tsx: положить
// панельку как есть, синхронно измерить её реальный размер (useLayoutEffect — до
// отрисовки кадра, без «прыжка» на глазах) и подвинуть, только если она реально
// вылезла за край. Работает для панельки любой высоты/ширины, включая случаи,
// которые никто не предвидел заранее.
import { useLayoutEffect, useRef, useState } from 'react'

export function useClampToViewport<T extends HTMLElement = HTMLDivElement>(x: number, y: number, margin = 8) {
  const ref = useRef<T>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const clampNow = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(margin, Math.min(x, window.innerWidth - r.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - r.height - margin))
    setPos(p => (p.left === left && p.top === top) ? p : { left, top })
  }
  useLayoutEffect(() => {
    clampNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y])
  // Некоторые панельки меняют высоту уже ПОСЛЕ открытия (раскрыли подменю,
  // догрузилась картинка) — без этого клампинг сработал бы только один раз,
  // на исходный (обычно меньший) размер.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => clampNow())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { ref, style: { left: pos.left, top: pos.top } as React.CSSProperties }
}
