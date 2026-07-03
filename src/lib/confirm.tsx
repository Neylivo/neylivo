import { useEffect, useState } from 'react'

// Красивые модалки подтверждения вместо системного confirm().
// Использование: if (!await confirmUi('Удалить сообщение?')) return
// Возвращает Promise<boolean>; Enter/кнопка — подтвердить, Esc/фон — отмена.

interface Ask {
  id: number
  msg: string
  okText: string
  danger: boolean
  resolve: (v: boolean) => void
}

let seq = 1
export function confirmUi(msg: string, opts?: { okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent('ponoi-confirm', {
      detail: { id: seq++, msg, okText: opts?.okText ?? 'Подтвердить', danger: opts?.danger ?? true, resolve },
    }))
  })
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null)

  useEffect(() => {
    const h = (e: Event) => setAsk((e as CustomEvent).detail as Ask)
    window.addEventListener('ponoi-confirm', h)
    return () => window.removeEventListener('ponoi-confirm', h)
  }, [])

  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false) }
      if (e.key === 'Enter') { e.preventDefault(); done(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  function done(v: boolean) {
    ask?.resolve(v)
    setAsk(null)
  }

  if (!ask) return null
  return (
    <div className="cfm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) done(false) }}>
      <div className="cfm-box">
        <div className="cfm-msg">{ask.msg}</div>
        <div className="cfm-btns">
          <button className="cfm-cancel" onClick={() => done(false)}>Отмена</button>
          <button className={ask.danger ? 'cfm-ok danger' : 'cfm-ok'} autoFocus onClick={() => done(true)}>{ask.okText}</button>
        </div>
      </div>
    </div>
  )
}
