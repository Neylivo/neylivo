import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent } from '../lib/livekit'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'
import { CallRecorder } from '../lib/callAudio'
import { saveMoment } from '../lib/soundboard'
import { matchCombo } from '../lib/keybind'
import { Soundboard } from './Soundboard'
import { audioCtx, master, fadeInCall, sndJoin, sndLeave, sndMute, sndUnmute } from '../lib/callSounds'

// ---- Проход 5: экран звонка как в прототипе ----
// У каждого участника — своя плитка (аватар-инициалы, если камера выключена),
// подсветка говорящего, значок выключенного микрофона, отдельные большие плитки
// для демонстрации экрана и оверлей «Звоним…», пока никто не присоединился.

function hue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

// AudioContext и master-гейн — общие, из callSounds (там же fade-in и сигналы).

/** Плитка одного участника: камера (если есть) или аватар-инициалы. */
function Tile({ p, isLocal }: { p: any; isLocal: boolean }) {
  const vidRef = useRef<HTMLDivElement>(null)
  const [hasCam, setHasCam] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [speaking, setSpeaking] = useState(!!p.isSpeaking)
  // Индивидуальная громкость участника 0–200%, запоминается по имени.
  const [vol, setVol] = useState(() => {
    const v = parseInt(localStorage.getItem('ponoi_vol_' + (p.identity || '')) || '100', 10)
    return isNaN(v) ? 100 : Math.max(0, Math.min(200, v))
  })
  const volRef = useRef(vol)
  const gainsRef = useRef<GainNode[]>([])

  useEffect(() => {
    volRef.current = vol
    gainsRef.current.forEach(g => { g.gain.value = vol / 100 })
    if (!isLocal) try { localStorage.setItem('ponoi_vol_' + (p.identity || ''), String(vol)) } catch {}
  }, [vol, isLocal, p.identity])

  useEffect(() => {
    const host = vidRef.current!
    let attached: HTMLElement[] = []
    let nodes: AudioNode[] = []

    function refresh() {
      attached.forEach(e => e.remove()); attached = []
      nodes.forEach(n => { try { n.disconnect() } catch {} }); nodes = []
      gainsRef.current = []
      let cam = false
      p.trackPublications.forEach((pub: any) => {
        const t = pub.track
        if (!t || pub.source === 'screen_share' || pub.source === 'screen_share_audio') return
        if (t.kind === 'video') {
          const el = t.attach(); el.classList.add('call-media'); host.appendChild(el); attached.push(el); cam = true
        } else if (t.kind === 'audio' && !isLocal) {
          const el = t.attach(); el.style.display = 'none'; host.appendChild(el); attached.push(el)
          // Громкость через WebAudio: элемент глушим, звук идёт через GainNode (0–200%).
          try {
            const ctx = audioCtx()
            const src = ctx.createMediaStreamSource(new MediaStream([t.mediaStreamTrack]))
            const g = ctx.createGain()
            g.gain.value = volRef.current / 100
            src.connect(g); g.connect(master())
            ;(el as HTMLMediaElement).muted = true
            nodes.push(src, g); gainsRef.current.push(g)
          } catch { /* нет WebAudio — играет сам элемент на 100% */ }
        }
      })
      setHasCam(cam)
      setMicOn(p.isMicrophoneEnabled !== false)
    }
    refresh()
    const evs = ['trackSubscribed', 'trackUnsubscribed', 'trackMuted', 'trackUnmuted',
      'trackPublished', 'trackUnpublished', 'localTrackPublished', 'localTrackUnpublished']
    evs.forEach(e => p.on(e, refresh))
    const onSpeak = (s: boolean) => setSpeaking(s)
    p.on('isSpeakingChanged', onSpeak)
    return () => {
      evs.forEach(e => p.off(e, refresh))
      p.off('isSpeakingChanged', onSpeak)
      attached.forEach(e => e.remove())
      nodes.forEach(n => { try { n.disconnect() } catch {} })
      gainsRef.current = []
    }
  }, [p, isLocal])

  const name = isLocal ? 'Вы' : (p.identity || '?')
  return (
    <div className={'call-tile' + (speaking ? ' speaking' : '') + (hasCam ? ' hascam' : '')}>
      <div className="call-vid" ref={vidRef} />
      {!hasCam && <div className="call-ava" style={{ background: `hsl(${hue(p.identity || 'x')} 55% 42%)` }}>
        {String(name).slice(0, 2).toUpperCase()}
      </div>}
      {!isLocal && <div className="tile-vol" onClick={e => e.stopPropagation()}>
        <Icon name="headphones" size={12} />
        <input type="range" min={0} max={200} step={5} value={vol}
          onChange={e => setVol(parseInt(e.target.value, 10))}
          title={'Громкость: ' + vol + '%'} />
        <span className="tile-vol-pct">{vol}%</span>
      </div>}
      <div className="call-cap">
        {!micOn && <Icon name="mic-off" size={12} />}
        {name}
      </div>
    </div>
  )
}

/** Большая плитка демонстрации экрана. */
function ShareTile({ pub, who }: { pub: any; who: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current!
    const t = pub.track
    if (!t) return
    const el = t.attach(); el.classList.add('call-media'); host.appendChild(el)
    return () => { t.detach().forEach((e: HTMLElement) => e.remove()) }
  }, [pub])
  return (
    <div className="call-tile share">
      <div className="call-vid" ref={ref} />
      <div className="call-cap"><Icon name="screen-share" size={12} /> {who} — экран</div>
    </div>
  )
}

