import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo } from '../lib/storage'
import { AvatarWithStatus } from './AvatarWithStatus'
import { usePresence, STATUS_LABEL, Status } from '../lib/presence'

export function MeBar({ username, avatarUrl, onAvatar }: { username: string; avatarUrl?: string | null; onAvatar?: (url: string) => void }) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !user) return
    setBusy(true)
    try {
      const url = await uploadTo('avatars', user.id, f)
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)
      onAvatar?.(url)
    } catch (err: any) { alert(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  const { myStatus, setMyStatus } = usePresence()
  const [menu, setMenu] = useState(false)
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
      <button className="me-out" onClick={() => supabase.auth.signOut()} title="Выйти">⎋</button>
    </div>
  )
}
