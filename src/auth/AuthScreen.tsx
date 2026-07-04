import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import authBg from '../assets/auth-bg.png'

// Экран входа/регистрации 1-в-1 как в Discord (v1.35.0):
// тёмная карточка, КАПС-подписи полей, кнопка «Продолжить», фон — арт.
// v1.37.0: вход по почте ИЛИ юзернейму — если в поле нет «@», ищем почту
// по нику через RPC email_for_username (supabase/19_login_by_username.sql).
// v1.41.0: подтверждение почты — 6-значным кодом из письма (verifyOtp), а не ссылкой.
// В шаблоне письма Supabase («Confirm signup») должен стоять {{ .Token }}.
export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [login, setLogin] = useState('')       // почта или юзернейм (вход); почта (регистрация)
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Шаг «Введи код из письма»: на какую почту ушёл код + сам код
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)   // кулдаун повторной отправки, сек

  useEffect(() => {
    if (resendIn <= 0) return
    const t = window.setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendIn])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      if (mode === 'register') {
        const email = login.trim()
        const finalName = username.trim() || email.split('@')[0]
        // v1.38.0: ник должен быть свободен — если занят, подсказываем вариант
        const { data: taken } = await supabase.rpc('username_taken', { uname: finalName })
        if (taken) {
          let alt: string | null = null
          for (let i = 0; i < 3 && !alt; i++) {
            const cand = `${finalName}${Math.floor(Math.random() * 900) + 100}`
            const { data: t2 } = await supabase.rpc('username_taken', { uname: cand })
            if (!t2) alt = cand
          }
          throw new Error(`Юзернейм «${finalName}» уже занят${alt ? `. Свободен, например: «${alt}»` : ''}`)
        }
        // v1.38.0: 1 почта = 1 аккаунт
        const { data: emTaken } = await supabase.rpc('email_taken', { em: email })
        if (emTaken) throw new Error('На эту почту уже зарегистрирован аккаунт — войди в него')
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        // Юзернейм сразу запоминается локально: даже если запись профиля не успеет
        // пройти (подтверждение почты), «Вы» нигде не появится.
        localStorage.setItem('ponoi_username', finalName)
        if (data.user) {
          await supabase.from('profiles').upsert({ id: data.user.id, username: finalName })
        }
        // v1.41.0: почта требует подтверждения (сессии ещё нет) — показываем экран ввода кода
        if (!data.session) { setPendingName(finalName); setVerifyEmail(email); setCode(''); setResendIn(30) }
      } else {
        let email = login.trim()
        if (!email.includes('@')) {
          // Вход по юзернейму: находим почту по нику
          const { data, error } = await supabase.rpc('email_for_username', { uname: email })
          if (error) throw error
          if (!data) throw new Error('Пользователь с таким юзернеймом не найден')
          email = data as string
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          // Почта ещё не подтверждена — сразу открываем экран ввода кода
          if (String(error.message || '').toLowerCase().includes('not confirmed')) {
            await supabase.auth.resend({ type: 'signup', email }).catch(() => {})
            setVerifyEmail(email); setCode(''); setResendIn(30)
            throw new Error('Почта ещё не подтверждена — мы отправили новый код, введи его')
          }
          throw error
        }
      }
    } catch (e: any) {
      setErr(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  // v1.41.0: подтверждение 6-значным кодом из письма
  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (!verifyEmail || busy) return
    const token = code.trim()
    if (!/^\d{6}$/.test(token)) { setErr('Код — это 6 цифр из письма'); return }
    setErr(null); setBusy(true)
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: verifyEmail, token, type: 'signup' })
      if (error) {
        const m = String(error.message || '').toLowerCase()
        throw new Error(m.includes('expired') || m.includes('invalid')
          ? 'Неверный или устаревший код. Проверь цифры или запроси новый.' : (error.message ?? String(error)))
      }
      // Сессия появилась — дозаписываем профиль (upsert при регистрации мог не пройти без сессии)
      if (data.user && pendingName) {
        await supabase.from('profiles').upsert({ id: data.user.id, username: pendingName })
      }
      // Дальше AuthProvider сам увидит сессию и откроет приложение
    } catch (e2: any) {
      setErr(e2.message ?? String(e2))
    } finally { setBusy(false) }
  }

  async function resend() {
    if (!verifyEmail || resendIn > 0) return
    setErr(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email: verifyEmail })
    if (error) setErr(error.message ?? String(error))
    setResendIn(30)
  }

  // Экран «Проверь почту» — ввод 6-значного кода (как в Discord)
  if (verifyEmail) return (
    <div className="auth" style={{ backgroundImage: `url(${authBg})` }}>
      <form className="auth-card" onSubmit={submitCode}>
        <h1>Проверь почту</h1>
        <p className="auth-sub">Мы отправили 6-значный код на <b>{verifyEmail}</b></p>
        <div className="auth-fields">
          <label className="auth-lb"><span>Код подтверждения <i>*</i></span>
            <input className="auth-code" inputMode="numeric" autoComplete="one-time-code" autoFocus
              placeholder="······" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
          </label>
        </div>
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy || code.length !== 6} type="submit">{busy ? '…' : 'Подтвердить'}</button>
        <div className="auth-toggle" onClick={resend} style={resendIn > 0 ? { opacity: .55, cursor: 'default' } : undefined}>
          {resendIn > 0 ? `Отправить код ещё раз (через ${resendIn} с)` : 'Отправить код ещё раз'}
        </div>
        <div className="auth-toggle" onClick={() => { setVerifyEmail(null); setMode('login'); setErr(null) }}>
          <span className="auth-mut">Ошибся почтой? </span>Назад
        </div>
      </form>
    </div>
  )

  const reg = mode === 'register'
  return (
    <div className="auth" style={{ backgroundImage: `url(${authBg})` }}>
      <form className="auth-card" onSubmit={submit}>
        <h1>{reg ? 'Создать учетную запись' : 'С возвращением!'}</h1>
        {!reg && <p className="auth-sub">Мы так рады видеть вас снова!</p>}
        <div className="auth-fields">
          <label className="auth-lb"><span>{reg ? <>Электронная почта <i>*</i></> : <>Электронная почта или юзернейм <i>*</i></>}</span>
            <input type={reg ? 'email' : 'text'} value={login} onChange={e => setLogin(e.target.value)} required />
          </label>
          {reg && (
            <label className="auth-lb"><span>Имя пользователя <i>*</i></span>
              <input value={username} onChange={e => setUsername(e.target.value)} required />
            </label>
          )}
          <label className="auth-lb"><span>Пароль <i>*</i></span>
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
