
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { resolveCover } from './gameCovers'
import { startSession, endSession } from './activity'
import { useAuth } from '../auth/AuthProvider'
import { DEVICE } from './mobile'

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
export interface Game { name: string; since: number; cover?: string | null; mode?: string | null }   // mode — режим/плейс (v1.89.0, пока только Roblox)
interface PresenceState { username: string; status: Status; avatar_url?: string | null; activity?: Activity | null; listening?: Listening | null; game?: Game | null; device?: 'mobile' | 'desktop' }
interface PresenceCtx {
  online: Record<string, PresenceState>   // user_id -> state
  myStatus: Status
  statusOf: (userId: string) => Status
  activityOf: (userId: string) => Activity | null
  setMyListening: (l: Listening | null) => void
  gameOf: (userId: string) => Game | null
  deviceOf: (userId: string) => 'mobile' | 'desktop'
}
const Ctx = createContext<PresenceCtx>({ online: {}, myStatus: 'online', statusOf: () => 'offline', activityOf: () => null, setMyListening: () => {}, gameOf: () => null, deviceOf: () => 'desktop' })

export function PresenceProvider({ username, avatarUrl, children }:
  { username: string; avatarUrl?: string | null; children: ReactNode }) {
  const { user } = useAuth()
  const [online, setOnline] = useState<Record<string, PresenceState>>({})
  // Статус вручную не выбирается: в приложении — «В сети», вышел из приложения — «Не в сети».
  // Ручная активность тоже удалена: активность только автоматическая (игра/музыка).
  const myStatus: Status = 'online'
  const chanRef = useRef<any>(null)
  const [myListening, setMyListeningState] = useState<Listening | null>(null)
  const lisRef = useRef<Listening | null>(null)
  const [myGame, setMyGame] = useState<Game | null>(null)
  const gameRef = useRef<Game | null>(null)
  const sessRef = useRef<string | null>(null)   // id открытой игровой сессии в activity_sessions
  const propRef = useRef({ username, avatarUrl })

  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('presence:global', { config: { presence: { key: user.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, any[]>
      const map: Record<string, PresenceState> = {}
      for (const key of Object.keys(state)) {
        // v1.67.0: у человека может быть несколько сессий сразу (десктоп + браузер +
        // телефон). Раньше брали первую попавшуюся — и игра с десктопа терялась для
        // всех, если первой лежала сессия браузера. Теперь склеиваем лучшее из всех:
        // игра/музыка/активность берутся из той сессии, где они есть.
        const metas = state[key]
        const base = metas[0]
        map[key] = {
          username: base.username,
          status: metas.find(m => m.status === 'online')?.status ?? base.status,
          avatar_url: metas.find(m => m.avatar_url)?.avatar_url ?? null,
          activity: metas.find(m => m.activity)?.activity ?? null,
          listening: metas.find(m => m.listening)?.listening ?? null,
          game: metas.find(m => m.game)?.game ?? null,
          device: metas.some(m => (m.device ?? 'desktop') === 'desktop') ? 'desktop' : 'mobile',
        }
      }
      setOnline(map)
    })
    ch.subscribe(async (st) => {
      if (st === 'SUBSCRIBED') await ch.track({ username, status: 'online', avatar_url: avatarUrl ?? null, listening: lisRef.current, game: gameRef.current, device: DEVICE })
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

  // Гигиена истории (v1.27.0): при входе закрываем свои «зависшие» игровые сессии
  // без ended_at (приложение убили во время игры) — иначе они бесконечно «тикают»
  // в статистике и выглядят как фейковая активность.
  useEffect(() => {
    if (!user) return
    supabase.from('activity_sessions').update({ ended_at: new Date().toISOString() })
      .eq('user_id', user.id).is('ended_at', null).then(() => {})
  }, [user?.id])

  useEffect(() => { propRef.current = { username, avatarUrl } }, [username, avatarUrl])

  // Авто-детект игры (только в десктоп-приложении): Electron раз в 20 сек смотрит
  // процессы и присылает событие ТОЛЬКО при старте/выходе из игры. Сервер — «записная
  // книжка»: хранит имя игры и момент старта; тикает таймер у каждого зрителя локально.
  useEffect(() => {
    const d = (window as any).ponoiDesktop
    if (!d?.onGame) return
    d.onGame(async (g: Game | null) => {
      const pub = (val: Game | null) => {
        gameRef.current = val
        setMyGame(val)
        chanRef.current?.track({ username: propRef.current.username, status: 'online', avatar_url: propRef.current.avatarUrl ?? null, listening: lisRef.current, game: val, device: DEVICE })
      }
      if ((g?.name ?? null) === (gameRef.current?.name ?? null)) {
        // v1.89.0: та же игра, но сменился режим (плейс Roblox) — обновляем на лету,
        // не перезапуская игровую сессию и не трогая обложку.
        if (g && gameRef.current && (g.mode ?? null) !== (gameRef.current.mode ?? null)) pub({ ...gameRef.current, mode: g.mode ?? null })
        return
      }
      // История активностей (миграция 14): закрываем прошлую сессию, начинаем новую.
      if (sessRef.current) { endSession(sessRef.current); sessRef.current = null }
      if (g && user) startSession(user.id, g.name, g.since).then(id => { sessRef.current = id })
      if (!g) { pub(null); return }
      pub({ ...g, cover: null })                 // мгновенно: у друзей серый геймпад-заглушка
      const cover = await resolveCover(g.name)   // кэш в базе -> фоновый поиск Steam -> кэш
      if (cover && gameRef.current?.name === g.name) pub({ ...gameRef.current!, cover })   // hot swap на обложку (mode сохраняем)
    })
    // Приложение закрывают во время игры — честно фиксируем конец сессии.
    window.addEventListener('beforeunload', () => { if (sessRef.current) endSession(sessRef.current) })
    // eslint-disable-next-line
  }, [])

  function setMyListening(l: Listening | null) {
    if (!l && !lisRef.current) return   // нечего сбрасывать — не дёргаем канал
    lisRef.current = l
    setMyListeningState(l)
    chanRef.current?.track({ username, status: 'online', avatar_url: avatarUrl ?? null, listening: l, game: gameRef.current, device: DEVICE })
  }

  // Живая строка активности: авто-«Слушает…» из Ponoi Music важнее ручной.
  // since подобран так, что бегущее время = позиция трека.
  function activityOf(userId: string): Activity | null {
    // Приоритет как в Discord: игра > музыка > ручная активность.
    const g = userId === user?.id ? myGame : online[userId]?.game
    if (g) return { text: '🎮 Играет в ' + g.name + (g.mode ? ': ' + g.mode : ''), since: g.since }
    const l = userId === user?.id ? myListening : online[userId]?.listening
    if (l) {
      const text = '🎵 Слушает: ' + l.title + (l.author ? ' — ' + l.author : '') + (l.source ? ' · ' + l.source : '')
      return { text, since: l.at - Math.floor(l.pos * 1000) }
    }
    return null   // ручная активность удалена — только авто (игра/музыка)
  }

  function gameOf(userId: string): Game | null {
    if (userId === user?.id) return myGame
    return online[userId]?.game ?? null
  }

  function statusOf(userId: string): Status {
    if (userId === user?.id) return myStatus
    return online[userId]?.status ?? 'offline'
  }

  // Тип устройства (v1.34.0): сидит с телефона — рядом с аватаркой значок телефона, как в Discord.
  function deviceOf(userId: string): 'mobile' | 'desktop' {
    if (userId === user?.id) return DEVICE
    return online[userId]?.device ?? 'desktop'
  }

  return <Ctx.Provider value={{ online, myStatus, statusOf, activityOf, setMyListening, gameOf, deviceOf }}>{children}</Ctx.Provider>
}

export const usePresence = () => useContext(Ctx)
