import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Discord-style hover tooltip for the server rail. Native `title=""`
// attributes render as slow, plain OS tooltips that look nothing like
// Discord's dark pill-with-arrow — this replaces them. Portaled to
// document.body (not just absolutely positioned) because `.servers` is
// a scrollable column (`overflow-y:auto`, which forces `overflow-x` to
// clip too), so a tooltip positioned inside it would get cut off the
// moment the server list is long enough to scroll.
export function RailTip({ text, children }: { text: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const enter = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ top: r.top + r.height / 2, left: r.right + 16 })
  }
  const leave = () => setPos(null)

  return (
    <div ref={ref} onMouseEnter={enter} onMouseLeave={leave} onClick={leave}>
      {children}
      {pos && createPortal(
        <div className="rail-tooltip" style={{ top: pos.top, left: pos.left }}>
          <span className="rail-tooltip-arrow" />
          {text}
        </div>,
        document.body
      )}
    </div>
  )
}
