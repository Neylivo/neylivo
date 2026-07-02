import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo } from '../lib/storage'
import { Avatar } from './Avatar'

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

  return (
    <div className="me">
      <span onClick={() => fileRef.current?.click()} title="Сменить аватар" style={{ cursor: 'pointer' }}>
        <Avatar name={username} url={avatarUrl} size={32} />
      </span>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      <span className="me-nm">{busy ? 'Загрузка…' : username}</span>
      <button className="me-out" onClick={() => supabase.auth.signOut()} title="Выйти">⎋</button>
    </div>
  )
}
