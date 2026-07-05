
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { supabase } from '../lib/supabase'
import { StatusDot } from './StatusDot'
import { Status, usePresence, type Activity } from '../lib/presence'
import { ActivityLabel, ClockElapsed } from './ActivityLabel'
import { fetchProfile, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { ProfilePet } from './ProfilePet'
import { useAuth } from '../auth/AuthProvider'
import { sendRequest, openThread, mutualFriends } from '../lib/friends'
import { toastOk, toastErr } from '../lib/toast'
import { Settings } from './Settings'
import { ProfileCard } from './ProfileCard'
import { Icon } from './icons'
import type { Profile } from '../types'

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

// «5 общих друзей» / «2 общих друга» / «1 общий друг»
function mutualLabel(n: number): string {
  const t = n % 10, h = n % 100
  if (t === 1 && h !== 11) return n + ' общий друг'
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return n + ' общих друга'
  return n + ' общих друзей'
}

export interface MiniProfileData {
  userId: string
  name: string
  avatarUrl?: string | null
  status: Status
  role?: string
  roleName?: string
  roleColor?: string
  activity?: Activity | null
  // Якорь позиционирования: 'member-list' — прилипает слева от списка участников,
  // 'me' — вырастает снизу над панелью пользователя; иначе свободно по x/y.
  anchor?: 'member-list' | 'me'
  x: number
  y: number
}

export function MiniProfile({ data, onClose, onMessage, meControls, onPickAvatar, onAddRole }:
  { data: MiniProfileData; onClose: () => void; onMessage?: () => void; meControls?: boolean; onPickAvatar?: () => void; onAddRole?: () => void }) {
  const { user } = useAuth()
  const isMe = user?.id === data.userId
  const [pp, setPp] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const { gameOf } = usePresence()
  const game = gameOf(data.userId)   // живая карточка «Играет в …» с обложкой
  const [av, setAv] = useState<string | null | undefined>(data.avatarUrl)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [sub, setSub] = useState<'acc' | null>(null)   // подменю своего попапа (учётные записи)
  const [edit, setEdit] = useState(false)          // карточка профиля («Редактировать профиль»)
  const [accSettings, setAccSettings] = useState(false)  // настройки («Управление учётными записями»)
  const [full, setFull] = useState(false)
  const [msg, setMsg] = useState('')
  const [meName, setMeName] = useState('')
  const [uname, setUname] = useState('')   // v1.40.0: настоящий юзернейм показываемого пользователя
  const [mutuals, setMutuals] = useState<{ id: string; username: string; avatar_url: string | null }[]>([])

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
  // v1.40.0: настоящий юзернейм — под ником и в «Скопировать юзернейм»
  // (раньше показывался ник в нижнем регистре, это было неверно).
  useEffect(() => {
    let ok = true
    setUname('')
    supabase.from('profiles').select('username').eq('id', data.userId).maybeSingle()
      .then(({ data: d }) => { if (ok && d?.username) setUname(d.username) })
    return () => { ok = false }
  }, [data.userId])
  // Мой ник — для заявок в друзья и отправки сообщений из мини-профиля.
  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle()
      .then(async ({ data, error }) => {
        let d: any = data
        if (error) { const r = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle(); d = r.data }
        setMeName(d?.display_name || d?.username || '')
      })
  }, [user?.id])
  // Общие друзья (см. lib/friends.mutualFriends).
  useEffect(() => {
    if (!user || isMe) { setMutuals([]); return }
    let ok = true
    mutualFriends(user.id, data.userId).then(list => { if (ok) setMutuals(list as any) })
    return () => { ok = false }
  }, [user?.id, data.userId, isMe])

  async function addFriend() {
    if (!user) return
    const { error } = await sendRequest(user.id, meName || 'Я', { id: data.userId, username: data.name } as Profile)
    if (error) toastErr(error.message)
    else toastOk('Заявка отправлена — ' + data.name)
  }

  // Отправка сообщения прямо из мини-профиля (как в Discord).
  async function sendDm() {
    const t = msg.trim()
    if (!t || !user || isMe) return
    const th = await openThread(user.id, data.userId)
    if (!th) { toastErr('Не получилось открыть диалог'); return }
    const { error } = await supabase.from('dm_messages').insert({
      thread_id: th.id, author: user.id, author_name: meName || 'Я', content: t,
    })
    if (error) toastErr(error.message)
    else { setMsg(''); toastOk('Отправлено — ' + data.name); onMessage?.(); onClose() }
  }

  // Шаг 2 цепочки: клик по аватарке/нику в мини-профиле открывает фулл-профиль по центру.
  if (full) return <ProfileCard userId={data.userId} name={data.name} avatarUrl={av} status={data.status} initialTab="activity" onClose={onClose} />

  const posStyle: React.CSSProperties = data.anchor === 'me'
    ? { left: 8, bottom: 68 }
    : data.anchor === 'member-list'
    ? { right: 252, top: Math.max(12, Math.min(data.y - 60, window.innerHeight - 540)) }
    : { left: data.x, top: data.y }

  return (
    <>
      <div className="mini-overlay" onClick={onClose} />
      <div className={'mini mini2' + (data.anchor ? ' anchor-' + data.anchor : '')} style={posStyle} onClick={e => e.stopPropagation()}>
        <div className="mini-banner" style={{ background: `linear-gradient(90deg, ${pp.primary}, ${pp.accent})` }} />
        {!isMe && <div className="mini-topbtns">
          <button title="Добавить в друзья" onClick={addFriend}><Icon name="users" size={16} /></button>
          <button title="Ещё" onClick={() => setMore(m => !m)}><Icon name="more" size={16} /></button>
          {more && <div className="mini-more">
            <button onClick={() => { navigator.clipboard?.writeText(uname || data.name); setMore(false) }}>Скопировать юзернейм</button>
            <button onClick={() => { navigator.clipboard?.writeText(data.userId); setMore(false) }}>Скопировать ID</button>
          </div>}
        </div>}
        <ProfilePet p={pp} scale={0.3} card="mini" bannerH={74} />
        <div className="mini-avrow">
          <div className="mini-av" onClick={() => setFull(true)} title="Открыть полный профиль">
            <Avatar name={data.name} url={av} size={80} />
            <span className="mini-av-status"><StatusDot status={data.status} size={18} /></span>
          </div>
        </div>
        <div className="mini-body">
          <div className="mini-name" onClick={() => setFull(true)} title="Открыть полный профиль">{data.name}</div>
          <div className="mini-code">
            <span className="mini-uname">{uname || data.name}</span>
            {(data.roleName || data.role) && <span className="mini-rolechip"><span className="role-dot" style={{ background: data.roleColor ?? '#99aab5' }} />{data.roleName ?? 'Участник'}</span>}
          </div>
          {data.status === 'offline' && lastSeen && lastSeenLabel(lastSeen) && <div className="mini-status">был(а) в сети {lastSeenLabel(lastSeen)}</div>}
          {pp.about && <div className="mini-about">{pp.about}</div>}
          {game && <div className="mpg">{/* v1.49.0: карточка «Играет в» 1-в-1 как в Discord */}
            <div className="mpg-head"><span className="mpg-head-l"><span className="mpg-eq"><i /><i /><i /></span>Играет в</span>
              <button className="mpg-dots" title="Скопировать название игры"
                onClick={() => { navigator.clipboard?.writeText(game.name); toastOk('Название игры скопировано') }}><Icon name="more" size={16} /></button>
            </div>
            <div className="mpg-row">
              {game.cover
                ? <img className="mpg-cover" src={game.cover} alt="" />
                : <span className="mpg-cover mpg-ph"><Icon name="gamepad" size={26} /></span>}
              <div className="mpg-info">
                <div className="mpg-nm">{game.name}</div>
                {game.mode && <div className="mpg-mode">{game.mode}</div>}{/* v1.89.0: режим (плейс Roblox) */}
                <div className="mpg-time"><Icon name="gamepad" size={13} /> <ClockElapsed since={game.since} /></div>
              </div>
            </div>
            {isMe && <button className="mpg-add" onClick={() => {
              try {
                const k = 'ponoi_favs_' + data.userId
                const cur: string[] = JSON.parse(localStorage.getItem(k) || '[]')
                if (!cur.includes(game.name)) localStorage.setItem(k, JSON.stringify([...cur, game.name]))
                toastOk('Добавлено к текущим играм')
              } catch {}
            }}>Добавить к текущим играм</button>}
          </div>}
          {data.activity && !game && <div className="mini-activity"><Icon name="gamepad" size={14} /> <ActivityLabel activity={data.activity} /></div>}
          {onAddRole && <button className="mini-addrole" onClick={onAddRole}><Icon name="plus" size={13} /> Добавить роль</button>}
          {!isMe && mutuals.length > 0 && <div className="mini-mutuals">
            <span className="mini-mutual-avs">{mutuals.slice(0, 3).map(m => <span key={m.id} className="mini-mutual-av"><Avatar name={m.username} url={m.avatar_url} size={20} /></span>)}</span>
            {mutualLabel(mutuals.length)}
          </div>}
          {isMe && meControls && <>
            <div className="mini-grp">
              <button className="mini-row" onClick={() => setEdit(true)}><Icon name="edit" size={15} /> Редактировать профиль</button>
            </div>
            <div className="mini-grp">
              <button className="mini-row" onClick={() => setSub(s => s === 'acc' ? null : 'acc')}>
                <Icon name="users" size={15} /> Переключение между учётными записями
                <span className="mini-row-chev"><Icon name="chevron-down" size={14} /></span>
              </button>
              <div className="mini-rowsep" />
              <button className="mini-row" onClick={() => { navigator.clipboard?.writeText(data.userId); onClose() }}>
                <Icon name="id-card" size={15} /> Копировать ID пользователя
              </button>
            </div>
            {sub === 'acc' && <div className="mini-sub">
              <div className="mini-acc">
                <Avatar name={data.name} url={av} size={28} />
                <span>{data.name}</span>
                <span className="mini-acc-check"><Icon name="check" size={13} /></span>
              </div>
              <div className="mini-subsep" />
              <button className="mini-subrow" onClick={() => { setSub(null); setAccSettings(true) }}>Управление учётными записями</button>
              {onPickAvatar && <button className="mini-subrow" onClick={() => { setSub(null); onPickAvatar() }}>Сменить аватар</button>}
              <button className="mini-subrow" style={{ color: '#ed4245' }} onClick={() => supabase.auth.signOut()}>Выйти из аккаунта</button>
            </div>}
          </>}
          {isMe && !meControls && <button className="mini-editbtn" onClick={() => setEdit(true)}><Icon name="edit" size={15} /> Редактировать профиль</button>}
          {!isMe && <div className="mini-msgbox">
                <input placeholder={'Сообщение для @' + data.name} value={msg}
                  onChange={e => setMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendDm(); if (e.key === 'Escape') onClose() }} />
                <span className="mini-msgbox-smile"><Icon name="smile" size={18} /></span>
              </div>}
        </div>
      </div>
      {edit && <ProfileCard userId={data.userId} name={data.name} avatarUrl={av} status={data.status} initialTab="board" onClose={() => setEdit(false)} />}
      {accSettings && <Settings username={data.name} avatarUrl={av} onClose={() => setAccSettings(false)} />}
    </>
  )
}
