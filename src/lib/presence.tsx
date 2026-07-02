
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../auth/AuthProvider'

export type Status = 'online' | 'idle' | 'dnd' | 'offline'
export const STATUS_LABEL: Record<Status, string> = {
  online: 'В сети', idle: 'Нет на месте', dnd: 'Не беспокоить', offline: 'Не в сети',
}
export const STATUS_COLOR: Record<Status, string> = {
  online: '#3ba55d', idle: '#faa61a', dnd: '#ed4245', offline: '#80848e',
}

interface PresenceState { username: string; status: Status; avatar_url?: string | null }
interface PresenceCtx {
  online: Record<string, PresenceState>   // user_id -> state
  myStatus: Status
  setMyStatus: (s: Status) => void
  statusOf: (userId: string) => Status
}
const Ctx = createContext<PresenceCtx>({ online: {}, myStatus: 'online', setMyStatus: () => {}, statusOf: () => 'offline' })

export function PresenceProvider({ username, avatarUrl, children }:
  { username: string; avatarUrl?: string | null; children: ReactNode }) {
  const { user } = useAuth()
  const [online, setOnline] = useState<Record<string, PresenceState>>({})
  const [myStatus, setMyStatusState] = useState<Status>(() => (localStorage.getItem('ponoi_status') as Status) || 'online')
  const chanRef = useRef<any>(null)

  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('presence:global', { config: { presence: { key: user.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, any[]>
      const map: Record<string, PresenceState> = {}
      for (const key of Object.keys(state)) {
        const meta = state[key][0]
        map[key] = { username: meta.username, status: meta.status, avatar_url: meta.avatar_url }
      }
      setOnline(map)
    })
    ch.subscribe(async (st) => {
      if (st === 'SUBSCRIBED') await ch.track({ username, status: myStatus, avatar_url: avatarUrl ?? null })
    })
    chanRef.current = ch
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [user, username, avatarUrl])

  function setMyStatus(s: Status) {
    setMyStatusState(s)
    localStorage.setItem('ponoi_status', s)
    chanRef.current?.track({ username, status: s, avatar_url: avatarUrl ?? null })
  }

  function statusOf(userId: string): Status {
    if (userId === user?.id) return myStatus
    return online[userId]?.status ?? 'offline'
  }

  return <Ctx.Provider value={{ online, myStatus, setMyStatus, statusOf }}>{children}</Ctx.Provider>
}

export const usePresence = () => useContext(Ctx)
