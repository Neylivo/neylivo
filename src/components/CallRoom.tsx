import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent } from '../lib/livekit'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'
import { CallRecorder } from '../lib/callAudio'
import { saveMoment } from '../lib/soundboard'
import { matchCombo } from '../lib/keybind'
import { Soundboard } from './Soundboard'

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

export function CallRoom({ room, meId, meName, onLeave }:
  { room: Room; meId: string; meName: string; /* soundboard clip ownership */ onLeave: () => void }) {
  const { settings } = useSettings()
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(false)
  const [screen, setScreen] = useState(false)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const [count, setCount] = useState(1)
  const [showSb, setShowSb] = useState(false)
  const [flash, setFlash] = useState(false)
  const recRef = useRef<CallRecorder | null>(null)

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

  // Rolling recorder: mix local mic + all remote audio into a ring buffer so the
  // last N seconds can be saved as a soundboard "moment" at any time.
  useEffect(() => {
    const rec = new CallRecorder(20)
    recRef.current = rec
    const addLocal = () => {
      room.localParticipant.trackPublications.forEach((pub: any) => {
        const t = pub.track
        if (t && t.kind === 'audio' && t.mediaStreamTrack) rec.addTrack(t.mediaStreamTrack, 'local_' + pub.trackSid)
      })
    }
    const onLocalPub = (pub: any) => {
      const t = pub.track
      if (t && t.kind === 'audio' && t.mediaStreamTrack) rec.addTrack(t.mediaStreamTrack, 'local_' + pub.trackSid)
    }
    const onSub = (track: any, _pub: any, p: any) => {
      if (track.kind === 'audio' && track.mediaStreamTrack) rec.addTrack(track.mediaStreamTrack, p.sid + '_' + track.sid)
    }
    const onUnsub = (track: any, _pub: any, p: any) => { rec.removeTrack(p.sid + '_' + track.sid) }
    addLocal()
    room.localParticipant.on('localTrackPublished', onLocalPub)
    room.on(RoomEvent.TrackSubscribed, onSub)
    room.on(RoomEvent.TrackUnsubscribed, onUnsub)
    rec.resume()
    return () => {
      room.localParticipant.off('localTrackPublished', onLocalPub)
      room.off(RoomEvent.TrackSubscribed, onSub)
      room.off(RoomEvent.TrackUnsubscribed, onUnsub)
      rec.close()
      recRef.current = null
    }
  }, [room])

  async function doSaveMoment() {
    try {
      setFlash(true); setTimeout(() => setFlash(false), 1200)
      await saveMoment(recRef.current, meId, meName, 15)
      setShowSb(true)
    } catch (e: any) { alert(e.message ?? String(e)) }
  }

  // In-call hotkey: save the last 15s when the configured combo is pressed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      if (settings.sbKey && matchCombo(e, settings.sbKey)) { e.preventDefault(); doSaveMoment() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.sbKey])

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
    <div className={'call-wrap' + (flash ? ' sb-flash' : '')}>
      <div className="call-top">
        <span className={'call-live call-' + status}>● {statusLabel}</span>
        <span className="call-cnt"><Icon name="users" size={15} /> {count}</span>
        {flash && <span className="sb-flash-tag"><Icon name="soundboard" size={14} /> Момент сохранён</span>}
      </div>
      <Stage room={room} />
      {showSb && <Soundboard room={room} recorder={recRef.current} meId={meId} meName={meName} onClose={() => setShowSb(false)} />}
      <div className="call-bar">
        <button className={mic ? 'on' : ''} onClick={toggleMic} title="Микрофон">{mic ? <Icon name="mic" size={20} /> : <Icon name="mic-off" size={20} />}</button>
        <button className={cam ? 'on' : ''} onClick={toggleCam} title="Камера">{cam ? <Icon name="video" size={20} /> : <Icon name="video-off" size={20} />}</button>
        <button className={screen ? 'on' : ''} onClick={toggleScreen} title="Демонстрация экрана"><Icon name="screen-share" size={20} /></button>
        <button className={showSb ? 'on' : ''} onClick={() => setShowSb(s => !s)} title={'Саундпад / Моменты' + (settings.sbKey ? ' (' + settings.sbKey + ')' : '')}><Icon name="soundboard" size={20} /></button>
        <button className="leave" onClick={leave} title="Отключиться"><Icon name="phone-off" size={20} /></button>
      </div>
    </div>
  )
}