import { useState } from 'react'
import { supabase } from '../lib/supabase'
import authBg from '../assets/auth-bg.png'

// Экран входа/регистрации 1-в-1 как в Discord (v1.35.0):
// тёмная карточка, КАПС-подписи полей, кнопка «Продолжить», фон — арт.
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

  const reg = mode === 'register'
  return (
    <div className="auth" style={{ backgroundImage: `url(${authBg})` }}>
      <form className="auth-card" onSubmit={submit}>
        <h1>{reg ? 'Создать учетную запись' : 'С возвращением!'}</h1>
        {!reg && <p className="auth-sub">Мы так рады видеть вас снова!</p>}
        <div className="auth-fields">
          <label className="auth-lb">Электронная почта <i>*</i>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>
          {reg && (
            <label className="auth-lb">Имя пользователя <i>*</i>
              <input value={username} onChange={e => setUsername(e.target.value)} required />
            </label>
          )}
          <label className="auth-lb">Пароль <i>*</i>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </label>
        </div>
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy} type="submit">{busy ? '…' : reg ? 'Продолжить' : 'Вход'}</button>
        <div className="auth-toggle" onClick={() => setMode(reg ? 'login' : 'register')}>
          {reg ? 'Уже зарегистрированы?' : <><span className="auth-mut">Нужна учетная запись? </span>Зарегистрироваться</>}
        </div>
        {reg && <div className="auth-legal">Регистрируясь, вы соглашаетесь с Условиями использования и Политикой конфиденциальности Ponoi.</div>}
      </form>
    </div>
  )
}
