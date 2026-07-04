
import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo } from '../lib/storage'
import { AvatarWithStatus } from './AvatarWithStatus'
import { usePresence, STATUS_LABEL } from '../lib/presence'
import { ActivityLabel } from './ActivityLabel'
import { Settings } from './Settings'
import { MiniProfile } from './MiniProfile'
import { Icon } from './icons'
import { IS_MOBILE } from '../lib/mobile'

// Нижняя панель пользователя. Статус и активность вручную больше не ставятся:
// статус автоматический (в приложении — «В сети»), активность — только авто (игра/музыка).
export function MeBar({ username, avatarUrl, onAvatar }: { username: string; avatarUrl?: string | null; onAvatar?: (url: string) => void }) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [micOff, setMicOff] = useState(false)
  const [deaf, setDeaf] = useState(false)
  // Микро-анимации (<=300мс): тряска микрофона при муте, «сжатие» наушников при дефе.
  const [micAnim, setMicAnim] = useState(false)
  const [deafAnim, setDeafAnim] = useState(false)

  // v1.43.0: в активном звонке кнопки управляют настоящим микрофоном/звуком.
  const [cst, setCst] = useState<{ mic: boolean; deaf: boolean; connected: boolean } | null>(null)
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setCst(d?.connected ? d : null) }
    window.addEventListener('ponoi-call-state', h)
    return () => window.removeEventListener('ponoi-call-state', h)
  }, [])
  const micIsOff = cst ? !cst.mic : micOff
  const deafIsOn = cst ? cst.deaf : deaf

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !user) return
    setBusy(true)
    try {
      const url = await uploadTo('avatars', user.id, f)
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)
      onAvatar?.(url)
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  const { myStatus, activityOf } = usePresence()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [miniOpen, setMiniOpen] = useState(false)   // свой мини-профиль над панелью (как в Discord)
  return (
    <div className="me">
      <span onClick={() => setMiniOpen(v => !v)} title="Мой профиль" style={{ cursor: 'pointer' }}>
        <AvatarWithStatus name={username} url={avatarUrl} size={32} status={myStatus} mobile={IS_MOBILE} />
      </span>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      <span className="me-nm" onClick={() => setMiniOpen(v => !v)} style={{ cursor: 'pointer' }} title="Мой профиль">
        {busy ? 'Загрузка…' : username}<br /><small className="mut">{(() => { const a = user ? activityOf(user.id) : null; return a ? <ActivityLabel activity={a} /> : STATUS_LABEL[myStatus] })()}</small>
      </span>
      <button className={'me-ic me-mic' + (micIsOff ? ' off' : '') + (micAnim ? ' anim-shake' : '')}
        onClick={() => { if (cst) { if (cst.mic) setMicAnim(true); window.dispatchEvent(new CustomEvent('ponoi-call-toggle', { detail: { what: 'mic' } })); return } setMicOff(m => { if (!m) setMicAnim(true); return !m }) }}
        onAnimationEnd={() => setMicAnim(false)}
        title="Микрофон">{micIsOff ? <Icon name="mic-off" size={18} /> : <Icon name="mic" size={18} />}</button>
      <button className={'me-ic me-deaf' + (deafIsOn ? ' off' : '') + (deafAnim ? ' anim-squeeze' : '')}
        onClick={() => { if (cst) { if (!cst.deaf) setDeafAnim(true); window.dispatchEvent(new CustomEvent('ponoi-call-toggle', { detail: { what: 'deaf' } })); return } setDeaf(d => { if (!d) setDeafAnim(true); return !d }) }}
        onAnimationEnd={() => setDeafAnim(false)}
        title="Звук">{deafIsOn ? <Icon name="headphones-off" size={18} /> : <Icon name="headphones" size={18} />}</button>
      <button className="me-out" onClick={() => setSettingsOpen(true)} title="Настройки пользователя"><Icon name="gear" size={18} /></button>
      {settingsOpen && <Settings username={username} avatarUrl={avatarUrl} onClose={() => setSettingsOpen(false)} />}
      {miniOpen && user && <MiniProfile
        data={{ userId: user.id, name: username, avatarUrl, status: myStatus, anchor: 'me', x: 8, y: 0 }}
        meControls onPickAvatar={() => fileRef.current?.click()}
        onClose={() => setMiniOpen(false)} />}
    </div>
  )
}
