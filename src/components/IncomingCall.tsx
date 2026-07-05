import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { startRingtone, stopRingtone } from '../lib/callSounds'
import { setCallBadge } from '../lib/badge'

export interface IncomingRing { threadId: string; fromId: string; fromName: string; fromAvatar?: string | null }

// ---- v1.30.0: входящий звонок как в Discord — модалка по центру экрана. ----
// Глобальный слушатель: сидит на личном realtime-канале ring:{meId} и ловит
// «ring» от звонящего. Показывает модалку с рингтоном и кнопками принять /
// отклонить. Ответы уходят звонящему на его канал ring:{fromId}.
export function IncomingCall({ meId, onAccept }: { meId: string; onAccept: (r: IncomingRing) => void }) {
  const [ring, setRing] = useState<IncomingRing | null>(null)
  const ringRef = useRef<IncomingRing | null>(null)
  const lastSeen = useRef(0)
  useEffect(() => { ringRef.current = ring }, [ring])

  useEffect(() => {
    const ch = supabase.channel('ring:' + meId)
      .on('broadcast', { event: 'ring' }, ({ payload }) => {
        const p = payload as IncomingRing
        if (!p?.threadId || !p?.fromId) return
        lastSeen.current = Date.now()
        if (ringRef.current && ringRef.current.threadId !== p.threadId) return // уже звонит кто-то другой
        if (!ringRef.current) { setRing(p); startRingtone(); setCallBadge(p.threadId, true) }   // v1.101.0: звонок зажигает красный кружок на иконке
      })
      .on('broadcast', { event: 'cancel' }, ({ payload }) => {
        if (ringRef.current && ringRef.current.fromId === (payload as any)?.fromId) close()
      })
      .on('broadcast', { event: 'accepted' }, ({ payload }) => {
        window.dispatchEvent(new CustomEvent('ponoi-call-accepted', { detail: payload }))
      })
      .on('broadcast', { event: 'declined' }, ({ payload }) => {
        window.dispatchEvent(new CustomEvent('ponoi-call-declined', { detail: payload }))
      })
      .subscribe()
    // Ринги перестали приходить (звонящий пропал) — закрываем модалку сами.
    const t = window.setInterval(() => {
      if (ringRef.current && Date.now() - lastSeen.current > 7000) close()
    }, 2000)
    return () => { supabase.removeChannel(ch); window.clearInterval(t); stopRingtone() }
    // eslint-disable-next-line
  }, [meId])

  function close() {
    stopRingtone()
    if (ringRef.current) setCallBadge(ringRef.current.threadId, false)   // v1.101.0: гасим кружок звонка
    setRing(null)
  }

  function send(toId: string, event: string, payload: any) {
    const ch = supabase.channel('ring:' + toId)
    ch.subscribe((st: string) => {
      if (st === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event, payload })
        setTimeout(() => supabase.removeChannel(ch), 800)
      }
    })
  }

  function accept() {
    if (!ring) return
    send(ring.fromId, 'accepted', { threadId: ring.threadId })
    onAccept(ring)
    close()
  }
  function decline() {
    if (!ring) return
    send(ring.fromId, 'declined', { threadId: ring.threadId })
    close()
  }

  if (!ring) return null
  return (
    <div className="ic-ov">
      <div className="ic-card">
        <div className="ic-av">
          <span className="ic-wave" /><span className="ic-wave w2" />
          <Avatar name={ring.fromName} url={ring.fromAvatar} size={80} />
        </div>
        <div className="ic-name">{ring.fromName}</div>
        <div className="ic-sub">Входящий звонок…</div>
        <div className="ic-btns">
          <button className="ic-btn no" title="Отклонить" onClick={decline}><Icon name="phone-off" size={22} /></button>
          <button className="ic-btn ok" title="Принять" onClick={accept}><Icon name="phone" size={22} /></button>
        </div>
      </div>
    </div>
  )
}
