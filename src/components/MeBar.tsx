import { toastErr } from '../lib/toast'
import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo } from '../lib/storage'
import { AvatarWithStatus } from './AvatarWithStatus'
import { usePresence, STATUS_LABEL, Status } from '../lib/presence'
import { Settings } from './Settings'
import { Icon } from './icons'

export function MeBar({ username, avatarUrl, onAvatar }: { username: string; avatarUrl?: string | null; onAvatar?: (url: string) => void }) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [micOff, setMicOff] = useState(false)
  const [deaf, setDeaf] = useState(false)

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

  const { myStatus, setMyStatus } = usePresence()
  const [menu, setMenu] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const STATUSES: Status[] = ['online', 'idle', 'dnd', 'offline']
  return (
    <div className="me">
      <span onClick={() => fileRef.current?.click()} title="Сменить аватар" style={{ cursor: 'pointer' }}>
        <AvatarWithStatus name={username} url={avatarUrl} size={32} status={myStatus} />
      </span>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      <span className="me-nm" onClick={() => setMenu(m => !m)} style={{ cursor: 'pointer' }} title="Статус">
        {busy ? 'Загрузка…' : username}<br /><small className="mut">{STATUS_LABEL[myStatus]}</small>
      </span>
      {menu && (
        <div className="status-menu" onMouseLeave={() => setMenu(false)}>
          {STATUSES.map(s => (
            <div key={s} className="status-opt" onClick={() => { setMyStatus(s); setMenu(false) }}>
              <span className="status-dot" style={{ background: ({online:'#3ba55d',idle:'#faa61a',dnd:'#ed4245',offline:'#80848e'})[s] }} />
              {STATUS_LABEL[s]}
            </div>
          ))}
        </div>
      )}
      <button className={'me-ic' + (micOff ? ' off' : '')} onClick={() => setMicOff(m => !m)} title="Микрофон">{micOff ? <Icon name="mic-off" size={18} /> : <Icon name="mic" size={18} />}</button>
      <button className={'me-ic' + (deaf ? ' off' : '')} onClick={() => setDeaf(d => !d)} title="Звук">{deaf ? <Icon name="headphones-off" size={18} /> : <Icon name="headphones" size={18} />}</button>
      <button className="me-out" onClick={() => setSettingsOpen(true)} title="Настройки пользователя"><Icon name="gear" size={18} /></button>
      <button className="me-out" onClick={() => supabase.auth.signOut()} title="Выйти"><Icon name="signout" size={18} /></button>
      {settingsOpen && <Settings username={username} avatarUrl={avatarUrl} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
