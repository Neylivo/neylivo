
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { resolveCover } from './gameCovers'
import { startSession, endSession } from './activity'
import { saveMatch } from './gameMatches'
import { useAuth } from '../auth/AuthProvider'
import { DEVICE } from './mobile'
import { toast } from './toast'
import { openThread } from './friends'

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
// mode — режим/плейс (v1.89.0, пока только Roblox); placeId/jobId — числовой id
// плейса и guid конкретного сервера Roblox (v1.184.0, «Поделиться игрой» —
// нужны для join-диплинка, см. src/lib/gameShare.ts).
export interface Game { name: string; since: number; cover?: string | null; mode?: string | null; placeId?: string | null; jobId?: string | null }
interface PresenceState { username: string; status: Status; avatar_url?: string | null; activity?: Activity | null; listening?: Listening | null; game?: Game | null; device?: 'mobile' | 'desktop' }
interface PresenceCtx {
  online: Record<string, PresenceState>   // user_id -> state
  myStatus: Status
  statusOf: (userId: string) => Status
  activityOf: (userId: string) => Activity | null
  setMyListening: (l: Listening | null) => void
  gameOf: (userId: string) => Game | null
  listeningOf: (userId: string) => Listening | null
  deviceOf: (userId: string) => 'mobile' | 'desktop'
}
const Ctx = createContext<PresenceCtx>({ online: {}, myStatus: 'online', statusOf: () => 'offline', activityOf: () => null, setMyListening: () => {}, gameOf: () => null, listeningOf: () => null, deviceOf: () => 'desktop' })

