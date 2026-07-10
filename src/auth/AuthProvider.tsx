import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initUserPrefs } from '../lib/userPrefs'
import { loadBlocked } from '../lib/block'

interface AuthCtx { session: Session | null; user: User | null; loading: boolean }
const Ctx = createContext<AuthCtx>({ session: null, user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Приватные настройки (папки, мьюты, заметки, ...) грузятся с аккаунта при входе.
  useEffect(() => { initUserPrefs(session?.user?.id ?? null) }, [session?.user?.id])
  // v1.187.0: список блокировок — тоже с аккаунта при входе (не user_prefs, отдельная таблица).
  useEffect(() => { if (session?.user?.id) loadBlocked(session.user.id) }, [session?.user?.id])

  return <Ctx.Provider value={{ session, user: session?.user ?? null, loading }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
