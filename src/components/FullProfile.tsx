
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status, STATUS_LABEL, usePresence } from '../lib/presence'
import { fetchProfile, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { recentActivity, popularGames, type RecentGame } from '../lib/activity'
import { resolveCover } from '../lib/gameCovers'
import { ClockElapsed } from './ActivityLabel'
import { mutualFriends } from '../lib/friends'
import { mutualServers } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from './icons'
import { ProfileCard } from './ProfileCard'
import type { Profile, Server } from '../types'

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h > 0 ? h + ' ч ' + m + ' мин' : m + ' мин'
}

type Tab = 'activity' | 'servers' | 'friends'

// «6 д. назад» / «1 нед. назад» — как в списке недавней активности Discord.
function agoLabel(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000)
  if (d <= 0) return 'сегодня'
  if (d === 1) return 'вчера'
  if (d < 7) return d + ' д. назад'
  return Math.floor(d / 7) + ' нед. назад'
}

// Фулл-профиль: большое модальное окно по центру (открывается кликом по
// аватарке/нику внутри мини-профиля). Свой — только «История активностей»;
// чужой — плюс «Общие сервера» (клик — переход на сервер) и «Общие друзья».
export function FullProfile({ userId, name, avatarUrl, status, onClose }:
  { userId: string; name: string; avatarUrl?: string | null; status: Status; onClose: () => void }) {
  const { user } = useAuth()
  const isMe = user?.id === userId
  const [tab, setTab] = useState<Tab>('activity')
  const [pp, setPp] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const [recent, setRecent] = useState<RecentGame[] | null>(null)
  const [popular, setPopular] = useState<Set<string>>(new Set())
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const { gameOf } = usePresence()
  const curGame = gameOf(userId)   // живая карточка «Текущая активность»
  const [srvs, setSrvs] = useState<Server[] | null>(null)
  const [frs, setFrs] = useState<Profile[] | null>(null)
  const [editCard, setEditCard] = useState(false)

  useEffect(() => { let ok = true; fetchProfile(userId).then(p => { if (ok) setPp(p) }); return () => { ok = false } }, [userId])
  // «Недавняя активность» за 30 дней + метки «Популярное» + обложки из общего кэша.
  useEffect(() => {
    let ok = true
    recentActivity(userId).then(ra => {
      if (!ok) return
      setRecent(ra)
      const names = ra.map(r => r.name)
      if (curGame && !names.includes(curGame.name)) names.push(curGame.name)
      popularGames(names).then(p => { if (ok) setPopular(p) })
      for (const n of names) resolveCover(n).then(u => { if (ok) setCovers(c => ({ ...c, [n]: u })) })
    })
    return () => { ok = false }
  }, [userId])
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
            {isMe && <button className="fp-editbtn" onClick={() => setEditCard(true)}><Icon name="edit" size={14} /> Редактировать профиль</button>}
          </div>
        </div>
        {pp.about && <div className="fp-about">{pp.about}</div>}
        <div className="fp-tabs">
          <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Активность</button>
          {!isMe && <button className={tab === 'servers' ? 'on' : ''} onClick={() => setTab('servers')}>Общие сервера{srvs ? ' — ' + srvs.length : ''}</button>}
          {!isMe && <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>Общие друзья{frs ? ' — ' + frs.length : ''}</button>}
        </div>
        <div className="fp-content">
          {tab === 'activity' && <>
            {curGame && <>
              <div className="fp-sect">Текущая активность</div>
              <div className="act-card fp-cur">
                <div className="act-head">Играет в</div>
                <div className="act-row">
                  {(curGame.cover ?? covers[curGame.name])
                    ? <img className="act-cover act-cover-lg" src={(curGame.cover ?? covers[curGame.name])!} alt="" />
                    : <span className="act-cover act-cover-lg act-cover-ph"><Icon name="gamepad" size={30} /></span>}
                  <div className="act-info">
                    <div className="act-name act-name-lg">{curGame.name}</div>
                    <div className="act-meta">
                      <span className="act-time"><Icon name="gamepad" size={13} /> <ClockElapsed since={curGame.since} /></span>
                      {(recent?.find(r => r.name === curGame.name)?.streak ?? 1) > 1 && <span><Icon name="zap" size={13} /> x{recent!.find(r => r.name === curGame.name)!.streak} д. подряд</span>}
                      {popular.has(curGame.name) && <span><Icon name="flame" size={13} /> Популярное</span>}
                    </div>
                  </div>
                </div>
              </div>
            </>}
            <div className="fp-sect">Недавняя активность</div>
            {isMe && <div className="fp-note">Здесь появится ваша активность за последние 30 дней. <span className="fp-link">Подробнее</span></div>}
            {recent === null ? <div className="fp-empty">Загрузка…</div>
            : recent.length === 0 ? <div className="fp-empty"><Icon name="gamepad" size={26} /> За последние 30 дней игр не замечено.{isMe ? ' Запусти игру — и она появится здесь.' : ''}</div>
            : recent.map(g => (
              <div key={g.name} className="fp-recent" title={'Всего за 30 дней: ' + fmtMs(g.totalMs) + ' · сессий: ' + g.sessions}>
                {covers[g.name]
                  ? <img className="act-cover act-cover-sm" src={covers[g.name]!} alt="" />
                  : <span className="act-cover act-cover-sm act-cover-ph"><Icon name="gamepad" size={22} /></span>}
                <div className="act-info">
                  <div className="act-name">{g.name}</div>
                  <div className="act-meta">
                    <span><Icon name="gamepad" size={13} /> {agoLabel(g.last)}</span>
                    {popular.has(g.name) && <span><Icon name="flame" size={13} /> Популярное</span>}
                  </div>
                  {(g.isNew || g.gapDays >= 60 || g.longestMs >= 3 * 3600000) && <div className="act-meta">
                    {g.gapDays >= 60 && <span><Icon name="rotate" size={13} /> Снова в деле спустя {Math.floor(g.gapDays / 30)} мес. отсутствия</span>}
                    {g.isNew && <span><Icon name="user" size={13} /> Новый игрок</span>}
                    {g.longestMs >= 3 * 3600000 && <span><Icon name="flame" size={13} /> Марафон в {Math.floor(g.longestMs / 3600000)} ч.</span>}
                  </div>}
                </div>
              </div>
            ))}
          </>}
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
      {editCard && <ProfileCard userId={userId} name={name} avatarUrl={avatarUrl} status={status} onClose={() => setEditCard(false)} />}
    </div>
  )
}
