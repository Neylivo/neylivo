import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.user) {
          await supabase.from('profiles').upsert({ id: data.user.id, username: username || email.split('@')[0] })
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e: any) {
      setErr(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Ponoi</h1>
        <p className="auth-sub">{mode === 'login' ? 'С возвращением!' : 'Создай аккаунт'}</p>
        {mode === 'register' && (
          <input placeholder="Имя пользователя" value={username} onChange={e => setUsername(e.target.value)} />
        )}
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Пароль" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <div className="auth-err">{err}</div>}
        <button disabled={busy} type="submit">{busy ? '…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        <div className="auth-toggle" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Нужен аккаунт? Регистрация' : 'Уже есть аккаунт? Войти'}
        </div>
      </form>
    </div>
  )
}
