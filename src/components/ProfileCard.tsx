

import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status, usePresence } from '../lib/presence'
import { fetchProfile, saveProfile, cachedProfile, DEFAULT_PROFILE, nickFontOf, type ProfilePrefs } from '../lib/profilePrefs'
import { ProfilePet } from './ProfilePet'
import { recentActivity, popularGames, type RecentGame } from '../lib/activity'
import { resolveCover } from '../lib/gameCovers'
import { ClockElapsed } from './ActivityLabel'
import { mutualFriends } from '../lib/friends'
import { mutualServers } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from './icons'
import { gameIconOf } from '../lib/gameIcon'
import { promptUi } from '../lib/confirm'
import type { Profile, Server } from '../types'

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h > 0 ? h + ' ч ' + m + ' мин' : m + ' мин'
}
const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' г.'
}
// «6 д. назад» / «1 нед. назад» — как в списке недавней активности Discord.
function agoLabel(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000)
  if (d <= 0) return 'сегодня'
  if (d === 1) return 'вчера'
  if (d < 7) return d + ' д. назад'
  return Math.floor(d / 7) + ' нед. назад'
}

export type ProfileTab = 'board' | 'activity' | 'wishlist' | 'servers' | 'friends'

// Единый профиль (v1.27.0): большой профиль и «Редактировать профиль» — один и
// тот же экран. «Редактировать профиль» открывает вкладку «Доска», клик по
// нику/аватарке — вкладку «Активность» (1-в-1 как в Discord). Слева — баннер,
// аватар, имя, местоимения, «В числе участников с» и приватная заметка; справа —
// вкладки. Чужой профиль дополнительно получает «Общие сервера» и «Общие друзья».
export function ProfileCard({ userId, name, avatarUrl, status, onClose, initialTab = 'board' }:
  { userId: string; name: string; avatarUrl?: string | null; status: Status; onClose: () => void; initialTab?: ProfileTab }) {
  const { user } = useAuth()
  const { gameOf } = usePresence()
  const isMe = user?.id === userId
  const [pp, setPp] = useState<ProfilePrefs>(() => cachedProfile(userId) ?? DEFAULT_PROFILE)   // v1.142.0: сразу из кэша, без мелькания
  const [tab, setTab] = useState<ProfileTab>(initialTab)
  const [pron, setPron] = useState('')
  const [pronEdit, setPronEdit] = useState(false)
  const [note, setNote] = useState(() => localStorage.getItem('ponoi_note_' + userId) ?? '')
  const [wish, setWish] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ponoi_wish_' + userId) || '[]') } catch { return [] } })
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ponoi_favs_' + userId) || '[]') } catch { return [] } })
  // Живая «Текущая активность»: только когда игра реально запущена (presence), никакого фейка.
  const curGame = gameOf(userId)
  const [recent, setRecent] = useState<RecentGame[] | null>(null)
  const [popular, setPopular] = useState<Set<string>>(new Set())
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const [srvs, setSrvs] = useState<Server[] | null>(null)
  const [frs, setFrs] = useState<Profile[] | null>(null)

  useEffect(() => {
    let ok = true
    const c = cachedProfile(userId); if (c) setPp(c)   // v1.142.0: сразу из кэша, сеть догоняет
    fetchProfile(userId).then(p => {
      if (!ok) return
      setPp(p)
      setPron(p.pronouns || localStorage.getItem('ponoi_pron_' + userId) || '')
    })
    return () => { ok = false }
  }, [userId])
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

  // Локальное зеркало: до применения миграции 15 местоимения/интеграции живут в localStorage.
  function savePron(v: string) {
    setPron(v); setPronEdit(false)
    localStorage.setItem('ponoi_pron_' + userId, v)
    if (isMe) saveProfile(userId, { pronouns: v })
  }
  function keepNote(v: string) {
    setNote(v)
    if (v) localStorage.setItem('ponoi_note_' + userId, v); else localStorage.removeItem('ponoi_note_' + userId)
  }
  function saveWish(next: string[]) { setWish(next); localStorage.setItem('ponoi_wish_' + userId, JSON.stringify(next)) }
  function saveFavs(next: string[]) { setFavs(next); localStorage.setItem('ponoi_favs_' + userId, JSON.stringify(next)) }
  async function addFav(single: boolean) {
    const g = (await promptUi(single ? 'Любимая игра' : 'Добавить игру в любимые', { placeholder: 'Название игры', okText: 'Добавить' }))?.trim()
    if (!g) return
    saveFavs(single ? [g, ...favs.slice(1)] : [...(favs.length ? favs : ['']), g].filter(Boolean))
  }

  const memberSince = isMe ? ((user as any)?.created_at ?? pp.createdAt) : pp.createdAt

  return (
    <div className="pc-backdrop" onClick={onClose}>
      <div className="pc-card" onClick={e => e.stopPropagation()}>
        <button className="pc-x" onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="pc-left">
          <div className="pc-banner" style={{ background: `linear-gradient(100deg, ${pp.primary}, ${pp.accent})` }} />
          <ProfilePet p={pp} scale={0.6} card="big" bannerH={150} />
          <div className="pc-avwrap">
            <div className="pc-av"><Avatar name={name} url={avatarUrl} size={124} /></div>
            <span className="pc-av-status"><StatusDot status={status} size={20} /></span>
          </div>
          <div className="pc-body">
            <div className="pc-name" style={{ fontFamily: nickFontOf(pp) }}>{name}</div>
            <div className="pc-userrow">
              <span>{name.toLowerCase()}</span>
              <span className="pc-dot">•</span>
              {pronEdit
                ? <input className="pc-pron-in" autoFocus defaultValue={pron} placeholder="они/их"
                    onBlur={e => savePron(e.target.value.trim())}
                    onKeyDown={e => { if (e.key === 'Enter') savePron((e.target as HTMLInputElement).value.trim()); if (e.key === 'Escape') setPronEdit(false) }} />
                : pron
                  ? <span className="pc-pron" onClick={() => isMe && setPronEdit(true)} title={isMe ? 'Изменить местоимения' : undefined}>{pron}</span>
                  : isMe && <button className="pc-pron-add" onClick={() => setPronEdit(true)}>Добавить местоимения</button>}
            </div>
            {pp.about && <div className="pc-about">{pp.about}</div>}
            <div className="pc-sec">
              <div className="pc-sech">В числе участников с</div>
              <div className="pc-since">{fmtDate(memberSince)}</div>
            </div>
            {isMe && <div className="pc-sec">
              <div className="pc-sech">Заметка (видна только вам)</div>
              <textarea className="pc-note" placeholder="Нажмите, чтобы добавить заметку" value={note} onChange={e => keepNote(e.target.value)} />
            </div>}
          </div>
        </div>
        <div className="pc-right">
          <div className="pc-tabs">
            <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>Доска</button>
            <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Активность</button>
            <button className={tab === 'wishlist' ? 'on' : ''} onClick={() => setTab('wishlist')}>Вишлист</button>
            {!isMe && <button className={tab === 'servers' ? 'on' : ''} onClick={() => setTab('servers')}>Общие сервера{srvs ? ' — ' + srvs.length : ''}</button>}
            {!isMe && <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>Общие друзья{frs ? ' — ' + frs.length : ''}</button>}
          </div>
          <div className="pc-rbody">
            {tab === 'board' && <>
              {favs.length === 0 && !curGame && <>
                <div className="pc-board-h">Персонализируйте свой профиль с помощью виджетов</div>
                <div className="pc-board-sub">Выберите виджет из библиотеки, чтобы рассказать больше о себе и своих интересах</div>
              </>}
              <div className="pc-wgrid">
                <div className="pc-widget" onClick={() => isMe && addFav(true)} title={isMe ? 'Указать любимую игру' : undefined}>
                  <span className="pc-skel"><i /><i /></span>
                  {!favs[0] && <span className="pc-widget-plus"><Icon name="plus" size={16} /></span>}
                  <span className="pc-widget-nm">{favs[0] ? '⭐ ' + favs[0] : 'Любимая игра'}</span>
                </div>
                <div className="pc-widget" onClick={() => isMe && addFav(false)} title={isMe ? 'Добавить любимые игры' : undefined}>
                  <span className="pc-skel"><i /><i /></span>
                  {favs.length < 2 && <span className="pc-widget-plus"><Icon name="plus" size={16} /></span>}
                  <span className="pc-widget-nm">{favs.length > 1 ? '🎮 ' + favs.slice(1).join(', ') : 'Мои любимые игры'}</span>
                </div>
                <div className="pc-widget" onClick={() => setTab('activity')}>
                  <span className="pc-skel"><i /><i /></span>
                  {!curGame && <span className="pc-widget-plus"><Icon name="plus" size={16} /></span>}
                  <span className="pc-widget-nm">{curGame ? '🕹️ Сейчас: ' + curGame.name : 'Текущие игры'}</span>
                </div>
                <div className="pc-widget" onClick={() => setTab('wishlist')}>
                  <span className="pc-skel"><i /><i /></span>
                  <span className="pc-widget-plus"><Icon name="plus" size={16} /></span>
                  <span className="pc-widget-nm">Хочу поиграть</span>
                </div>
              </div>
            </>}
            {tab === 'activity' && <>
              {curGame && <>
                <div className="fp-sect">Текущая активность</div>
                <div className="act-card fp-cur">
                  <div className="act-head"><span className="mpg-kind"><Icon name={gameIconOf(curGame.name)} size={14} /></span>Играет в</div>{/* v1.139.0: значок по жанру игры */}
                  <div className="act-row">
                    {(curGame.cover ?? covers[curGame.name])
                      ? <img className="act-cover act-cover-lg" src={(curGame.cover ?? covers[curGame.name])!} alt="" />
                      : <span className="act-cover act-cover-lg act-cover-ph"><Icon name="gamepad" size={30} /></span>}
                    <div className="act-info">
                      <div className="act-name act-name-lg">{curGame.name}</div>
                      {curGame.mode && <div className="act-mode">{curGame.mode}</div>}{/* v1.89.0: режим (плейс Roblox) */}
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
              {isMe && <div className="fp-note">Здесь появится ваша активность за последние 30 дней.</div>}
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
            {tab === 'wishlist' && <>
              {wish.length === 0 && <div className="pc-empty2">Вишлист пуст</div>}
              {wish.map((w, i) => (
                <div key={i} className="pc-wish"><Icon name="gamepad" size={16} /> {w}
                  {isMe && <button title="Убрать" onClick={() => saveWish(wish.filter((_, k) => k !== i))}><Icon name="close" size={13} /></button>}
                </div>
              ))}
              {isMe && <button className="pc-int-add" onClick={async () => { const g = (await promptUi('Игра, в которую хочешь поиграть', { placeholder: 'Название игры', okText: 'Добавить' }))?.trim(); if (g) saveWish([...wish, g]) }}><Icon name="plus" size={14} /> Добавить игру</button>}
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
      </div>
    </div>
  )
}
