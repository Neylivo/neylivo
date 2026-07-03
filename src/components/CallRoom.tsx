
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent } from '../lib/livekit'
import { Icon } from './icons'

// Renders every participant's video/audio by attaching LiveKit tracks to DOM elements.
function Stage({ room }: { room: Room }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current!
    const tiles = new Map<string, HTMLDivElement>()

    function tileFor(id: string, label: string) {
      let t = tiles.get(id)
      if (!t) {
        t = document.createElement('div'); t.className = 'call-tile'
        const cap = document.createElement('div'); cap.className = 'call-cap'; cap.textContent = label
        t.appendChild(cap); host.appendChild(t); tiles.set(id, t)
      }
      return t
    }

    function attach(track: any, id: string, label: string) {
      const el = track.attach(); el.classList.add('call-media')
      if (track.kind === 'video') tileFor(id, label).appendChild(el)
      else host.appendChild(el) // audio
    }

    function sub(track: any, _pub: any, participant: any) {
      attach(track, participant.sid + track.sid, participant.identity)
    }
    function unsub(track: any) { track.detach().forEach((e: HTMLElement) => e.remove()) }

    room.on(RoomEvent.TrackSubscribed, sub)
    room.on(RoomEvent.TrackUnsubscribed, unsub)

    room.localParticipant.trackPublications.forEach(pub => {
      if (pub.track) attach(pub.track, room.localParticipant.sid + pub.trackSid, 'Вы')
    })
    room.localParticipant.on('localTrackPublished', (pub: any) => {
      if (pub.track) attach(pub.track, room.localParticipant.sid + pub.trackSid, 'Вы')
    })

    return () => {
      room.off(RoomEvent.TrackSubscribed, sub)
      room.off(RoomEvent.TrackUnsubscribed, unsub)
      host.innerHTML = ''
    }
  }, [room])

  return <div className="call-stage" ref={ref} />
}

export function CallRoom({ room, onLeave }: { room: Room; onLeave: () => void }) {
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(false)
  const [screen, setScreen] = useState(false)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const [count, setCount] = useState(1)

  useEffect(() => {
    room.localParticipant.setMicrophoneEnabled(true).then(() => setMic(true))
    const upd = () => setCount(room.numParticipants + 1)
    setStatus(room.state === 'connected' ? 'connected' : 'connecting')
    upd()
    const onConn = () => setStatus('connected')
    const onRec = () => setStatus('reconnecting')
    const onRecd = () => setStatus('connected')
    room.on(RoomEvent.Connected, onConn)
    room.on(RoomEvent.Reconnecting, onRec)
    room.on(RoomEvent.Reconnected, onRecd)
    room.on(RoomEvent.ParticipantConnected, upd)
    room.on(RoomEvent.ParticipantDisconnected, upd)
    return () => {
      room.off(RoomEvent.Connected, onConn)
      room.off(RoomEvent.Reconnecting, onRec)
      room.off(RoomEvent.Reconnected, onRecd)
      room.off(RoomEvent.ParticipantConnected, upd)
      room.off(RoomEvent.ParticipantDisconnected, upd)
    }
  }, [room])

  async function toggleMic() { const v = !mic; await room.localParticipant.setMicrophoneEnabled(v); setMic(v) }
  async function toggleCam() { const v = !cam; await room.localParticipant.setCameraEnabled(v); setCam(v) }
  async function toggleScreen() {
    const v = !screen
    try { await room.localParticipant.setScreenShareEnabled(v); setScreen(v) }
    catch (e: any) { alert(e.message ?? String(e)) }
  }
  function leave() { room.disconnect(); onLeave() }

  const statusLabel = status === 'connected' ? 'В звонке' : status === 'reconnecting' ? 'Переподключение…' : 'Соединение…'

  return (
    <div className="call-wrap">
      <div className="call-top">
        <span className={'call-live call-' + status}>● {statusLabel}</span>
        <span className="call-cnt"><Icon name="users" size={15} /> {count}</span>
      </div>
      <Stage room={room} />
      <div className="call-bar">
        <button className={mic ? 'on' : ''} onClick={toggleMic} title="Микрофон">{mic ? <Icon name="mic" size={20} /> : <Icon name="mic-off" size={20} />}</button>
        <button className={cam ? 'on' : ''} onClick={toggleCam} title="Камера">{cam ? <Icon name="video" size={20} /> : <Icon name="video-off" size={20} />}</button>
        <button className={screen ? 'on' : ''} onClick={toggleScreen} title="Демонстрация экрана"><Icon name="screen-share" size={20} /></button>
        <button className="leave" onClick={leave} title="Отключиться"><Icon name="phone-off" size={20} /></button>
      </div>
    </div>
  )
}
