import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Lightweight "user is typing…" indicator over a Supabase Realtime broadcast
// channel (no DB writes). `key` scopes it to a channel/DM thread; pass null when
// no conversation is open. Returns the set of other users currently typing and a
// throttled `notifyTyping` to call on each keystroke.
export function useTyping(key: string | null, meName: string) {
  const [typers, setTypers] = useState<string[]>([])
  const lastSeen = useRef<Record<string, number>>({})
  const chRef = useRef<any>(null)
  const lastSent = useRef(0)

  useEffect(() => {
    if (!key) { setTypers([]); lastSeen.current = {}; return }
    const ch = supabase.channel('typing:' + key, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, (p: any) => {
      const name = p?.payload?.name
      if (!name || name === meName) return
      lastSeen.current[name] = Date.now()
      setTypers(Object.keys(lastSeen.current))
    }).subscribe()
    chRef.current = ch
    const iv = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const n in lastSeen.current) if (now - lastSeen.current[n] >= 4000) { delete lastSeen.current[n]; changed = true }
      if (changed) setTypers(Object.keys(lastSeen.current))
    }, 1200)
    return () => { clearInterval(iv); supabase.removeChannel(ch); chRef.current = null; lastSeen.current = {}; setTypers([]) }
  }, [key, meName])

  function notifyTyping() {
    const now = Date.now()
    if (now - lastSent.current < 1500) return
    lastSent.current = now
    chRef.current?.send({ type: 'broadcast', event: 'typing', payload: { name: meName } })
  }

  return { typers, notifyTyping }
}