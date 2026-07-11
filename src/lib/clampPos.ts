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
  // clampNow закрывается над x/y — держим последнюю версию в ref, чтобы
  // ResizeObserver ниже (подключается один раз, при монтировании) не звал
  // «протухшую» версию с координатами, которые были актуальны только в момент
  // самого первого рендера этого экземпляра компонента.
  const clampNowRef = useRef(clampNow)
  clampNowRef.current = clampNow
  useLayoutEffect(() => {
    clampNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y])
  // Некоторые панельки меняют высоту уже ПОСЛЕ открытия (раскрыли подменю,
  // догрузилась картинка) — без этого клампинг сработал бы только один раз,
  // на исходный (обычно меньший) размер. Плюс — ресайз/поворот самого окна
  // (Electron, PWA на телефоне) при открытой панельке.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const onResize = () => clampNowRef.current()
    window.addEventListener('resize', onResize)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => { window.removeEventListener('resize', onResize); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { ref, style: { left: pos.left, top: pos.top } as React.CSSProperties }
}

// v1.234.0: подменю (.ctx-item.has-sub .ctx-submenu) открывается вправо от
// родительского пункта через чистый CSS (position:absolute; left:100%) — когда
// родительское меню уже прижато useClampToViewport к правому краю экрана (самая
// частая ситуация, при которой подменю вообще рискует не влезть), подменю
// вылезает за край. ResizeObserver у родителя это не ловит: абсолютно
// спозиционированный потомок не меняет собственный layout-box родителя. Меряем
// подменю сразу после монтирования (условный рендер — значит, свежий mount
// при каждом открытии) и, если оно вылезает вправо, разворачиваем его влево.
export function useFlipSubmenu<T extends HTMLElement = HTMLDivElement>(margin = 8) {
  const ref = useRef<T>(null)
  const [flip, setFlip] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) { setFlip(false); return }
    setFlip(el.getBoundingClientRect().right > window.innerWidth - margin)
  }, [])
  return { ref, style: (flip ? { left: 'auto', right: '100%', marginLeft: 0, marginRight: 4 } : {}) as React.CSSProperties }
}
