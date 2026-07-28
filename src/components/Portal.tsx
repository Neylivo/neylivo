import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// v1.341.0: окна, которые обязаны считать координаты от ЭКРАНА, а не от того,
// внутри чего они оказались в разметке.
//
// Почему это понадобилось. Окно настроек (.pqs2) появляется с анимацией
// `scale: .97 -> 1` и `fill-mode: both` — то есть значение `scale: 1` остаётся
// на элементе навсегда. По правилам CSS любой transform/scale, отличный от
// `none`, делает элемент точкой отсчёта для потомков с `position: fixed`.
// Поэтому модалка, открытая из настроек, считала `inset: 0` не от экрана, а от
// коробки настроек: её высота мерилась в процентах экрана, а помещалась она в
// коробку — отсюда «криво торчит» и обрезанный верх.
//
// Чинить снятием анимации нельзя: завтра кто-нибудь добавит transform в другого
// предка, и всё повторится. Портал же выносит узел прямо в <body>, и никакой
// предок на него больше не влияет — ни сейчас, ни потом.
export function Portal({ children }: { children: ReactNode }) {
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = 'ponoi-portal'
    return el
  })
  useEffect(() => {
    document.body.appendChild(host)
    return () => { host.remove() }
  }, [host])
  return createPortal(children, host)
}
