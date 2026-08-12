import { useEffect, useState, useRef } from 'react'
import { signupAllowed, solvePow, loadTries, noteTry } from '../lib/signupGuard'
import { humanText } from '../lib/humanFail'
import { supabase } from '../lib/supabase'
import { Icon } from '../components/icons'
import authBg from '../assets/auth-bg.jpg'
import { QrLoginPanel } from './QrLoginPanel'
import { MIN_PASSWORD, паролеваяБеда, паролеваяПодсказка } from '../lib/passwordRule'

// Экран входа/регистрации (v1.35.0, редизайн v1.214.0, фон обновлён v1.217.0):
// фирменный арт вместо голого Discord-клона (маскот из v1.214.0 убран — новый
// референс его больше не использует).
// v1.37.0: вход по почте ИЛИ юзернейму — если в поле нет «@», ищем почту
// по нику через Edge Function (RPC email_for_username отозвана в миграции 54 —
// она отдавала почту по нику кому угодно, включая невошедших).
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
  // v1.557.0: порог задан у нас (lib/passwordRule.ts) и проверяется ДО отправки.
  // Эта строка осталась страховкой: в проекте порог может быть строже нашего.
  if (low.includes('password should be at least')) return `Пароль слишком короткий — нужно не меньше ${MIN_PASSWORD} символов`
  if (low.includes('unable to validate email') || low.includes('invalid email')) return 'Похоже, в почте опечатка — проверь адрес'
  return raw
}

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [qr, setQr] = useState(false)
  const [login, setLogin] = useState('')       // почта или юзернейм (вход); почта (регистрация)
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pow, setPow] = useState(false)           // v1.537.0: идёт подбор
  const [honeypot, setHoneypot] = useState('')    // поле-ловушка, человеку не видно
  const openedAt = useRef(Date.now())             // когда открыли форму
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

  /**
   * v1.306.0: регистрация без почты.
   *
   * Используется настоящий анонимный вход Supabase, а не подставной адрес: в
   * auth.users не остаётся ни почты, ни телефона — только случайный
   * идентификатор. Серверу о человеке неизвестно ничего, кроме выбранного ника.
   *
   * Цена честно написана рядом с кнопкой: восстанавливать такой аккаунт нечем.
   */
  async function anonSignUp() {
    setErr(null)
    const finalName = username.trim()
    if (finalName.length < 3) { setErr('Придумай юзернейм — от 3 символов'); return }
    setBusy(true)
    try {
      const { data: taken } = await supabase.rpc('username_taken', { uname: finalName })
      if (taken) { setErr(`Юзернейм «${finalName}» уже занят`); return }
      const { data, error } = await supabase.auth.signInAnonymously()
      if (error) {
        // Самая вероятная причина — анонимный вход не разрешён в настройках
        // проекта. Пишем это прямо, иначе человек будет гадать над «Failed».
        setErr('Вход без почты недоступен: администратору нужно включить анонимный вход в настройках Supabase (Authentication → Providers → Anonymous)')
        return
      }
      if (!data.user) { setErr('Не удалось создать аккаунт — попробуй ещё раз'); return }
      localStorage.setItem('ponoi_username', finalName)
      await supabase.from('profiles').upsert({ id: data.user.id, username: finalName, display_name: finalName })
    } catch (e: any) {
      setErr(humanText(e))
    } finally { setBusy(false) }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      if (mode === 'register') {
        const email = login.trim()
        const finalName = username.trim()
        // v1.537.0: защита от ботов — ловушка, время заполнения и лимит попыток
        // с устройства. Подробности и почему не капча — в lib/signupGuard.ts.
        const вердикт = signupAllowed({ opened: openedAt.current, honeypot, history: loadTries() })
        if (!вердикт.ok) throw new Error(вердикт.text)
        // v1.557.0 (находка F8): пароль проверяется ДО того, как что-либо
        // уйдёт на сервер. Проверка только при регистрации: на входе поднимать
        // порог нельзя — у людей уже есть пароли по старому правилу, и они
        // просто перестали бы входить.
        const беда = паролеваяБеда(password, [email, finalName])
        if (беда) throw new Error(беда)
        // Работа доказательством: человеку это секунда ожидания один раз, а тому,
        // кто заводит тысячу аккаунтов, — тысяча секунд процессорного времени.
        setPow(true)
        try { await solvePow(email + '|' + Math.floor(Date.now() / 60000)) }
        finally { setPow(false) }
        noteTry()
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
      // v1.366.0: вошли — достаём ключ личных сообщений из копии, запертой этим
      // же паролем. Без этого человек после каждого перезахода видел «Сообщение
      // зашифровано для другого устройства» вместо собственной переписки.
      await afterLoginKeys(password)
    } catch (e: any) {
      setErr(authErrText(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Ключ после входа: сначала пробуем достать копию, и только если её нет —
   * заводим новый ключ и кладём копию под тем же паролем.
   *
   * Пароль виден только здесь и только сейчас: дальше по приложению он не
   * передаётся и никуда не сохраняется.
   *
   * Ошибки тут не должны мешать войти: не достучались, не применена миграция —
   * человек всё равно в приложении, просто прежняя переписка пока не читается.
   * Пугать его этим на экране входа незачем.
   */
  async function afterLoginKeys(pwd: string) {
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id
      if (!uid || !pwd) return
      // Подгружаем на месте, а не сверху файла: экран входа грузится первым, и
      // затащить в него всё шифрование значило бы сделать запуск тяжелее ради
      // кода, который нужен ровно один раз — уже после успешного входа.
      const { restoreMyKey, backupMyKey } = await import('../lib/crypto/keys')
      const res = await restoreMyKey(uid, pwd)
      if (res === 'restored') return
      // Копии нет — первый вход с новым порядком: заводим ключ и кладём копию.
      // Пароль сменили — старая копия больше не открывается, перезаписываем её
      // текущим ключом, иначе она осталась бы мёртвым грузом навсегда.
      if (res === 'none' || res === 'wrong-password') await backupMyKey(uid, pwd)
    } catch { /* вход важнее ключей: молчим и пускаем */ }
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
  // v1.542.0: вход по коду с телефона. Отдельным экраном, а не полем в форме:
  // это другой способ входа целиком, и мешать его с паролем — значит показывать
  // человеку две задачи разом.
  if (qr) return (
    <div className="auth2" style={{ backgroundImage: `url(${authBg})` }}>
      <div className="auth2-card"><QrLoginPanel onClose={() => setQr(false)} /></div>
    </div>
  )

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
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль"
              autoComplete={reg ? 'new-password' : 'current-password'}
              minLength={reg ? MIN_PASSWORD : undefined} required />
          </label>
        </div>
        {/* v1.557.0 (находка F8): порог виден ДО отправки, а не приходит
            ошибкой сервера после. Только при регистрации: на входе человек
            вводит уже существующий пароль, и подсказка про длину там была бы
            упрёком за то, чего он изменить не может. */}
        {reg && паролеваяПодсказка(password) && (
          <div className="auth2-legal" style={{ marginTop: -4 }}>{паролеваяПодсказка(password)}</div>
        )}
        {/* v1.537.0: поле-ловушка. Человеку его не видно и не доступно с
            клавиатуры, а простой бот заполняет всё подряд — и попадается. */}
        {reg && <input className="auth2-hp" type="text" tabIndex={-1} autoComplete="off"
          aria-hidden="true" value={honeypot} onChange={e => setHoneypot(e.target.value)} />}
        {err && <div className="auth2-err">{err}</div>}
        <button className="auth2-btn" disabled={busy} type="submit">
          {pow ? 'Проверяем, что ты человек…' : busy ? '…' : reg ? 'Зарегистрироваться' : 'Войти'}
        </button>
        <div className="auth2-toggle" onClick={() => setMode(reg ? 'login' : 'register')}>
          {reg ? 'Уже есть аккаунт? ' : 'Нужен аккаунт? '}<span>{reg ? 'Войти' : 'Зарегистрироваться'}</span>
        </div>
        {!reg && <>
          <div className="auth2-or">или</div>
          <button type="button" className="auth2-btn ghost" onClick={() => setQr(true)}>
            <Icon name="camera" size={17} /> Войти по коду с телефона
          </button>
        </>}
        {/* v1.306.0: вход без почты. Аккаунт создаётся настоящим анонимным
            пользователем — подставного адреса не заводится, серверу неизвестно
            вообще ничего, кроме выбранного ника. */}
        {reg && <>
          <div className="auth2-or">или</div>
          <button type="button" className="auth2-btn ghost" disabled={busy} onClick={anonSignUp}>
            {busy ? '…' : 'Войти без почты'}
          </button>
          <div className="auth2-legal">
            Почта не понадобится, и восстановить такой аккаунт будет нечем: он живёт
            только на этом устройстве. Потеряешь доступ — потеряешь и переписку.
            Почту можно привязать позже в настройках, тогда появится и восстановление.
          </div>
        </>}
        {reg && <div className="auth2-legal">Регистрируясь, ты соглашаешься с Условиями использования и Политикой конфиденциальности Ponoi.</div>}
      </form>
    </div>
  )
}
