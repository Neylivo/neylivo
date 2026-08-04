// v1.458.0: схема прохождения — то, что видно вместо списка строк.
//
// Рисуется по раскладке из src/lib/flow.ts: узлы стоят змейкой, между ними
// линии, пройденное позади, текущее выделено, дальнейшее приглушено. Свои
// координаты компонент НЕ выдумывает — иначе линии перестали бы попадать в
// узлы, а на схеме из полусотни вех это не разглядеть.
//
// Схему можно возить пальцем и мышью: на телефоне она шире экрана всегда.
import { useRef, useState } from 'react'
import { Icon } from './icons'
import { layoutFlow, linkPath, NODE_W, NODE_H, type FlowNode, type Placed } from '../lib/flow'

export function CampaignFlow({ nodes, onPick, picked }: {
  nodes: FlowNode[]
  onPick?: (n: Placed) => void
  picked?: string | null
}) {
  const [perRow, setPerRow] = useState(4)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null)

  const l = layoutFlow(nodes, perRow)

  // Возить схему: мышью и пальцем одинаково. Без этого длинную цепочку можно
  // было бы смотреть только колесом, а на телефоне — никак.
  const down = (e: React.PointerEvent) => {
    const el = box.current
    if (!el || (e.target as HTMLElement).closest('.flow-node')) return
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const el = box.current
    if (!el || !drag.current) return
    el.scrollLeft = drag.current.l - (e.clientX - drag.current.x)
    el.scrollTop = drag.current.t - (e.clientY - drag.current.y)
  }
  const up = () => { drag.current = null }

  return (
    <div className="flow-wrap">
      <div className="flow-tools">
        <button title="Плотнее" onClick={() => setPerRow(n => Math.min(n + 1, 8))}><Icon name="zoom-out" size={14} /></button>
        <button title="Крупнее" onClick={() => setPerRow(n => Math.max(n - 1, 2))}><Icon name="zoom-in" size={14} /></button>
      </div>
      <div className="flow-box" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="flow-canvas" style={{ width: l.width, height: l.height }}>
          <svg className="flow-lines" width={l.width} height={l.height}>
            {l.links.map((link, i) => {
              const a = l.nodes[i], b = l.nodes[i + 1]
              if (!a || !b) return null
              const p = linkPath(a, b)
              // Ломаная в две ступени, а не прямая по диагонали: так линии
              // читаются как схема, а не как паутина.
              const mx = (p.x1 + p.x2) / 2
              const d = p.y1 === p.y2
                ? `M${p.x1} ${p.y1} H${p.x2}`
                : `M${p.x1} ${p.y1} V${(p.y1 + p.y2) / 2} H${p.x2 === p.x1 ? p.x2 : mx} V${p.y2}`
              return <path key={i} d={d} className={'flow-link' + (b.done ? ' done' : '')} />
            })}
          </svg>
          {l.nodes.map(n => (
            <div key={n.id}
              className={'flow-node' + (n.done ? ' done' : '') + (n.current ? ' cur' : '') + (picked === n.id ? ' sel' : '')}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              onClick={() => onPick?.(n)}>
              {n.icon
                ? <img className="flow-ic" src={n.icon} alt="" loading="lazy" />
                : <span className="flow-ic ph">{n.done ? <Icon name="check" size={14} /> : n.step + 1}</span>}
              <span className="flow-nm" title={n.title}>{n.title}</span>
              {n.current && <span className="flow-here">сейчас здесь</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
