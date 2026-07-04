
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { supabase } from '../lib/supabase'
import { StatusDot } from './StatusDot'
import { Status, STATUS_LABEL, usePresence, type Activity } from '../lib/presence'
import { ActivityLabel, Elapsed } from './ActivityLabel'
import { fetchProfile, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { ProfilePet } from './ProfilePet'
import { useAuth } from '../auth/AuthProvider'
import { sendRequest, openThread } from '../lib/friends'
import { toastOk, toastErr } from '../lib/toast'
import { Settings } from './Settings'
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
  x: number
  y: number
}

export function MiniProfile({ data, onClose, onMessage }:
  { data: MiniProfileData; onClose: () => void; onMessage?: () => void }) {
  const { user } = useAuth()
  const isMe = user?.id === data.userId
  const [pp, setPp] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const { gameOf, myActivity, setMyActivity } = usePresence()
  const game = gameOf(data.userId)   // живая карточка «Играет в …» с обложкой
  const [av, setAv] = useState<string | null | undefined>(data.avatarUrl)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [edit, setEdit] = useState(false)
  const [msg, setMsg] = useState('')
  const [meName, setMeName] = useState('')
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
  // Мой ник — для заявок в друзья и отправки сообщений из мини-профиля.
  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
      .then(({ data: d }) => setMeName(d?.username ?? ''))
  }, [user?.id])
  // Общие друзья: пересечение принятых заявок у меня и у него.
  useEffect(() => {
    if (!user || isMe) { setMutuals([]); return }
    let ok = true
    ;(async () => {
      const q = (uid: string) => supabase.from('friend_requests').select('from_user, to_user')
        .eq('status', 'accepted').or('from_user.eq.' + uid + ',to_user.eq.' + uid)
      const [a, b] = await Promise.all([q(user.id), q(data.userId)])
      const others = (rows: any[] | null, uid: string) =>
        new Set((rows ?? []).map(r => r.from_user === uid ? r.to_user : r.from_user))
      const mine = others(a.data, user.id)
      const theirs = others(b.data, data.userId)
      const common = [...mine].filter(x => theirs.has(x) && x !== user.id && x !== data.userId)
      if (!common.length) { if (ok) setMutuals([]); return }
      const { data: profs } = await supabase.from('profiles').select('id, username, avatar_url').in('id', common.slice(0, 12))
      if (ok) setMutuals((profs ?? []) as any)
    })()
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

  // Пузырёк статуса у своей аватарки: клик — задать/убрать свой статус.
  function editStatus() {
    const t = prompt('Свой статус (пусто — убрать)', myActivity?.text ?? '')
    if (t === null) return
    const v = t.trim()
    setMyActivity(v ? { text: v, since: Date.now() } : null)
  }

  return (
    <>
      <div className="mini-overlay" onClick={onClose} />
      <div className="mini mini2" style={{ left: data.x, top: data.y }} onClick={e => e.stopPropagation()}>
        <div className="mini-banner" style={{ background: `linear-gradient(90deg, ${pp.primary}, ${pp.accent})` }} />
        {!isMe && <div className="mini-topbtns">
          <button title="Добавить в друзья" onClick={addFriend}><Icon name="users" size={16} /></button>
          <button title="Ещё" onClick={() => setMore(m => !m)}><Icon name="more" size={16} /></button>
          {more && <div className="mini-more">
            <button onClick={() => { navigator.clipboard?.writeText(data.name); setMore(false) }}>Скопировать юзернейм</button>
            <button onClick={() => { navigator.clipboard?.writeText(data.userId); setMore(false) }}>Скопировать ID</button>
          </div>}
        </div>}
        <ProfilePet p={pp} scale={0.3} />
        <div className="mini-avrow">
          <div className="mini-av">
            <Avatar name={data.name} url={av} size={80} />
            <span className="mini-av-status"><StatusDot status={data.status} size={18} /></span>
          </div>
          {isMe && <button className="mini-addstatus" title="Установить свой статус" onClick={editStatus}>
            {myActivity?.text ? <span className="mini-addstatus-tx">{myActivity.text}</span> : <Icon name="plus" size={15} />}
          </button>}
        </div>
        <div className="mini-body">
          <div className="mini-name">{data.name}</div>
          <div className="mini-code">{data.name.toLowerCase()} <span className="mini-hash">#</span></div>
          <div className="mini-status"><StatusDot status={data.status} size={10} /> {STATUS_LABEL[data.status]}{data.status === 'offline' && lastSeen && lastSeenLabel(lastSeen) && <span className="mini-lastseen"> · был(а) в сети {lastSeenLabel(lastSeen)}</span>}</div>
          {game && <div className="mini-game">
            {game.cover
              ? <img className="mini-game-cover" src={game.cover} alt="" />
              : <span className="mini-game-ph" title="Обложка ищется…"><Icon name="gamepad" size={22} /></span>}
            <div className="mini-game-info">
              <div className="mini-game-t">Играет в {game.name}</div>
              <small className="mut"><Elapsed since={game.since} /></small>
            </div>
          </div>}
          {data.activity && !game && <div className="mini-activity"><Icon name="gamepad" size={14} /> <ActivityLabel activity={data.activity} /></div>}
          {pp.about && <div className="mini-about">{pp.about}</div>}
          {data.roleName && <div className="mini-rolechip"><span className="role-dot" style={{ background: data.roleColor }} />{data.roleName}</div>}
          {data.role === 'owner'
            ? <div className="mini-role"><Icon name="crown" size={14} /> Владелец сервера</div>
            : data.role && !data.roleName && <div className="mini-role mini-role-mut">Роль: {data.role}</div>}
          {!isMe && mutuals.length > 0 && <div className="mini-mutuals">
            <span className="mini-mutual-avs">{mutuals.slice(0, 3).map(m => <span key={m.id} className="mini-mutual-av"><Avatar name={m.username} url={m.avatar_url} size={20} /></span>)}</span>
            {mutualLabel(mutuals.length)}
          </div>}
          {isMe
            ? <button className="mini-editbtn" onClick={() => setEdit(true)}><Icon name="edit" size={15} /> Редактировать профиль</button>
            : <div className="mini-msgbox">
                <input placeholder={'Сообщение для @' + data.name} value={msg}
                  onChange={e => setMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendDm(); if (e.key === 'Escape') onClose() }} />
                <span className="mini-msgbox-smile"><Icon name="smile" size={18} /></span>
              </div>}
        </div>
      </div>
      {edit && <Settings username={data.name} avatarUrl={av} onClose={() => setEdit(false)} />}
    </>
  )
}
