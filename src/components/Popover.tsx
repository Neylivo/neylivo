// v1.460.0: обёртка для всплывающих панелей — закрывает щелчком мимо и Escape.
//
// Зачем компонентом. Выбор эмодзи и гифок закрывался только повторным нажатием
// на значок; каждая новая панель повторяла бы ту же ошибку. Теперь панель
// оборачивается — и ведёт себя как положено, без единой строки в самой панели.
//
// Правило «что считать щелчком мимо» лежит в src/lib/dismiss.ts и проверяется
// отдельно: в нём три тонкости, и все три ловятся не глазами, а проверкой.
import { useEffect, useRef, type ReactNode } from 'react'
import { shouldDismiss } from '../lib/dismiss'

export function Popover({ children, onClose, trigger, className }: {
  children: ReactNode
  onClose: () => void
  /** Значок, которым панель открыли: нажатие по нему «мимо» не считается. */
  trigger?: Element | null
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Слушаем со СЛЕДУЮЩЕГО кадра. Иначе то самое нажатие, которым панель
    // открыли, долетит до окна и закроет её мгновенно — панель мигнула бы и
    // исчезла, а выглядело бы это как «кнопка не работает».
    let жив = true
    const on = (e: Event) => {
      if (shouldDismiss(e.target, box.current, trigger)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t = setTimeout(() => {
      if (!жив) return
      window.addEventListener('pointerdown', on, true)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    return () => {
      жив = false
      clearTimeout(t)
      window.removeEventListener('pointerdown', on, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, trigger])

  return <div ref={box} className={className}>{children}</div>
}
