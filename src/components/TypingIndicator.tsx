import { useEffect, useRef, useState } from 'react'

// Плавное появление и затухание индикатора «печатает…» вместо резкого исчезновения.
export function TypingIndicator({ typers }: { typers: string[] }) {
  const [shown, setShown] = useState<string[]>([])
  const [fading, setFading] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (typers.length > 0) {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
      setShown(typers); setFading(false)
    } else if (shown.length > 0) {
      setFading(true)
      timer.current = window.setTimeout(() => { setShown([]); setFading(false); timer.current = null }, 400)
    }
    return () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typers])

  if (shown.length === 0) return null
  return (
    <div className={'typing-ind' + (fading ? ' fade' : '')}>
      <span className="typing-dots"><i/><i/><i/></span>
      {shown.length >= 3 ? 'Несколько человек печатают…' : shown.join(', ') + (shown.length === 2 ? ' печатают…' : ' печатает…')}
    </div>
  )
}
