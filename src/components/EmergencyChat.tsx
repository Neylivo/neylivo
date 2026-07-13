import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import {
  ecToken, ecUsername, ecLogout, ecRegister, ecLogin, ecFetchMessages, ecSendMessage, ecConnect, type EcMessage,
} from '../lib/emergencyChat'

// v1.275.0: полноэкранный аварийный чат — открывается из баннера «Нет связи»
// (App.tsx), когда основной Supabase недоступен долго. Свои отдельные
// аккаунты, один общий чат на всех, без серверов/каналов/друзей — честно
// маленькая «запасная комната», а не полноценный Ponoi.
export function EmergencyChat({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState(() => ecUsername())
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [nameIn, setNameIn] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<EcMessage[]>([])
  const [text, setText] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!username) return
    let alive = true
    ecFetchMessages().then(m => { if (alive) setMessages(m) }).catch(e => { if (alive) setLoadErr(e.message ?? String(e)) })
    const stop = ecConnect(m => setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]))
    return () => { alive = false; stop() }
  }, [username])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const u = mode === 'register' ? await ecRegister(nameIn.trim(), pass) : await ecLogin(nameIn.trim(), pass)
      setUsername(u)
    } catch (e: any) { setErr(e.message ?? String(e)) }
    finally { setBusy(false) }
  }

  async function send() {
    const t = text.trim()
    if (!t) return
    setText('')
    try { await ecSendMessage(t) } catch (e: any) { setErr(e.message ?? String(e)) }
  }

  return (
    <div className="ec-overlay">
      <div className="ec-card">
        <div className="ec-head">
          <span>🚨 Аварийный чат</span>
          <button className="ec-x" title="Закрыть" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="ec-warn">
          Отдельный сервис, не связан с твоим основным аккаунтом Ponoi — свои логин/пароль, только один общий чат.
          Работает, пока основной сервер не поднимется обратно.
        </div>
        {!username ? (
          <form className="ec-auth" onSubmit={submitAuth}>
            <div className="ec-tabs">
              <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Регистрация</button>
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Вход</button>
            </div>
            <input className="modal-in" placeholder="Имя пользователя" value={nameIn} onChange={e => setNameIn(e.target.value)} autoFocus />
            <input className="modal-in" placeholder="Пароль" type="password" value={pass} onChange={e => setPass(e.target.value)} />
            {err && <div className="ec-err">{err}</div>}
            <button className="modal-primary" disabled={busy || !nameIn.trim() || pass.length < 6} type="submit">
              {busy ? 'Секунду…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
            </button>
          </form>
        ) : (
          <>
            <div className="ec-msgs">
              {loadErr && <div className="ec-err">{loadErr}</div>}
              {messages.map(m => (
                <div key={m.id} className="ec-msg"><b>{m.username}</b><span>{m.content}</span></div>
              ))}
              <div ref={bottomRef} />
            </div>
            {err && <div className="ec-err">{err}</div>}
            <div className="ec-composer">
              <input className="modal-in" placeholder="Написать в аварийный чат…" value={text}
                onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} />
              <button className="modal-primary" onClick={send} disabled={!text.trim()}>Отправить</button>
            </div>
            <button className="ec-logout" onClick={() => { ecLogout(); setUsername(null); setMessages([]) }}>Выйти из аварийного чата</button>
          </>
        )}
      </div>
    </div>
  )
}
