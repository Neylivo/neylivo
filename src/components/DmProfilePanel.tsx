// Панель профиля собеседника справа в ЛС — 1-в-1 как в Discord: компактная
// сводка (баннер, аватар, ник, «В числе участников с», «Общие друзья»), а не
// полная карточка с вкладками — та открывается по клику на «Полный профиль».
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status } from '../lib/presence'
import { fetchProfile, cachedProfile, DEFAULT_PROFILE, nickFontOf, type ProfilePrefs } from '../lib/profilePrefs'
import { fmtDate } from './ProfileCard'
import { supabase } from '../lib/supabase'
import { mutualFriends } from '../lib/friends'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from './icons'

export function DmProfilePanel({ userId, name, avatarUrl, status, onExpand }:
  { userId: string; name: string; avatarUrl?: string | null; status: Status; onExpand: (tab?: 'friends') => void }) {
  const { user } = useAuth()
  const [pp, setPp] = useState<ProfilePrefs>(() => cachedProfile(userId) ?? DEFAULT_PROFILE)
  const [uname, setUname] = useState('')
  const [frCount, setFrCount] = useState<number | null>(null)

  useEffect(() => {
    let ok = true
    const c = cachedProfile(userId); if (c) setPp(c)
    fetchProfile(userId).then(p => { if (ok) setPp(p) })
    supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
      .then(({ data }) => { if (ok && data?.username) setUname(data.username) })
    return () => { ok = false }
  }, [userId])

  useEffect(() => {
    if (!user) { setFrCount(null); return }
    let ok = true
    mutualFriends(user.id, userId).then(f => { if (ok) setFrCount(f.length) })
    return () => { ok = false }
  }, [user?.id, userId])

  return (
    <aside className="dmp">
      <div className="dmp-banner" style={{ background: `linear-gradient(100deg, ${pp.primary}, ${pp.accent})` }} />
      <div className="dmp-avwrap">
        <span className="dmp-av"><Avatar name={name} url={avatarUrl} userId={userId} size={80} /></span>
        <span className="dmp-av-status"><StatusDot status={status} size={16} /></span>
      </div>
      <div className="dmp-body">
        <div className="dmp-name" style={{ fontFamily: nickFontOf(pp) }}>{name}</div>
        {uname && <div className="dmp-uname">{uname}</div>}
        <div className="dmp-card">
          <div className="dmp-card-t">В числе участников с</div>
          <div className="dmp-card-v">{fmtDate(pp.createdAt)}</div>
        </div>
        {!!frCount && <button type="button" className="dmp-card dmp-card-btn" onClick={() => onExpand('friends')}>
          <span className="dmp-card-v">Общие друзья — {frCount}</span>
          <Icon name="chevron-right" size={16} />
        </button>}
      </div>
      <button type="button" className="dmp-full" onClick={() => onExpand()}>Полный профиль</button>
    </aside>
  )
}
