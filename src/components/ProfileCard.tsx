import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status, usePresence } from '../lib/presence'
import { fetchProfile, saveProfile, DEFAULT_PROFILE, type ProfilePrefs, type Integration } from '../lib/profilePrefs'
import { weekStats, type GameStat } from '../lib/activity'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from './icons'

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

type Tab = 'board' | 'activity' | 'wishlist'

// Карточка профиля 1-в-1 как в эталоне (v1.14.0): открывается по «Редактировать
// профиль». Слева — баннер, аватар, имя, местоимения, бейджи, «В числе участников с»,
// интеграции и приватная заметка; справа — вкладки «Доска / Активность / Вишлист».
export function ProfileCard({ userId, name, avatarUrl, status, onClose }:
  { userId: string; name: string; avatarUrl?: string | null; status: Status; onClose: () => void }) {
  const { user } = useAuth()
  const { gameOf } = usePresence()
  const isMe = user?.id === userId
  const [pp, setPp] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const [tab, setTab] = useState<Tab>('board')
  const [stats, setStats] = useState<GameStat[] | null>(null)
  const [pron, setPron] = useState('')
  const [pronEdit, setPronEdit] = useState(false)
  const [ints, setInts] = useState<Integration[]>([])
  const [note, setNote] = useState(() => localStorage.getItem('ponoi_note_' + userId) ?? '')
  const [wish, setWish] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ponoi_wish_' + userId) || '[]') } catch { return [] } })
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ponoi_favs_' + userId) || '[]') } catch { return [] } })
  const curGame = gameOf(userId)

  useEffect(() => {
    let ok = true
    fetchProfile(userId).then(p => {
      if (!ok) return
      setPp(p)
      setPron(p.pronouns || localStorage.getItem('ponoi_pron_' + userId) || '')
      setInts(p.integrations.length ? p.integrations : (() => { try { return JSON.parse(localStorage.getItem('ponoi_ints_' + userId) || '[]') } catch { return [] } })())
    })
    return () => { ok = false }
  }, [userId])
  useEffect(() => { let ok = true; weekStats(userId).then(s => { if (ok) setStats(s) }); return () => { ok = false } }, [userId])
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
  function addInt() {
    const label = window.prompt('Название интеграции (например, TikTok или Twitch):')?.trim()
    if (!label) return
    const url = window.prompt('Ссылка на профиль:')?.trim()
    if (!url) return
    const next = [...ints, { label, url }]
    setInts(next)
    localStorage.setItem('ponoi_ints_' + userId, JSON.stringify(next))
    if (isMe) saveProfile(userId, { integrations: next })
  }
  function rmInt(i: number) {
    const next = ints.filter((_, k) => k !== i)
    setInts(next)
    localStorage.setItem('ponoi_ints_' + userId, JSON.stringify(next))
    if (isMe) saveProfile(userId, { integrations: next })
  }
  function keepNote(v: string) {
    setNote(v)
    if (v) localStorage.setItem('ponoi_note_' + userId, v); else localStorage.removeItem('ponoi_note_' + userId)
  }
  function saveWish(next: string[]) { setWish(next); localStorage.setItem('ponoi_wish_' + userId, JSON.stringify(next)) }
  function saveFavs(next: string[]) { setFavs(next); localStorage.setItem('ponoi_favs_' + userId, JSON.stringify(next)) }
  function addFav(single: boolean) {
    const g = window.prompt(single ? 'Любимая игра:' : 'Добавить игру в любимые:')?.trim()
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
          <div className="pc-avwrap">
            <div className="pc-av"><Avatar name={name} url={avatarUrl} size={124} /></div>
            <span className="pc-av-status"><StatusDot status={status} size={20} /></span>
          </div>
          <div className="pc-body">
            <div className="pc-name">{name}</div>
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
              <span className="pc-tag"><Icon name="gamepad" size={11} /> PNOI <Icon name="chevron-down" size={11} /></span>
            </div>
            <div className="pc-badges">
              <span className="pc-badge" title="Ранний житель Ponoi">🌱</span>
              <span className="pc-badge" title="Меломан">🎵</span>
              <span className="pc-badge" title="Геймер">🎮</span>
            </div>
            <div className="pc-btnrow">
              <button className="pc-more" title="Копировать ID пользователя" onClick={() => navigator.clipboard?.writeText(userId)}>⋯</button>
            </div>
            {pp.about && <div className="pc-about">{pp.about}</div>}
            <div className="pc-sec">
              <div className="pc-sech">В числе участников с</div>
              <div className="pc-since">{fmtDate(memberSince)}</div>
            </div>
            <div className="pc-sec">
              <div className="pc-sech">Интеграции</div>
              {ints.map((it, i) => (
                <div key={i} className="pc-int">
                  <span className="pc-int-ic">{it.label.slice(0, 2).toUpperCase()}</span>
                  <b>{it.label}</b>
                  <button className="pc-int-open" title="Открыть" onClick={() => window.open(it.url, '_blank')}>↗</button>
                  {isMe && <button className="pc-int-open" title="Убрать" onClick={() => rmInt(i)}><Icon name="close" size={13} /></button>}
                </div>
              ))}
              {isMe && <button className="pc-int-add" onClick={addInt}><Icon name="plus" size={14} /> Добавить интеграцию</button>}
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
            {tab === 'activity' && (
              stats === null ? <div className="pc-empty2">Загрузка…</div>
              : stats.length === 0 ? <div className="pc-empty2"><Icon name="gamepad" size={24} /> За последнюю неделю игр не замечено</div>
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
            {tab === 'wishlist' && <>
              {wish.length === 0 && <div className="pc-empty2">Вишлист пуст</div>}
              {wish.map((w, i) => (
                <div key={i} className="pc-wish"><Icon name="gamepad" size={16} /> {w}
                  {isMe && <button title="Убрать" onClick={() => saveWish(wish.filter((_, k) => k !== i))}><Icon name="close" size={13} /></button>}
                </div>
              ))}
              {isMe && <button className="pc-int-add" onClick={() => { const g = window.prompt('Игра, в которую хочешь поиграть:')?.trim(); if (g) saveWish([...wish, g]) }}><Icon name="plus" size={14} /> Добавить игру</button>}
            </>}
          </div>
        </div>
      </div>
    </div>
  )
}
