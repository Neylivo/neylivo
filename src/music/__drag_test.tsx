// Проверка перетаскивания мини-плашки плеера. Запуск: npm run test:drag
//
// Здесь только страница-подопытный: настоящий useDragBar (не копия логики) и
// плашка из тех же классов, что в плеере. Нажимает и водит мышью сам Electron —
// scripts/drag-test.cjs, доверенным вводом, как человек.
//
// Почему в окне, а не в Node: проверяется как раз то, чего в Node нет —
// последовательность pointerdown/pointermove/pointerup, порог в пять пикселей и
// то, что щелчок по кнопке паузы доходит до кнопки, а не превращается в
// перетаскивание.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useDragBar } from './useDragBar'

function Panel() {
  const d = useDragBar()
  const [plays, setPlays] = React.useState(0)
  const [opens, setOpens] = React.useState(0)
  const w = window as any
  w.__st = () => ({
    plays, opens, dragging: d.dragging,
    rect: d.ref.current?.getBoundingClientRect().toJSON(),
  })
  return (
    <div ref={d.ref} className={'mus-mini' + (d.dragging ? ' dragging' : '')}
      style={{ position: 'fixed', left: 100, top: 100, right: 'auto', bottom: 'auto', ...d.style }}
      onPointerDown={d.onPointerDown}>
      <div className="mus-mini-art" onClick={() => { if (!d.wasDrag()) setOpens(o => o + 1) }}>▶</div>
      <div className="mus-mini-meta" onClick={() => { if (!d.wasDrag()) setOpens(o => o + 1) }}>
        <div className="mus-mini-t">Название трека</div>
        <div className="mus-mini-s">NeyLivo Music</div>
      </div>
      <button className="mm-play" id="play" onPointerDown={e => e.stopPropagation()} onClick={() => setPlays(p => p + 1)}>II</button>
      <button onPointerDown={e => e.stopPropagation()}>▷|</button>
      <button onPointerDown={e => e.stopPropagation()}>×</button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Panel />)
