import { useRef, useState, useEffect, type PointerEvent } from 'react'
import { Icon } from './icons'

const COLORS = ['#ffffff', '#000000', '#ed4245', '#faa61a', '#3ba55d', '#5865f2', '#eb459e', '#00b0f4']
const BG = '#2b2d31'

// Холст «Стены росписи» (v1.146.0): рисование указателем (мышь/тач), палитра,
// толщина кисти, ластик и «очистить». Сохранение отдаёт PNG-блоб наверх.
export function WallDraw({ onClose, onSave }: { onClose: () => void; onSave: (blob: Blob) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#5865f2')
  const [size, setSize] = useState(6)
  const [eraser, setEraser] = useState(false)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, c.width, c.height)
  }, [])

  function pos(e: PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function down(e: PointerEvent<HTMLCanvasElement>) {
    drawing.current = true
    const p = pos(e); last.current = p
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.fillStyle = eraser ? BG : color
    ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill()
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const p = pos(e)
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.strokeStyle = eraser ? BG : color
    ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
  }
  function up() { drawing.current = false; last.current = null }
  function clear() {
    const c = canvasRef.current!; const ctx = c.getContext('2d')!
    ctx.fillStyle = BG; ctx.fillRect(0, 0, c.width, c.height)
  }
  function save() { canvasRef.current!.toBlob(b => { if (b) onSave(b) }, 'image/png') }

  return (
    <div className="wall-modal-bg" onClick={onClose}>
      <div className="wall-modal" onClick={e => e.stopPropagation()}>
        <div className="wall-modal-h">Нарисуй что-нибудь на стене</div>
        <canvas ref={canvasRef} width={640} height={400} className="wall-canvas"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        <div className="wall-tools">
          <div className="wall-colors">
            {COLORS.map(c => <button key={c} className={'wall-col' + (!eraser && color === c ? ' on' : '')} style={{ background: c }} onClick={() => { setColor(c); setEraser(false) }} />)}
          </div>
          <input type="range" min={2} max={40} value={size} onChange={e => setSize(+e.target.value)} title="Толщина" />
          <button className={'wall-tbtn' + (eraser ? ' on' : '')} onClick={() => setEraser(x => !x)} title="Ластик"><Icon name="close" size={15} /></button>
          <button className="wall-tbtn" onClick={clear} title="Очистить"><Icon name="trash" size={15} /></button>
          <div className="wall-tools-r">
            <button className="wall-cancel" onClick={onClose}>Отмена</button>
            <button className="wall-save" onClick={save}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  )
}
