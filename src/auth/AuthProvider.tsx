import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { initUserPrefs } from '../lib/userPrefs'
import { loadBlocked, watchBlocked } from '../lib/block'

interface AuthCtx { session: Session | null; user: User | null; loading: boolean }
const Ctx = createContext<AuthCtx>({ session: null, user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // v1.271.0: без .catch() отказ этого промиса (битый/просроченный refresh-токен
    // в localStorage, сетевой сбой при попытке его обновить) навсегда оставлял
    // loading=true — экран «Загрузка…» висел бесконечно без единой подсказки,
    // что пошло не так, и без способа попасть на экран входа. Плюс таймаут: если
    // запрос вообще не отвечает (обрыв сети без явного отказа — fetch у браузера
    // может просто повиснуть), через 15с всё равно пускаем на экран входа, а не
    // держим пользователя перед пустым экраном бесконечно.
    let done = false
    const finish = (s: Session | null) => { if (done) return; done = true; setSession(s); setLoading(false) }
    supabase.auth.getSession()
      .then(({ data }) => finish(data.session))
      .catch(err => { console.error('[auth] getSession failed:', err); finish(null) })
    const timeout = setTimeout(() => finish(null), 15000)
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => { clearTimeout(timeout); sub.subscription.unsubscribe() }
  }, [])

  // Приватные настройки (папки, мьюты, заметки, ...) грузятся с аккаунта при входе.
  useEffect(() => { initUserPrefs(session?.user?.id ?? null) }, [session?.user?.id])
  // v1.187.0: список блокировок — тоже с аккаунта при входе (не user_prefs, отдельная таблица).
  // v1.252.0: + живая подписка — блокировка/разблокировка на другом устройстве
  // теперь сразу прячет/возвращает переписку здесь, без перезахода.
  useEffect(() => { if (session?.user?.id) { loadBlocked(session.user.id); watchBlocked(session.user.id) } }, [session?.user?.id])

  return <Ctx.Provider value={{ session, user: session?.user ?? null, loading }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
