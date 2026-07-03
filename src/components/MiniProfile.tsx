import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { supabase } from '../lib/supabase'
import { StatusDot } from './StatusDot'
import { Status, STATUS_LABEL } from '../lib/presence'
import { tagFor } from '../lib/friendCode'
import { fetchProfile, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { ProfilePet } from './ProfilePet'
import { Icon } from './icons'

// «Был(а) в сети 5 мин назад» — относительное время последнего визита.
function lastSeenLabel(iso: string): string | null {
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff) || diff < 0) return null
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return m + ' мин назад'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' ч назад'
  const d = Math.floor(h / 24)
  if (d === 1) return 'вчера'
  if (d < 30) return d + ' дн назад'
  return 'давно'
}

export interface MiniProfileData {
  userId: string
  name: string
  avatarUrl?: string | null
  status: Status
  role?: string
  x: number
  y: number
}

export function MiniProfile({ data, onClose, onMessage }:
  { data: MiniProfileData; onClose: () => void; onMessage?: () => void }) {
  const [pp, setPp] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const [av, setAv] = useState<string | null | undefined>(data.avatarUrl)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  // Для офлайн-пользователя подтягиваем время последнего визита (если миграция 11 применена).
  useEffect(() => {
    let ok = true
    setLastSeen(null)
    if (data.status === 'offline') supabase.from('profiles').select('last_seen').eq('id', data.userId).maybeSingle()
      .then(({ data: d }: any) => { if (ok && d?.last_seen) setLastSeen(d.last_seen) })
    return () => { ok = false }
  }, [data.userId, data.status])
  useEffect(() => { let ok = true; fetchProfile(data.userId).then(p => { if (ok) setPp(p) }); return () => { ok = false } }, [data.userId])
  // Аватар: если не передали (например, клик по сообщению в ЛС) — берём из profiles.
  useEffect(() => {
    let ok = true
    setAv(data.avatarUrl)
    if (!data.avatarUrl) supabase.from('profiles').select('avatar_url').eq('id', data.userId).maybeSingle()
      .then(({ data: d }) => { if (ok && d?.avatar_url) setAv(d.avatar_url) })
    return () => { ok = false }
  }, [data.userId, data.avatarUrl])
  return (
    <>
      <div className="mini-overlay" onClick={onClose} />
      <div className="mini" style={{ left: data.x, top: data.y }} onClick={e => e.stopPropagation()}>
        <div className="mini-banner" style={{ background: `linear-gradient(90deg, ${pp.primary}, ${pp.accent})` }} />
        <ProfilePet p={pp} scale={0.3} />
        <div className="mini-av">
          <Avatar name={data.name} url={av} size={72} />
          <span className="mini-av-status"><StatusDot status={data.status} size={18} /></span>
        </div>
        <div className="mini-body">
          <div className="mini-name">{data.name}</div>
          <div className="mini-code">{data.name.toLowerCase()}{tagFor(data.userId)} <span className="mini-hash">#</span></div>
          <div className="mini-status"><StatusDot status={data.status} size={10} /> {STATUS_LABEL[data.status]}{data.status === 'offline' && lastSeen && lastSeenLabel(lastSeen) && <span className="mini-lastseen"> · был(а) в сети {lastSeenLabel(lastSeen)}</span>}</div>
          {pp.about && <div className="mini-about">{pp.about}</div>}
          <div className="mini-divider" />
          <button className="mini-copycode" onClick={() => navigator.clipboard?.writeText(data.name + '#' + tagFor(data.userId))}><Icon name="link" size={15} /> Копировать код друга</button>
          {data.role === 'owner'
            ? <div className="mini-role"><Icon name="crown" size={14} /> Владелец сервера</div>
            : data.role && <div className="mini-role mini-role-mut">Роль: {data.role}</div>}
          {onMessage && <button className="mini-msg" onClick={onMessage}>Написать сообщение</button>}
        </div>
      </div>
    </>
  )
}