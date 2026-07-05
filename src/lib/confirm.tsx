import { useEffect, useState } from 'react'

// Красивые модалки подтверждения и ввода вместо системных confirm()/prompt().
// if (!await confirmUi('Удалить сообщение?')) return
// const name = await promptUi('Название роли', { placeholder: 'Модератор' }); if (!name) return

interface Ask {
  id: number
  msg: string
  okText: string
  danger: boolean
  input?: { placeholder?: string; initial?: string }
  resolve: (v: any) => void
}

let seq = 1
export function confirmUi(msg: string, opts?: { okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent('ponoi-confirm', {
      detail: { id: seq++, msg, okText: opts?.okText ?? 'Подтвердить', danger: opts?.danger ?? true, resolve },
    }))
  })
}

// v1.74.0: модалка с полем ввода — замена системному prompt() (как в Discord).
// Возвращает введённый текст или null (отмена / пустое значение).
export function promptUi(msg: string, opts?: { okText?: string; placeholder?: string; initial?: string }): Promise<string | null> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent('ponoi-confirm', {
      detail: {
        id: seq++, msg, okText: opts?.okText ?? 'Сохранить', danger: false,
        input: { placeholder: opts?.placeholder, initial: opts?.initial },
        resolve,
      },
    }))
  })
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [val, setVal] = useState('')

  useEffect(() => {
    const h = (e: Event) => { const a = (e as CustomEvent).detail as Ask; setVal(a.input?.initial ?? ''); setAsk(a) }
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
  }, [ask, val])

  function done(v: boolean) {
    if (!ask) return
    if (ask.input) ask.resolve(v ? (val.trim() || null) : null)
    else ask.resolve(v)
    setAsk(null)
  }

  if (!ask) return null
  return (
    <div className="cfm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) done(false) }}>
      <div className="cfm-box">
        <div className="cfm-msg">{ask.msg}</div>
        {ask.input && (
          <input className="cfm-input" autoFocus value={val} placeholder={ask.input.placeholder ?? ''}
            onChange={e => setVal(e.target.value)} />
        )}
        <div className="cfm-btns">
          <button className="cfm-cancel" onClick={() => done(false)}>Отмена</button>
          <button className={ask.danger ? 'cfm-ok danger' : 'cfm-ok'} autoFocus={!ask.input}
            disabled={!!ask.input && !val.trim()} onClick={() => done(true)}>{ask.okText}</button>
        </div>
      </div>
    </div>
  )
}