/** Сетка: локальный + удалённые участники + плитки демонстраций экрана. */
function Stage({ room }: { room: Room }) {
  const [, bump] = useState(0)

  useEffect(() => {
    const re = () => bump(v => v + 1)
    const evs = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished] as any[]
    evs.forEach(e => room.on(e, re))
    return () => { evs.forEach(e => room.off(e, re)) }
  }, [room])

  const remotes: any[] = Array.from((room as any).remoteParticipants?.values?.() ?? (room as any).participants?.values?.() ?? [])
  const all: { p: any; local: boolean }[] = [{ p: room.localParticipant, local: true }, ...remotes.map(p => ({ p, local: false }))]

  const shares: { pub: any; who: string }[] = []
  all.forEach(({ p, local }) => {
    p.trackPublications.forEach((pub: any) => {
      if (pub.source === 'screen_share' && pub.track) shares.push({ pub, who: local ? 'Вы' : (p.identity || '?') })
    })
  })

  return (
    <div className={'call-stage' + (shares.length ? ' has-share' : '')}>
      {shares.map((s, i) => <ShareTile key={'sh' + i} pub={s.pub} who={s.who} />)}
      {all.map(({ p, local }) => <Tile key={p.sid || p.identity} p={p} isLocal={local} />)}
    </div>
  )
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
    const upd = () => {
      const n = (room as any).remoteParticipants?.size ?? (room as any).participants?.size ?? 0
      setCount(n + 1)
    }
    setStatus(room.state === 'connected' ? 'connected' : 'connecting')
    if (room.state === 'connected') fadeInCall()
    upd()
    const onConn = () => { setStatus('connected'); upd(); fadeInCall() }
    const onRec = () => setStatus('reconnecting')
    const onRecd = () => setStatus('connected')
    room.on(RoomEvent.Connected, onConn)
    room.on(RoomEvent.Reconnecting, onRec)
    room.on(RoomEvent.Reconnected, onRecd)
    const onPJoin = () => { upd(); sndJoin() }
    const onPLeave = () => { upd(); sndLeave() }
    room.on(RoomEvent.ParticipantConnected, onPJoin)
    room.on(RoomEvent.ParticipantDisconnected, onPLeave)
    return () => {
      room.off(RoomEvent.Connected, onConn)
      room.off(RoomEvent.Reconnecting, onRec)
      room.off(RoomEvent.Reconnected, onRecd)
      room.off(RoomEvent.ParticipantConnected, onPJoin)
      room.off(RoomEvent.ParticipantDisconnected, onPLeave)
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
    } catch (e: any) { toastErr(e.message ?? String(e)) }
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

  async function toggleMic() { const v = !mic; await room.localParticipant.setMicrophoneEnabled(v); setMic(v); v ? sndUnmute() : sndMute() }
  async function toggleCam() { const v = !cam; await room.localParticipant.setCameraEnabled(v); setCam(v) }
  async function toggleScreen() {
    const v = !screen
    try { await room.localParticipant.setScreenShareEnabled(v); setScreen(v) }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  function leave() { room.disconnect(); onLeave() }

  const alone = status === 'connected' && count <= 1
  const statusLabel = status === 'reconnecting' ? 'Переподключение…'
    : status === 'connecting' ? 'Соединение…'
    : alone ? 'Звоним…' : 'В звонке'

  return (
    <div className={'call-wrap' + (flash ? ' sb-flash' : '')}>
      <div className="call-top">
        <span className={'call-live call-' + (alone ? 'connecting' : status)}>● {statusLabel}</span>
        <span className="call-cnt"><Icon name="users" size={15} /> {count}</span>
        {flash && <span className="sb-flash-tag"><Icon name="soundboard" size={14} /> Момент сохранён</span>}
      </div>
      <Stage room={room} />
      {alone && <div className="call-waiting">Звоним… <span>ждём, пока кто-нибудь присоединится</span></div>}
      {showSb && <Soundboard room={room} recorder={recRef.current} meId={meId} meName={meName} onClose={() => setShowSb(false)} />}
      <div className="call-bar">
        <button className={mic ? 'on' : 'off'} onClick={toggleMic} title="Микрофон">{mic ? <Icon name="mic" size={20} /> : <Icon name="mic-off" size={20} />}</button>
        <button className={cam ? 'on' : 'off'} onClick={toggleCam} title="Камера">{cam ? <Icon name="video" size={20} /> : <Icon name="video-off" size={20} />}</button>
        <button className={screen ? 'on' : 'off'} onClick={toggleScreen} title="Демонстрация экрана"><Icon name="screen-share" size={20} /></button>
        <button className={showSb ? 'on' : ''} onClick={() => setShowSb(s => !s)} title={'Саундпад / Моменты' + (settings.sbKey ? ' (' + settings.sbKey + ')' : '')}><Icon name="soundboard" size={20} /></button>
        <button className="leave" onClick={leave} title="Отключиться"><Icon name="phone-off" size={20} /></button>
      </div>
    </div>
  )
}
