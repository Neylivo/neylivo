import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track } from '../lib/livekit'
import { useAuth } from '../auth/AuthProvider'

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

    function sub(track: any, pub: any, participant: any) {
      attach(track, participant.sid + track.sid, participant.identity)
    }
    function unsub(track: any) { track.detach().forEach((e: HTMLElement) => e.remove()) }

    room.on(RoomEvent.TrackSubscribed, sub)
    room.on(RoomEvent.TrackUnsubscribed, unsub)

    // local tracks
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

  useEffect(() => { room.localParticipant.setMicrophoneEnabled(true).then(() => setMic(true)) }, [room])

  async function toggleMic() { const v = !mic; await room.localParticipant.setMicrophoneEnabled(v); setMic(v) }
  async function toggleCam() { const v = !cam; await room.localParticipant.setCameraEnabled(v); setCam(v) }
  async function toggleScreen() {
    const v = !screen
    try { await room.localParticipant.setScreenShareEnabled(v); setScreen(v) }
    catch (e: any) { alert(e.message ?? String(e)) }
  }
  function leave() { room.disconnect(); onLeave() }

  return (
    <div className="call-wrap">
      <Stage room={room} />
      <div className="call-bar">
        <button className={mic ? 'on' : ''} onClick={toggleMic} title="Микрофон">{mic ? '🎤' : '🔇'}</button>
        <button className={cam ? 'on' : ''} onClick={toggleCam} title="Камера">{cam ? '📹' : '📷'}</button>
        <button className={screen ? 'on' : ''} onClick={toggleScreen} title="Демонстрация экрана">🖥️</button>
        <button className="leave" onClick={leave} title="Выйти">📴</button>
      </div>
    </div>
  )
}
