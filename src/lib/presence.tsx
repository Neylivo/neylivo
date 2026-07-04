
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { resolveCover } from './gameCovers'
import { startSession, endSession } from './activity'
import { useAuth } from '../auth/AuthProvider'

export type Status = 'online' | 'idle' | 'dnd' | 'offline'
export const STATUS_LABEL: Record<Status, string> = {
  online: 'В сети', idle: 'Нет на месте', dnd: 'Не беспокоить', offline: 'Не в сети',
}
export const STATUS_COLOR: Record<Status, string> = {
  online: '#3ba55d', idle: '#faa61a', dnd: '#ed4245', offline: '#80848e',
}

// Кастомная активность («Играю в Doom»): текст + момент начала, тикает у всех в реальном времени.
export interface Activity { text: string; since: number }
// Авто-активность «Слушает…»: публикуется плеером Ponoi Music сама, как Spotify-статус в Discord.
// pos — позиция трека (сек) на момент at; зрители досчитывают тайминг локально.
export interface Listening { title: string; author?: string; source?: string; pos: number; dur?: number; at: number }
// Авто-активность «Играет в …»: десктоп присылает только старт/стоп ({ name, since }),
// тикающий таймер каждый клиент досчитывает сам из разницы часов.
export interface Game { name: string; since: number; cover?: string | null }
interface PresenceState { username: string; status: Status; avatar_url?: string | null; activity?: Activity | null; listening?: Listening | null; game?: Game | null }
interface PresenceCtx {
  online: Record<string, PresenceState>   // user_id -> state
  myStatus: Status
  setMyStatus: (s: Status) => void
  statusOf: (userId: string) => Status
  myActivity: Activity | null
  setMyActivity: (a: Activity | null) => void
  activityOf: (userId: string) => Activity | null
  setMyListening: (l: Listening | null) => void
  gameOf: (userId: string) => Game | null
}
const Ctx = createContext<PresenceCtx>({ online: {}, myStatus: 'online', setMyStatus: () => {}, statusOf: () => 'offline', myActivity: null, setMyActivity: () => {}, activityOf: () => null, setMyListening: () => {}, gameOf: () => null })

