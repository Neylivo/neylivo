import { useEffect, useRef, useState } from 'react'
import { ensureModelViewer } from '../lib/modelViewer'
import { takeSlot, freeSlot, subscribeSlots } from '../lib/petSlots'
import { Icon } from './icons'

// v1.439.0: объёмный питомец — отдельным компонентом и по правилам.
//
// Что было не так со старым кодом (он жил прямо в ProfilePet):
//
//   1. <model-viewer> ставился в разметку СРАЗУ, ещё до того, как библиотека
//      загрузится. До регистрации веб-компонента это просто неизвестный тег:
//      пустая дыра нужного размера, без единого признака, что что-то грузится.
//      Если библиотека не загрузилась вовсе — дыра оставалась навсегда, молча.
//   2. Холст жил, пока жив компонент, — даже если питомец далеко за пределами
//      экрана (список участников прокручен, карточка профиля свёрнута). Каждый
//      такой холст крутился вечно (auto-rotate) и занимал контекст WebGL.
//   3. Ограничения на число холстов не было никакого. Браузер держит их около
//      шестнадцати и при переполнении убивает самый старый — на экране чёрные
//      квадраты вместо питомцев. Это и есть та самая «нестабильность».
//   4. Ошибку загрузки самой модели никто не ловил: битая ссылка = пустое место.
//
// Как теперь. Показываем ровно тогда, когда питомец ВИДЕН (IntersectionObserver),
// и только если есть свободное место (petSlots). Пока библиотека грузится —
// спокойная заглушка, а не дыра. Не загрузилось или модель битая — значок, по
// которому понятно, что тут должен быть питомец.
export interface Pet3DProps {
  /** Ссылка на .glb/.gltf. */
  src: string
  /** Уникальный ключ этого питомца на экране — по нему считаются места. */
  id: string
  className?: string
  style?: React.CSSProperties
  /** Крутить самому. Выключается, когда в приложении отключены анимации. */
  autoRotate?: boolean
}

type State = 'idle' | 'loading' | 'ready' | 'failed'

export function Pet3D({ src, id, className, style, autoRotate = true }: Pet3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<State>('idle')
  const [, bump] = useState(0)

  // Виден ли питомец. Пока не виден — холста нет вовсе: ни контекста, ни кадров.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return }
    const io = new IntersectionObserver(es => setVisible(es.some(e => e.isIntersecting)), { threshold: 0.01 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Место среди живых холстов. Освобождается сразу, как питомец ушёл с экрана.
  const mine = useRef(false)
  useEffect(() => {
    if (!visible) { if (mine.current) { mine.current = false; freeSlot(id) } ; return }
    mine.current = takeSlot(id)
    bump(v => v + 1)
    return () => { if (mine.current) { mine.current = false; freeSlot(id) } }
  }, [visible, id])

  // Кто-то освободил место — может, теперь хватит и нам.
  useEffect(() => subscribeSlots(() => {
    if (!visible || mine.current) return
    if (takeSlot(id)) { mine.current = true; bump(v => v + 1) }
  }), [visible, id])

  // Библиотека — только когда питомца действительно показываем.
  useEffect(() => {
    if (!visible || !mine.current || state !== 'idle') return
    setState('loading')
    let ok = true
    ensureModelViewer()
      .then(() => { if (ok) setState(customElements.get('model-viewer') ? 'ready' : 'failed') })
      .catch(() => { if (ok) setState('failed') })
    return () => { ok = false }
  }, [visible, state, mine.current])

  const box: React.CSSProperties = { width: '100%', height: '100%', ...style }

  if (!visible || !mine.current || state !== 'ready') {
    // Заглушка. Специально не пустая: пустое место читается как поломка, а
    // значок — как «тут питомец, просто пока не объёмный».
    return (
      <div ref={hostRef} className={'pet3d-ph' + (className ? ' ' + className : '')} style={box}
        title={state === 'failed' ? 'Объёмный питомец не загрузился' : 'Объёмный питомец'}>
        <Icon name={state === 'failed' ? 'image' : 'cube'} size={18} />
      </div>
    )
  }

  const noAnim = typeof document !== 'undefined' && document.body.classList.contains('no-anim')
  return (
    <div ref={hostRef} style={box}>
      {/* @ts-ignore — веб-компонент, у React для него типов нет */}
      <model-viewer
        className={className}
        style={{ width: '100%', height: '100%', display: 'block' } as any}
        src={src}
        {...(autoRotate && !noAnim ? { 'auto-rotate': true } : {})}
        camera-controls
        disable-zoom
        interaction-prompt="none"
        loading="lazy"
        reveal="auto"
        onError={() => setState('failed')}
      />
    </div>
  )
}
