
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status, STATUS_LABEL } from '../lib/presence'
import { fetchProfile, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { weekStats, type GameStat } from '../lib/activity'
import { mutualFriends } from '../lib/friends'
import { mutualServers } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from './icons'
import type { Profile, Server } from '../types'

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h > 0 ? h + ' ч ' + m + ' мин' : m + ' мин'
}

type Tab = 'activity' | 'servers' | 'friends'

// Фулл-профиль: большое модальное окно по центру (открывается кликом по
// аватарке/нику внутри мини-профиля). Свой — только «История активностей»;
// чужой — плюс «Общие сервера» (клик — переход на сервер) и «Общие друзья».
export function FullProfile({ userId, name, avatarUrl, status, onClose }:
  { userId: string; name: string; avatarUrl?: string | null; status: Status; onClose: () => void }) {
  const { user } = useAuth()
  const isMe = user?.id === userId
  const [tab, setTab] = useState<Tab>('activity')
  const [pp, setPp] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const [stats, setStats] = useState<GameStat[] | null>(null)
  const [srvs, setSrvs] = useState<Server[] | null>(null)
  const [frs, setFrs] = useState<Profile[] | null>(null)

  useEffect(() => { let ok = true; fetchProfile(userId).then(p => { if (ok) setPp(p) }); return () => { ok = false } }, [userId])
  useEffect(() => { let ok = true; weekStats(userId).then(s => { if (ok) setStats(s) }); return () => { ok = false } }, [userId])
  useEffect(() => {
    if (isMe || !user) return
    let ok = true
    mutualServers(user.id, userId).then(s => { if (ok) setSrvs(s) })
    mutualFriends(user.id, userId).then(f => { if (ok) setFrs(f) })
    return () => { ok = false }
  }, [userId, isMe, user?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fp-backdrop" onClick={onClose}>
      <div className="fp-card" onClick={e => e.stopPropagation()}>
        <div className="fp-banner" style={{ background: `linear-gradient(100deg, ${pp.primary}, ${pp.accent})` }} />
        <div className="fp-head">
          <div className="fp-av">
            <Avatar name={name} url={avatarUrl} size={110} />
            <span className="fp-av-status"><StatusDot status={status} size={22} /></span>
          </div>
          <div className="fp-id">
            <div className="fp-name">{name}</div>
            <div className="fp-user">{name.toLowerCase()} <span className="mini-hash">#</span></div>
            <div className="fp-status"><StatusDot status={status} size={10} /> {STATUS_LABEL[status]}</div>
          </div>
        </div>
        {pp.about && <div className="fp-about">{pp.about}</div>}
        <div className="fp-tabs">
          <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>История активностей</button>
          {!isMe && <button className={tab === 'servers' ? 'on' : ''} onClick={() => setTab('servers')}>Общие сервера{srvs ? ' — ' + srvs.length : ''}</button>}
          {!isMe && <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>Общие друзья{frs ? ' — ' + frs.length : ''}</button>}
        </div>
        <div className="fp-content">
          {tab === 'activity' && (
            stats === null ? <div className="fp-empty">Загрузка…</div>
            : stats.length === 0 ? <div className="fp-empty"><Icon name="gamepad" size={26} /> За последнюю неделю игр не замечено.{isMe ? ' Запусти игру — и она появится здесь.' : ''}</div>
            : stats.map(s => (
              <div key={s.name} className="fp-game">
                <span className="fp-game-ic"><Icon name="gamepad" size={20} /></span>
                <div className="fp-game-info">
                  <div className="fp-game-nm">{s.name}</div>
                  <small className="mut">{fmtMs(s.totalMs)} за неделю · сессий: {s.sessions}</small>
                </div>
              </div>
            ))
          )}
          {tab === 'servers' && !isMe && (
            srvs === null ? <div className="fp-empty">Загрузка…</div>
            : srvs.length === 0 ? <div className="fp-empty">Нет общих серверов</div>
            : <div className="fp-srvgrid">{srvs.map(s => (
                <div key={s.id} className="fp-srv" title={s.name}
                  onClick={() => { window.dispatchEvent(new CustomEvent('ponoi-open-server', { detail: s.id })); onClose() }}>
                  <span className="fp-srv-ic" style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})` } : undefined}>
                    {!s.avatar_url && s.name.slice(0, 2).toUpperCase()}</span>
                  <span className="fp-srv-nm">{s.name}</span>
                </div>
              ))}</div>
          )}
          {tab === 'friends' && !isMe && (
            frs === null ? <div className="fp-empty">Загрузка…</div>
            : frs.length === 0 ? <div className="fp-empty">Нет общих друзей</div>
            : frs.map(f => (
              <div key={f.id} className="fp-friend">
                <Avatar name={f.username} url={(f as any).avatar_url} size={32} />
                <span>{f.username}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
