import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../components/icons'
import authBg from '../assets/auth-bg.jpg'

// Экран входа/регистрации (v1.35.0, редизайн v1.214.0, фон обновлён v1.217.0):
// фирменный арт вместо голого Discord-клона (маскот из v1.214.0 убран — новый
// референс его больше не использует).
// v1.37.0: вход по почте ИЛИ юзернейму — если в поле нет «@», ищем почту
// по нику через RPC email_for_username (supabase/19_login_by_username.sql).
// v1.41.0: подтверждение почты — 6-значным кодом из письма (verifyOtp), а не ссылкой.
// В шаблоне письма Supabase («Confirm signup») должен стоять {{ .Token }}.
// v1.44.1: все ошибки Auth — через authErrText(): без пустых «()», с понятным
// текстом, когда письмо с кодом не удалось отправить (SMTP не настроен).

// Человеческий текст для ошибок Supabase Auth. Главное — не показывать пустоту:
// если письмо с кодом не ушло (SMTP не настроен / лимит), говорим это прямо.
function authErrText(e: any): string {
  const raw = String(e?.message ?? e ?? '').trim()
  const low = raw.toLowerCase()
  // v1.272.0: 522/523/524 (Cloudflare не достучался до сервера Supabase — база
  // временно недоступна/перегружена) раньше попадали в самый общий фолбэк ниже —
  // тот же текст, что и у любой другой непонятной ошибки. Отдельная, честная
  // формулировка: дело не в логине/пароле, дело в бэкенде, и когда именно
  // отпустит — не от пользователя зависит.
  const status = e?.status ?? e?.context?.status
  if (status === 522 || status === 523 || status === 524 || /\b52[234]\b/.test(raw) ||
      low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed') ||
      (low.includes('unexpected token') && low.includes('<')))
    return 'Сервер Ponoi сейчас недоступен (перегрузка/сбой базы данных). Это не связано с твоим аккаунтом — подожди немного и попробуй снова.'
  if (low.includes('error sending') || low.includes('confirmation email') || low.includes('smtp') ||
      low.includes('rate limit') || low.includes('over_email_send_rate'))
    return 'Не удалось отправить письмо с кодом — почтовый сервис Ponoi сейчас не настроен или исчерпал лимит. Сообщи владельцу, он подтвердит аккаунт вручную.'
  if (!raw || raw === '()' || raw === '{}' || low === 'error' || low === '[object object]')
    return 'Что-то пошло не так при обращении к серверу. Попробуй ещё раз через минуту.'
  if (low.includes('invalid login credentials')) return 'Неверная почта/юзернейм или пароль'
  if (low.includes('password should be at least')) return 'Пароль слишком короткий — минимум 6 символов'
  if (low.includes('unable to validate email') || low.includes('invalid email')) return 'Похоже, в почте опечатка — проверь адрес'
  return raw
}

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
        const finalName = username.trim()
        // v1.253.0: юзернейм обязателен по-настоящему — раньше при пустом поле
        // (HTML required можно обойти программной отправкой формы) тихо
        // подставлялось начало почты до «@», и пользователь получал юзернейм,
        // который сам не выбирал и не видел.
        if (!finalName) throw new Error('Придумай юзернейм')
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
          // v1.253.0: юзернейм при регистрации становится ещё и ником (display_name) —
          // раньше ник оставался пустым до первого визита в настройки, и «Вы» на
          // сервере/в чате видели просто юзернейм без отдельного отображаемого имени.
          await supabase.from('profiles').upsert({ id: data.user.id, username: finalName, display_name: finalName })
        }
        // v1.41.0: почта требует подтверждения (сессии ещё нет) — показываем экран ввода кода
        if (!data.session) { setPendingName(finalName); setVerifyEmail(email); setCode(''); setResendIn(30) }
      } else {
        const login_ = login.trim()
        if (!login_.includes('@')) {
          // Вход по юзернейму: резолвим почту и логинимся одним шагом на сервере
          // (Edge Function login-by-username) — почта никогда не попадает в браузер,
          // см. supabase/functions/login-by-username/index.ts.
          const { data, error } = await supabase.functions.invoke('login-by-username', {
            body: { username: login_, password },
          })
          if (error || !data?.access_token) {
            // supabase-js puts the Edge Function's JSON body behind error.context
            // (a Response) on non-2xx, not in `data` — read it defensively.
            let msg = String((data as any)?.error || '')
            if (!msg) { try { msg = (await (error as any)?.context?.json())?.error ?? '' } catch { /* ignore */ } }
            if (!msg) msg = String(error?.message || '')
            if (msg.toLowerCase().includes('not confirmed')) {
              throw new Error('Почта ещё не подтверждена — войди по почте (не по нику), чтобы получить новый код')
            }
            throw new Error('Неверная почта/юзернейм или пароль')
          }
          const { error: setErr } = await supabase.auth.setSession({
            access_token: data.access_token, refresh_token: data.refresh_token,
          })
          if (setErr) throw setErr
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email: login_, password })
          if (error) {
            // Почта ещё не подтверждена — сразу открываем экран ввода кода
            if (String(error.message || '').toLowerCase().includes('not confirmed')) {
              await supabase.auth.resend({ type: 'signup', email: login_ }).catch(() => {})
              setVerifyEmail(login_); setCode(''); setResendIn(30)
              throw new Error('Почта ещё не подтверждена — мы отправили новый код, введи его')
            }
            throw error
          }
        }
      }
    } catch (e: any) {
      setErr(authErrText(e))
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
        await supabase.from('profiles').upsert({ id: data.user.id, username: pendingName, display_name: pendingName })
      }
      // Дальше AuthProvider сам увидит сессию и откроет приложение
    } catch (e2: any) {
      setErr(authErrText(e2))
    } finally { setBusy(false) }
  }

  async function resend() {
    if (!verifyEmail || resendIn > 0) return
    setErr(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email: verifyEmail })
    if (error) setErr(authErrText(error))
    setResendIn(30)
  }

  // Экран «Проверь почту» — ввод 6-значного кода
  if (verifyEmail) return (
    <div className="auth2" style={{ backgroundImage: `url(${authBg})` }}>
      <form className="auth2-card" onSubmit={submitCode}>
        <h1>Проверь почту</h1>
        <p className="auth2-sub">Мы отправили 6-значный код на <b>{verifyEmail}</b></p>
        <div className="auth2-fields">
          <label className="auth2-field">
            <Icon name="mail" size={18} />
            <input className="auth2-code" inputMode="numeric" autoComplete="one-time-code" autoFocus
              placeholder="······" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
          </label>
        </div>
        {err && <div className="auth2-err">{err}</div>}
        <button className="auth2-btn" disabled={busy || code.length !== 6} type="submit">{busy ? '…' : 'Подтвердить'}</button>
        <div className="auth2-toggle" onClick={resend} style={resendIn > 0 ? { opacity: .55, cursor: 'default' } : undefined}>
          {resendIn > 0 ? `Отправить код ещё раз (через ${resendIn} с)` : 'Отправить код ещё раз'}
        </div>
        <div className="auth2-toggle" onClick={() => { setVerifyEmail(null); setMode('login'); setErr(null) }}>
          Ошибся почтой? <span>Назад</span>
        </div>
      </form>
    </div>
  )

  const reg = mode === 'register'
  return (
    <div className="auth2" style={{ backgroundImage: `url(${authBg})` }}>
      <form className="auth2-card" onSubmit={submit}>
        <h1>{reg ? 'Создать аккаунт' : 'С возвращением'}</h1>
        <p className="auth2-sub">{reg ? 'Присоединяйся к своему миру' : 'Рады видеть тебя снова'}</p>
        <div className="auth2-fields">
          {reg && (
            <label className="auth2-field">
              <Icon name="user" size={18} />
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Имя пользователя" required />
            </label>
          )}
          <label className="auth2-field">
            <Icon name="mail" size={18} />
            <input type={reg ? 'email' : 'text'} value={login} onChange={e => setLogin(e.target.value)}
              placeholder={reg ? 'Email' : 'Email или юзернейм'} required />
          </label>
          <label className="auth2-field">
            <Icon name="lock" size={18} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль" required />
          </label>
        </div>
        {err && <div className="auth2-err">{err}</div>}
        <button className="auth2-btn" disabled={busy} type="submit">{busy ? '…' : reg ? 'Зарегистрироваться' : 'Войти'}</button>
        <div className="auth2-toggle" onClick={() => setMode(reg ? 'login' : 'register')}>
          {reg ? 'Уже есть аккаунт? ' : 'Нужен аккаунт? '}<span>{reg ? 'Войти' : 'Зарегистрироваться'}</span>
        </div>
        {reg && <div className="auth2-legal">Регистрируясь, ты соглашаешься с Условиями использования и Политикой конфиденциальности Ponoi.</div>}
      </form>
    </div>
  )
}