export function PresenceProvider({ username, avatarUrl, children }:
  { username: string; avatarUrl?: string | null; children: ReactNode }) {
  const { user } = useAuth()
  const [online, setOnline] = useState<Record<string, PresenceState>>({})
  const [myStatus, setMyStatusState] = useState<Status>(() => (localStorage.getItem('ponoi_status') as Status) || 'online')
  const [myActivity, setMyActivityState] = useState<Activity | null>(() => {
    try { return JSON.parse(localStorage.getItem('ponoi_activity') || 'null') } catch { return null }
  })
  const chanRef = useRef<any>(null)
  const actRef = useRef<Activity | null>(myActivity)
  const [myListening, setMyListeningState] = useState<Listening | null>(null)
  const lisRef = useRef<Listening | null>(null)
  const [myGame, setMyGame] = useState<Game | null>(null)
  const gameRef = useRef<Game | null>(null)
  const sessRef = useRef<string | null>(null)   // id открытой игровой сессии в activity_sessions
  const statRef = useRef<Status>(myStatus)
  const propRef = useRef({ username, avatarUrl })

  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('presence:global', { config: { presence: { key: user.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, any[]>
      const map: Record<string, PresenceState> = {}
      for (const key of Object.keys(state)) {
        const meta = state[key][0]
        map[key] = { username: meta.username, status: meta.status, avatar_url: meta.avatar_url, activity: meta.activity ?? null, listening: meta.listening ?? null, game: meta.game ?? null }
      }
      setOnline(map)
    })
    ch.subscribe(async (st) => {
      if (st === 'SUBSCRIBED') await ch.track({ username, status: myStatus, avatar_url: avatarUrl ?? null, activity: actRef.current, listening: lisRef.current, game: gameRef.current })
    })
    chanRef.current = ch
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [user, username, avatarUrl])

  // «Был в сети»: раз в минуту отмечаемся в profiles.last_seen.
  // Если миграция 11 ещё не применена (колонки нет) — запрос тихо вернёт ошибку, ничего не ломается.
  useEffect(() => {
    if (!user) return
    const beat = () => { supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id).then(() => {}) }
    beat()
    const t = window.setInterval(beat, 60_000)
    window.addEventListener('beforeunload', beat)
    return () => { window.clearInterval(t); window.removeEventListener('beforeunload', beat) }
  }, [user])

  useEffect(() => { propRef.current = { username, avatarUrl } }, [username, avatarUrl])

  // Авто-детект игры (только в десктоп-приложении): Electron раз в 20 сек смотрит
  // процессы и присылает событие ТОЛЬКО при старте/выходе из игры. Сервер — «записная
  // книжка»: хранит имя игры и момент старта; тикает таймер у каждого зрителя локально.
  useEffect(() => {
    const d = (window as any).ponoiDesktop
    if (!d?.onGame) return
    d.onGame(async (g: Game | null) => {
      if ((g?.name ?? null) === (gameRef.current?.name ?? null)) return
      // История активностей (миграция 14): закрываем прошлую сессию, начинаем новую.
      if (sessRef.current) { endSession(sessRef.current); sessRef.current = null }
      if (g && user) startSession(user.id, g.name, g.since).then(id => { sessRef.current = id })
      const pub = (val: Game | null) => {
        gameRef.current = val
        setMyGame(val)
        chanRef.current?.track({ username: propRef.current.username, status: statRef.current, avatar_url: propRef.current.avatarUrl ?? null, activity: actRef.current, listening: lisRef.current, game: val })
      }
      if (!g) { pub(null); return }
      pub({ ...g, cover: null })                 // мгновенно: у друзей серый геймпад-заглушка
      const cover = await resolveCover(g.name)   // кэш в базе -> фоновый поиск Steam -> кэш
      if (cover && gameRef.current?.name === g.name) pub({ ...g, cover })   // hot swap на обложку
    })
    // Приложение закрывают во время игры — честно фиксируем конец сессии.
    window.addEventListener('beforeunload', () => { if (sessRef.current) endSession(sessRef.current) })
    // eslint-disable-next-line
  }, [])

  function setMyStatus(s: Status) {
    setMyStatusState(s)
    statRef.current = s
    localStorage.setItem('ponoi_status', s)
    chanRef.current?.track({ username, status: s, avatar_url: avatarUrl ?? null, activity: actRef.current, listening: lisRef.current, game: gameRef.current })
  }

  function setMyActivity(a: Activity | null) {
    actRef.current = a
    setMyActivityState(a)
    try { a ? localStorage.setItem('ponoi_activity', JSON.stringify(a)) : localStorage.removeItem('ponoi_activity') } catch {}
    chanRef.current?.track({ username, status: myStatus, avatar_url: avatarUrl ?? null, activity: a, listening: lisRef.current, game: gameRef.current })
  }

  function setMyListening(l: Listening | null) {
    if (!l && !lisRef.current) return   // нечего сбрасывать — не дёргаем канал
    lisRef.current = l
    setMyListeningState(l)
    chanRef.current?.track({ username, status: myStatus, avatar_url: avatarUrl ?? null, activity: actRef.current, listening: l, game: gameRef.current })
  }

  // Живая строка активности: авто-«Слушает…» из Ponoi Music важнее ручной.
  // since подобран так, что бегущее время = позиция трека.
  function activityOf(userId: string): Activity | null {
    // Приоритет как в Discord: игра > музыка > ручная активность.
    const g = userId === user?.id ? myGame : online[userId]?.game
    if (g) return { text: '🎮 Играет в ' + g.name, since: g.since }
    const l = userId === user?.id ? myListening : online[userId]?.listening
    if (l) {
      const text = '🎵 Слушает: ' + l.title + (l.author ? ' — ' + l.author : '') + (l.source ? ' · ' + l.source : '')
      return { text, since: l.at - Math.floor(l.pos * 1000) }
    }
    if (userId === user?.id) return myActivity
    return online[userId]?.activity ?? null
  }

  function gameOf(userId: string): Game | null {
    if (userId === user?.id) return myGame
    return online[userId]?.game ?? null
  }

  function statusOf(userId: string): Status {
    if (userId === user?.id) return myStatus
    return online[userId]?.status ?? 'offline'
  }

  return <Ctx.Provider value={{ online, myStatus, setMyStatus, statusOf, myActivity, setMyActivity, activityOf, setMyListening, gameOf }}>{children}</Ctx.Provider>
}

export const usePresence = () => useContext(Ctx)