export function PresenceProvider({ username, avatarUrl, children }:
  { username: string; avatarUrl?: string | null; children: ReactNode }) {
  const { user } = useAuth()
  const [online, setOnline] = useState<Record<string, PresenceState>>({})
  const onlineRef = useRef<Record<string, PresenceState>>({})
  useEffect(() => { onlineRef.current = online }, [online])
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])
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
  // v1.283.0: раньше закрывало ЛЮБУЮ открытую сессию без разбора — если игра в
  // этот момент реально шла на ДРУГОМ твоём устройстве (десктоп играет, а ты
  // зашёл в веб/на телефоне), эта живая сессия обрывалась чужим монтированием
  // PresenceProvider, хотя игра продолжалась (presence на десктопе об этом не
  // узнавал — рассинхрон между тем, что видно у друзей, и тем, что реально в
  // базе). Трогаем только по-настоящему зависшие — старше 8 часов, тот же
  // потолок длительности сессии, что уже используется в подсчёте статистики
  // (weekStats/recentActivity в activity.ts) — короче реальная игра столько не
  // длится непрерывно, а зависшая запись от убитого процесса — как раз то, что нужно почистить.
  useEffect(() => {
    if (!user) return
    const cutoff = new Date(Date.now() - 8 * 3600000).toISOString()
    supabase.from('activity_sessions').update({ ended_at: cutoff })
      .eq('user_id', user.id).is('ended_at', null).lt('started_at', cutoff).then(() => {})
  }, [user?.id])

  useEffect(() => { propRef.current = { username, avatarUrl } }, [username, avatarUrl])

  // v1.98.0: плашка «друг начал играть в ту же игру» — как оверлей Discord.
  // Следим за сменой игр у друзей: друг только что зашёл в ту игру, в которой сейчас
  // сидим мы, — десктоп показывает пилюлю поверх игры (окно-оверлей), веб — тост.
  const friendIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!user) return
    supabase.from('friend_requests').select('from_user, to_user').eq('status', 'accepted')
      .or('from_user.eq.' + user.id + ',to_user.eq.' + user.id)
      .then(({ data }) => {
        friendIdsRef.current = new Set(((data ?? []) as any[]).map(r => (r.from_user === user.id ? r.to_user : r.from_user)))
      })
    // eslint-disable-next-line
  }, [user?.id])
  const prevGamesRef = useRef<Record<string, string | null>>({})
  const gameToastAtRef = useRef<Record<string, number>>({})
  useEffect(() => {
    const my = gameRef.current?.name ?? null
    const prev = prevGamesRef.current
    const next: Record<string, string | null> = {}
    for (const uid of Object.keys(online)) {
      const gname = online[uid]?.game?.name ?? null
      next[uid] = gname
      if (!my || !user || uid === user.id) continue
      if (!friendIdsRef.current.has(uid)) continue
      if (!gname || gname !== my || prev[uid] === gname) continue   // триггер только на СТАРТ той же игры
      const key = uid + '|' + gname
      if (Date.now() - (gameToastAtRef.current[key] ?? 0) < 10 * 60_000) continue   // не чаще раза в 10 минут на друга+игру
      gameToastAtRef.current[key] = Date.now()
      const st = online[uid]
      const d = (window as any).ponoiDesktop
      if (d?.gameToast) d.gameToast({ name: st.username, avatar: st.avatar_url ?? null, game: gname, cover: gameRef.current?.cover ?? null })
      else toast('Пользователь ' + st.username + ' начал играть в ' + gname)
    }
    prevGamesRef.current = next
    // eslint-disable-next-line
  }, [online, myGame])

  // v1.99.0: стартовый оверлей при входе в игру — «Пригласите друзей поиграть» (как у Discord).
  // Собираем друзей + их наигранное время в этой игре (за 90 дней) и отдаём main-процессу,
  // который рисует панель поверх игры. v1.101.0: показываем до 5 друзей, отсортированных
  // по свежести общения в ЛС (с кем переписывался позже всех — тот первый).
  async function overlayForGame(gname: string, cover: string | null) {
    const d = (window as any).ponoiDesktop
    const u = userRef.current
    if (!d?.gameOverlay || !u) return
    try {
      const { data: fr } = await supabase.from('friend_requests').select('from_user, to_user')
        .eq('status', 'accepted').or('from_user.eq.' + u.id + ',to_user.eq.' + u.id)
      const ids = [...new Set(((fr ?? []) as any[]).map(r => (r.from_user === u.id ? r.to_user : r.from_user)))].slice(0, 50)
      if (!ids.length) return
      const from90 = new Date(Date.now() - 90 * 86400000).toISOString()
      const [profsQ, sessQ, thrQ] = await Promise.all([
        supabase.from('profiles').select('*').in('id', ids),
        supabase.from('activity_sessions').select('user_id, started_at, ended_at')
          .eq('name', gname).in('user_id', ids).gte('started_at', from90).limit(1000),
        supabase.from('dm_threads').select('id, user_a, user_b')
          .or('user_a.eq.' + u.id + ',user_b.eq.' + u.id),
      ])
      // Свежесть общения: время последнего сообщения в ЛС с каждым другом.
      const thrOf: Record<string, string> = {}
      for (const t of ((thrQ.data ?? []) as any[])) thrOf[t.id] = t.user_a === u.id ? t.user_b : t.user_a
      const lastComm: Record<string, number> = {}
      const tids = Object.keys(thrOf)
      if (tids.length) {
        const { data: lm } = await supabase.from('dm_messages').select('thread_id, created_at')
          .in('thread_id', tids).order('created_at', { ascending: false }).limit(400)
        for (const mm of ((lm ?? []) as any[])) {
          const fid = thrOf[mm.thread_id]
          if (fid && !(fid in lastComm)) lastComm[fid] = new Date(mm.created_at).getTime()
        }
      }
      const total: Record<string, number> = {}
      for (const r of ((sessQ.data ?? []) as any[])) {
        const s = new Date(r.started_at).getTime()
        const e = r.ended_at ? new Date(r.ended_at).getTime() : Date.now()
        total[r.user_id] = (total[r.user_id] ?? 0) + Math.min(Math.max(0, e - s), 8 * 3600000)
      }
      const list = ids.map(id => {
        const p = ((profsQ.data ?? []) as any[]).find(x => x.id === id)
        if (!p) return null
        const st = onlineRef.current[id]
        return { id, name: (p.display_name || p.username) as string,
          avatar: (st?.avatar_url ?? p.avatar_url ?? null) as string | null,
          online: !!st, inGame: st?.game?.name === gname, ms: total[id] ?? 0, last: lastComm[id] ?? 0 }
      }).filter(Boolean) as { id: string; name: string; avatar: string | null; online: boolean; inGame: boolean; ms: number; last: number }[]
      list.sort((a, b) => (b.last - a.last) || (Number(b.inGame) - Number(a.inGame)) || (Number(b.online) - Number(a.online)) || (b.ms - a.ms))
      d.gameOverlay({ game: gname, cover, friends: list.slice(0, 5) })
    } catch {}
  }

  // Приглашение из оверлея: кнопка-стрелка у друга шлёт ему личное сообщение-приглашение.
  useEffect(() => {
    const d = (window as any).ponoiDesktop
    if (!d?.onOverlayInvite || !user) return
    d.onOverlayInvite(async (p: { id: string; game: string }) => {
      const u = userRef.current
      if (!u || !p?.id) return
      try {
        const t = await openThread(u.id, p.id)
        if (!t) return
        await supabase.from('dm_messages').insert({
          thread_id: t.id, author: u.id, author_name: propRef.current.username,
          content: '🎮 Я играю в ' + p.game + ' — заходи!',
        })
      } catch {}
    })
    // eslint-disable-next-line
  }, [user?.id])

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
        // не перезапуская игровую сессию и не трогая обложку. v1.184.0: заодно
        // тащим placeId/jobId — они меняются вместе с/чаще, чем сам режим (смена сервера).
        if (g && gameRef.current && ((g.mode ?? null) !== (gameRef.current.mode ?? null) ||
            (g.placeId ?? null) !== (gameRef.current.placeId ?? null) || (g.jobId ?? null) !== (gameRef.current.jobId ?? null)))
          pub({ ...gameRef.current, mode: g.mode ?? null, placeId: g.placeId ?? null, jobId: g.jobId ?? null })
        return
      }
      // История активностей (миграция 14): закрываем прошлую сессию, начинаем новую.
      if (sessRef.current) { endSession(sessRef.current); sessRef.current = null }
      if (g && user) startSession(user.id, g.name, g.since).then(id => { sessRef.current = id })
      if (!g) { pub(null); return }
      pub({ ...g, cover: null })                 // мгновенно: у друзей серый геймпад-заглушка
      const cover = await resolveCover(g.name)   // кэш в базе -> фоновый поиск Steam -> кэш
      if (cover && gameRef.current?.name === g.name) pub({ ...gameRef.current!, cover })   // hot swap на обложку (mode сохраняем)
      overlayForGame(g.name, cover ?? null)      // v1.99.0: стартовый оверлей «Пригласите друзей поиграть»
    })
    // Приложение закрывают во время игры — честно фиксируем конец сессии.
    window.addEventListener('beforeunload', () => { if (sessRef.current) endSession(sessRef.current) })
    // eslint-disable-next-line
  }, [])

  // v1.150.0: конец матча (CS2 через GSI) — main-процесс прислал итоговый счёт/карту/режим,
  // сохраняем в game_matches (own-only RLS, см. миграцию 32) для статистики за 30 дней.
  useEffect(() => {
    const d = (window as any).ponoiDesktop
    if (!d?.onMatchEnd) return
    d.onMatchEnd((m: { game: string; mode?: string | null; map?: string | null; score?: string | null; result?: 'win' | 'loss' | 'draw' | null; kills?: number | null; deaths?: number | null; assists?: number | null; mvps?: number | null }) => {
      const u = userRef.current
      if (!u) return
      saveMatch(u.id, m).catch(() => {})
    })
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

  // v1.106.0: доступ к «Слушает…» напрямую — мини-профиль показывает все активности («Ещё»).
  function listeningOf(userId: string): Listening | null {
    if (userId === user?.id) return myListening
    return online[userId]?.listening ?? null
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

  return <Ctx.Provider value={{ online, myStatus, statusOf, activityOf, setMyListening, gameOf, listeningOf, deviceOf }}>{children}</Ctx.Provider>
}

export const usePresence = () => useContext(Ctx)
