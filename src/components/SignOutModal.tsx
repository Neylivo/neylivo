import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { supabase } from '../lib/supabase'
import { signOutAndForgetKeys } from '../lib/crypto/keys'
import { useAuth } from '../auth/AuthProvider'
import { classifyAuthError } from '../lib/authErr'

// v1.362.0: выход из аккаунта — только с паролем.
//
// «Выйти» стоит в двух местах: в мини-профиле под аватаркой и в самом низу
// настроек, оба раза сразу под другими пунктами, по которым жмут постоянно.
// Промах — и ты выброшен из аккаунта: вернуться можно, но переписка в личке
// зашифрована ключами этого устройства, и при выходе они стираются намеренно
// (иначе достались бы следующему вошедшему на этом компьютере). То есть цена
// случайного нажатия — не «войти заново», а потерянная история.
//
// Пароль проверяем настоящим входом: сам по себе он никуда не сохраняется, а
// сессия после проверки всё равно тут же закрывается.

export function SignOutModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Сеть отвалилась — пароль проверить нечем, но и запирать человека в аккаунте
  // нельзя: он уже ввёл пароль и нажал кнопку, это точно не промах.
  const [offline, setOffline] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, busy])

  async function go() {
    if (busy) return
    if (!pwd) { setErr('Введи пароль'); return }
    const email = user?.email
    if (!email) { setErr('У этого аккаунта нет почты — выход с паролем недоступен'); return }
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pwd })
      if (error) {
        // Неверный пароль и «не достучались» — разные вещи, и путать их нельзя:
        // принять первое за второе значит открыть выход вообще без пароля.
        // Само правило — в lib/authErr.ts, оно проверяется отдельно.
        if (classifyAuthError(error.message) === 'network') {
          setOffline(true)
          setErr('Не удалось проверить пароль — нет связи с сервером')
        } else {
          setErr('Неверный пароль')
        }
        setBusy(false)
        return
      }
      await signOutAndForgetKeys()
    } catch {
      setOffline(true)
      setErr('Не удалось проверить пароль — нет связи с сервером')
      setBusy(false)
    }
  }

  /** Выход без проверки — только когда проверить нечем. */
  async function forceOut() {
    setBusy(true)
    await signOutAndForgetKeys()
  }

  return (
    <Portal>
      <div className="modal-overlay" onClick={() => { if (!busy) onClose() }}>
        <div className="modal so-modal" onClick={e => e.stopPropagation()}>
          <div className="so-ic"><Icon name="signout" size={22} /></div>
          <div className="modal-title">Выйти из аккаунта?</div>

          <div className="so-warn">
            При выходе с этого устройства стираются ключи шифрования личных
            сообщений. Переписка останется у собеседника, но здесь после входа
            прежние сообщения прочитать уже не выйдет.
          </div>

          <label className="modal-lbl">Пароль от аккаунта</label>
          <input ref={ref} className="modal-in" type="password" value={pwd} autoComplete="current-password"
            placeholder="Чтобы не выйти случайно" disabled={busy}
            onChange={e => { setPwd(e.target.value); setErr(null) }}
            onKeyDown={e => { if (e.key === 'Enter') void go() }} />

          {err && <div className="so-err">{err}</div>}

          <div className="modal-foot">
            <button className="modal-ghost" onClick={onClose} disabled={busy}>Остаться</button>
            {offline
              ? <button className="modal-primary danger" onClick={() => void forceOut()} disabled={busy}>
                  {busy ? 'Выхожу…' : 'Всё равно выйти'}
                </button>
              : <button className="modal-primary danger" onClick={() => void go()} disabled={busy || !pwd}>
                  {busy ? 'Проверяю…' : 'Выйти'}
                </button>}
          </div>
        </div>
      </div>
    </Portal>
  )
}
