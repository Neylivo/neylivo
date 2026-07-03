import { useEffect, useState } from 'react'

// Красивые тосты вместо системных alert(): всплывают справа внизу и сами исчезают.
export type ToastKind = 'info' | 'ok' | 'error'
interface ToastItem { id: number; msg: string; kind: ToastKind }

let seq = 1
export function toast(msg: string, kind: ToastKind = 'info') {
  window.dispatchEvent(new CustomEvent('ponoi-toast', { detail: { id: seq++, msg: String(msg), kind } }))
}
export const toastOk = (msg: string) => toast(msg, 'ok')
export const toastErr = (msg: string) => toast(msg, 'error')

const ICONS: Record<ToastKind, string> = { info: 'ℹ️', ok: '✅', error: '⚠️' }

export function Toasts() {
  const [list, setList] = useState<ToastItem[]>([])

  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent).detail as ToastItem
      setList(l => [...l.slice(-4), t])   // не больше 5 на экране
      setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), 4500)
    }
    window.addEventListener('ponoi-toast', h)
    return () => window.removeEventListener('ponoi-toast', h)
  }, [])

  if (list.length === 0) return null
  return (
    <div className="toasts">
      {list.map(t => (
        <div key={t.id} className={'toast toast-' + t.kind} onClick={() => setList(l => l.filter(x => x.id !== t.id))}>
          <span className="toast-ic">{ICONS[t.kind]}</span>
          <span className="toast-tx">{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
