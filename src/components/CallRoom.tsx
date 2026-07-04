

import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent } from '../lib/livekit'
import { Icon } from './icons'
import { Avatar } from './Avatar'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { CallRecorder } from '../lib/callAudio'
import { saveMoment } from '../lib/soundboard'
import { matchCombo } from '../lib/keybind'
import { Soundboard } from './Soundboard'
import { audioCtx, master, fadeInCall, sndJoin, sndLeave, sndMute, sndUnmute } from '../lib/callSounds'

// ---- v1.29.0: экран звонка 1-в-1 как в Discord ----
// Панель звонка живёт сверху чата (не отдельным экраном): пока никто не включил
// видео — участники показаны кружочками-аватарками с зелёным кольцом говорящего;
// стоит включить камеру или демонстрацию — кружочки превращаются в плитки, демка
// занимает главную сцену, остальные уходят в ленту снизу. Есть полноэкранный
// режим, заглушение всех (deafen) и выбор качества демонстрации (до 4K / 60 FPS).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Качества демонстрации экрана — как «Качество стрима» в Discord.
const SHARE_RES = [
  { label: '720p', w: 1280, h: 720, br: 2_500_000 },
  { label: '1080p', w: 1920, h: 1080, br: 4_500_000 },
  { label: '1440p', w: 2560, h: 1440, br: 8_000_000 },
  { label: '4K', w: 3840, h: 2160, br: 15_000_000 },
]
const SHARE_FPS = [15, 30, 60]

// ---- Громкость собеседников: WebAudio-гейны в общем реестре по identity ----
const gainReg = new Map<string, Set<GainNode>>()
function getVol(identity: string): number {
  const v = parseInt(localStorage.getItem('ponoi_vol_' + identity) || '100', 10)
  return isNaN(v) ? 100 : Math.max(0, Math.min(200, v))
}
function setPeerVolume(identity: string, v: number) {
  try { localStorage.setItem('ponoi_vol_' + identity, String(v)) } catch {}
  gainReg.get(identity)?.forEach(g => { g.gain.value = v / 100 })
}

/** Невидимый приёмник звука участника: все его аудиодорожки идут через GainNode. */
function AudioSink({ p }: { p: any }) {
  useEffect(() => {
    let els: HTMLElement[] = []
    let nodes: AudioNode[] = []
    let regs: GainNode[] = []
    function refresh() {
      els.forEach(e => e.remove()); els = []
      nodes.forEach(n => { try { n.disconnect() } catch {} }); nodes = []
      regs.forEach(g => gainReg.get(p.identity)?.delete(g)); regs = []
      p.trackPublications.forEach((pub: any) => {
        const t = pub.track
        if (!t || t.kind !== 'audio') return
        const el = t.attach() as HTMLMediaElement
        el.style.display = 'none'
        document.body.appendChild(el); els.push(el)
        try {
          const ctx = audioCtx()
          const src = ctx.createMediaStreamSource(new MediaStream([t.mediaStreamTrack]))
          const g = ctx.createGain()
          g.gain.value = getVol(p.identity) / 100
          src.connect(g); g.connect(master())
          el.muted = true
          nodes.push(src, g)
          if (!gainReg.has(p.identity)) gainReg.set(p.identity, new Set())
          gainReg.get(p.identity)!.add(g); regs.push(g)
        } catch { /* нет WebAudio — элемент играет сам на 100% */ }
      })
    }
    refresh()
    const evs = ['trackSubscribed', 'trackUnsubscribed', 'trackMuted', 'trackUnmuted', 'trackPublished', 'trackUnpublished']
    evs.forEach(e => p.on(e, refresh))
    return () => {
      evs.forEach(e => p.off(e, refresh))
      els.forEach(e => e.remove())
      nodes.forEach(n => { try { n.disconnect() } catch {} })
      regs.forEach(g => gainReg.get(p.identity)?.delete(g))
    }
  }, [p])
  return null
}

export function Sinks({ room }: { room: Room }) {
  const [, bump] = useState(0)
  useEffect(() => {
    const re = () => bump(v => v + 1)
    room.on(RoomEvent.ParticipantConnected, re)
    room.on(RoomEvent.ParticipantDisconnected, re)
    return () => { room.off(RoomEvent.ParticipantConnected, re); room.off(RoomEvent.ParticipantDisconnected, re) }
  }, [room])
  const remotes: any[] = Array.from((room as any).remoteParticipants?.values?.() ?? (room as any).participants?.values?.() ?? [])
  return <>{remotes.map(p => <AudioSink key={p.sid || p.identity} p={p} />)}</>
}

/** Ползунок громкости собеседника (0–200%), появляется при наведении. */
function VolCtl({ identity }: { identity: string }) {
  const [vol, setVol] = useState(() => getVol(identity))
  return (
    <div className="c2-vol" onClick={e => e.stopPropagation()}>
      <Icon name="volume" size={12} />
      <input type="range" min={0} max={200} step={5} value={vol}
        onChange={e => { const v = parseInt(e.target.value, 10); setVol(v); setPeerVolume(identity, v) }}
        title={'Громкость: ' + vol + '%'} />
      <span>{vol}%</span>
    </div>
  )
}

/** Живые флаги участника: говорит / микрофон включён. */
function useSpeakMic(p: any) {
  const [speaking, setSpeaking] = useState(!!p.isSpeaking)
  const [micOn, setMicOn] = useState(p.isMicrophoneEnabled !== false)
  useEffect(() => {
    const onSpeak = (s: boolean) => setSpeaking(s)
    const onMic = () => setMicOn(p.isMicrophoneEnabled !== false)
    p.on('isSpeakingChanged', onSpeak)
    const evs = ['trackMuted', 'trackUnmuted', 'trackPublished', 'trackUnpublished']
    evs.forEach(e => p.on(e, onMic))
    return () => { p.off('isSpeakingChanged', onSpeak); evs.forEach(e => p.off(e, onMic)) }
  }, [p])
  return { speaking, micOn }
}

/** Кружочек участника — голосовой режим, когда никто не показывает видео. */
function Bubble({ p, isLocal, avatar, meName }: { p: any; isLocal: boolean; avatar?: string | null; meName?: string }) {
  const { speaking, micOn } = useSpeakMic(p)
  const name = isLocal ? (meName || p.name || p.identity || 'Вы') : (p.name || p.identity || '?')
  return (
    <div className="c2-bub">
      <div className={'c2-bub-av' + (speaking ? ' speaking' : '')}>
        <Avatar name={String(name)} url={avatar} size={84} />
        {!micOn && <span className="c2-bub-mute"><Icon name="mic-off" size={12} /></span>}
      </div>
      <div className="c2-bub-nm">{name}</div>
      {!isLocal && <VolCtl identity={p.identity} />}
    </div>
  )
}

/** Плитка участника — видео-режим: камера или аватар на тёмном фоне. */
function Tile({ p, isLocal, avatar, small, meName }: { p: any; isLocal: boolean; avatar?: string | null; small?: boolean; meName?: string }) {
  const vidRef = useRef<HTMLDivElement>(null)
  const [hasCam, setHasCam] = useState(false)
  const { speaking, micOn } = useSpeakMic(p)
  useEffect(() => {
    const host = vidRef.current!
    let attached: HTMLElement[] = []
    function refresh() {
      attached.forEach(e => e.remove()); attached = []
      let cam = false
      p.trackPublications.forEach((pub: any) => {
        const t = pub.track
        if (!t || t.kind !== 'video' || pub.source !== 'camera') return
        const el = t.attach(); el.classList.add('c2-media'); host.appendChild(el); attached.push(el); cam = true
      })
      setHasCam(cam)
    }
    refresh()
    const evs = ['trackSubscribed', 'trackUnsubscribed', 'trackMuted', 'trackUnmuted',
      'trackPublished', 'trackUnpublished', 'localTrackPublished', 'localTrackUnpublished']
    evs.forEach(e => p.on(e, refresh))
    return () => { evs.forEach(e => p.off(e, refresh)); attached.forEach(e => e.remove()) }
  }, [p])
  const name = isLocal ? (meName || p.name || p.identity || 'Вы') : (p.name || p.identity || '?')
  return (
    <div className={'c2-tile' + (speaking ? ' speaking' : '') + (hasCam ? ' cam' : '') + (isLocal ? ' local' : '')}>
      <div className="c2-vid" ref={vidRef} />
      {!hasCam && <div className="c2-tile-av"><Avatar name={String(name)} url={avatar} size={small ? 44 : 72} /></div>}
      {!isLocal && <VolCtl identity={p.identity} />}
      <div className="c2-cap">{!micOn && <Icon name="mic-off" size={11} />} {name}</div>
    </div>
  )
}

/** Плитка демонстрации экрана. */
function ShareTile({ pub, who, onClick }: { pub: any; who: string; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current!
    const t = pub.track
    if (!t) return
    const el = t.attach(); el.classList.add('c2-media'); host.appendChild(el)
    return () => { t.detach().forEach((e: HTMLElement) => e.remove()) }
  }, [pub])
  return (
    <div className="c2-tile share" onClick={onClick}>
      <span className="c2-live">LIVE</span>
      <div className="c2-vid" ref={ref} />
      <div className="c2-cap"><Icon name="screen-share" size={11} /> {who} — экран</div>
    </div>
  )
}

/** Сцена: кружочки в голосовом режиме, плитки + лента при видео/демке. */
function Stage({ room, avatars, meName }: { room: Room; avatars: Record<string, string | null>; meName?: string }) {
  const [, bump] = useState(0)
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => {
    const re = () => bump(v => v + 1)
    const evs = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished] as any[]
    evs.forEach(e => room.on(e, re))
    return () => { evs.forEach(e => room.off(e, re)) }
  }, [room])

  const remotes: any[] = Array.from((room as any).remoteParticipants?.values?.() ?? (room as any).participants?.values?.() ?? [])
  const all = [{ p: room.localParticipant as any, local: true }, ...remotes.map(p => ({ p, local: false }))]

  const shares: { pub: any; who: string; key: string }[] = []
  let anyCam = false
  all.forEach(({ p, local }) => {
    p.trackPublications.forEach((pub: any) => {
      if (pub.source === 'screen_share' && pub.track) shares.push({ pub, who: local ? (meName || p.name || p.identity || 'Вы') : (p.name || p.identity || '?'), key: 'sh:' + (pub.trackSid || p.sid || '') })
      if (pub.source === 'camera' && pub.track) anyCam = true
    })
  })

  const av = (p: any) => avatars[p.identity] ?? null

  // Голосовой режим: кружочки-аватарки по центру, как звонок в Discord.
  if (!shares.length && !anyCam) return (
    <div className="c2-bubbles">
      {all.map(({ p, local }) => <Bubble key={p.sid || p.identity} p={p} isLocal={local} avatar={av(p)} meName={meName} />)}
    </div>
  )

  const focused = shares.find(s => s.key === focus) ?? shares[0] ?? null
  // Камеры без демки: сетка плиток.
  if (!focused) return (
    <div className="c2-board">
      <div className="c2-grid">
        {all.map(({ p, local }) => <Tile key={p.sid || p.identity} p={p} isLocal={local} avatar={av(p)} meName={meName} />)}
      </div>
    </div>
  )
  // Демка: главная сцена + лента маленьких плиток снизу.
  return (
    <div className="c2-board">
      <div className="c2-main"><ShareTile key={focused.key} pub={focused.pub} who={focused.who} /></div>
      <div className="c2-strip">
        {shares.filter(s => s.key !== focused.key).map(s => <ShareTile key={s.key} pub={s.pub} who={s.who} onClick={() => setFocus(s.key)} />)}
        {all.map(({ p, local }) => <Tile key={p.sid || p.identity} p={p} isLocal={local} avatar={av(p)} small meName={meName} />)}
      </div>
    </div>
  )
}

export function CallRoom({ room, meId, meName, onLeave, peer }:
  { room: Room; meId: string; meName: string; onLeave: () => void; peer?: { name: string; avatarUrl?: string | null } | null }) {
  const { settings } = useSettings()
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(false)
  const [screen, setScreen] = useState(false)
  const [deaf, setDeaf] = useState(false)
  const [fs, setFs] = useState(false)
  const [qMenu, setQMenu] = useState(false)
  const [sq, setSq] = useState<{ res: string; fps: number }>(() => {
    try { const s = JSON.parse(localStorage.getItem('ponoi_share_q') || '{}'); if (s.res && s.fps) return s } catch {}
    return { res: '1080p', fps: 30 }
  })
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const [count, setCount] = useState(1)
  const [showSb, setShowSb] = useState(false)
  const [flash, setFlash] = useState(false)
  const recRef = useRef<CallRecorder | null>(null)
  const [avatars, setAvatars] = useState<Record<string, string | null>>({})

  // Аватарки участников из profiles: identity — это id (или юзернейм) пользователя.
  useEffect(() => {
    let ok = true
    async function load() {
      const ps: any[] = [room.localParticipant, ...Array.from((room as any).remoteParticipants?.values?.() ?? [])]
      const ids = ps.map(p => String(p.identity || '')).filter(Boolean)
      const uu = ids.filter(x => UUID_RE.test(x))
      const nn = ids.filter(x => !UUID_RE.test(x))
      const map: Record<string, string | null> = {}
      try {
        if (uu.length) {
          const { data } = await supabase.from('profiles').select('id,avatar_url').in('id', uu)
          for (const r of (data ?? []) as any[]) map[r.id] = r.avatar_url
        }
        if (nn.length) {
          const { data } = await supabase.from('profiles').select('username,avatar_url').in('username', nn)
          for (const r of (data ?? []) as any[]) map[r.username] = r.avatar_url
        }
      } catch {}
      if (ok) setAvatars(m => ({ ...m, ...map }))
    }
    load()
    const re = () => load()
    room.on(RoomEvent.ParticipantConnected, re)
    return () => { ok = false; room.off(RoomEvent.ParticipantConnected, re) }
  }, [room])

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
    // Демку/камеру остановили из системного окна — кнопки не должны «залипнуть».
    const onLocalUnpub = (pub: any) => {
      if (pub?.source === 'screen_share') setScreen(false)
      if (pub?.source === 'camera') setCam(false)
    }
    room.on(RoomEvent.LocalTrackUnpublished, onLocalUnpub)
    return () => {
      room.off(RoomEvent.Connected, onConn)
      room.off(RoomEvent.Reconnecting, onRec)
      room.off(RoomEvent.Reconnected, onRecd)
      room.off(RoomEvent.ParticipantConnected, onPJoin)
      room.off(RoomEvent.ParticipantDisconnected, onPLeave)
      room.off(RoomEvent.LocalTrackUnpublished, onLocalUnpub)
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
  function toggleDeaf() {
    const v = !deaf
    try { master().gain.value = v ? 0 : 1 } catch {}
    setDeaf(v); v ? sndMute() : sndUnmute()
  }
  async function toggleCam() {
    const v = !cam
    try { await room.localParticipant.setCameraEnabled(v); setCam(v) } catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  async function startShare() {
    setQMenu(false)
    const r = SHARE_RES.find(x => x.label === sq.res) ?? SHARE_RES[1]
    try { localStorage.setItem('ponoi_share_q', JSON.stringify(sq)) } catch {}
    try {
      await (room.localParticipant as any).setScreenShareEnabled(true,
        { audio: true, resolution: { width: r.w, height: r.h, frameRate: sq.fps } },
        { screenShareEncoding: { maxBitrate: r.br, maxFramerate: sq.fps } })
      setScreen(true)
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  async function stopShare() {
    try { await room.localParticipant.setScreenShareEnabled(false) } catch {}
    setScreen(false)
  }
  function leave() { room.disconnect(); onLeave() }

  const alone = status === 'connected' && count <= 1
  const statusLabel = status === 'reconnecting' ? 'Переподключение…'
    : status === 'connecting' ? 'Соединение…'
    : alone ? (peer ? 'Звоним ' + peer.name + '…' : 'Звоним…') : 'Голосовой звонок'

  return (
    <div className={'c2-wrap' + (fs ? ' fs' : '') + (flash ? ' sb-flash' : '') + (alone && peer ? ' ringing' : '')}>
      <Sinks room={room} />
      <div className="c2-top">
        <span className={'c2-status ' + (alone ? 'connecting' : status)}><i />{statusLabel}</span>
        <span className="c2-cnt"><Icon name="users" size={14} /> {count}</span>
        {flash && <span className="c2-flashtag"><Icon name="soundboard" size={13} /> Момент сохранён</span>}
        <div className="c2-topbtns">
          <button title={fs ? 'Свернуть' : 'На весь экран'} onClick={() => setFs(f => !f)}><Icon name={fs ? 'shrink' : 'expand'} size={16} /></button>
        </div>
      </div>
      <Stage room={room} avatars={avatars} meName={meName} />
      {alone && <div className="c2-waiting">{peer ? 'Ждём ответа — ' + peer.name + '…' : 'Ждём, пока кто-нибудь присоединится…'}</div>}
      {showSb && <Soundboard room={room} recorder={recRef.current} meId={meId} meName={meName} onClose={() => setShowSb(false)} />}
      <div className="c2-bar">
        <button className={'c2-btn' + (mic ? '' : ' lit')} onClick={toggleMic} title={mic ? 'Выключить микрофон' : 'Включить микрофон'}><Icon name={mic ? 'mic' : 'mic-off'} size={20} /></button>
        <button className={'c2-btn' + (deaf ? ' lit' : '')} onClick={toggleDeaf} title={deaf ? 'Включить звук' : 'Заглушить всех'}><Icon name={deaf ? 'headphones-off' : 'headphones'} size={20} /></button>
        <button className={'c2-btn' + (cam ? ' lit' : '')} onClick={toggleCam} title={cam ? 'Выключить камеру' : 'Включить камеру'}><Icon name={cam ? 'video' : 'video-off'} size={20} /></button>
        <div className="c2-share-wrap">
          <button className={'c2-btn' + (screen ? ' live' : '')} onClick={() => screen ? stopShare() : setQMenu(m => !m)} title={screen ? 'Остановить демонстрацию' : 'Демонстрация экрана'}><Icon name="screen-share" size={20} /></button>
          {qMenu && !screen && <>
            <div className="c2-menu-ov" onClick={() => setQMenu(false)} />
            <div className="c2-menu">
              <div className="c2-menu-h">Качество</div>
              <div className="c2-qrow">
                {SHARE_RES.map(r => <button key={r.label} className={sq.res === r.label ? 'on' : ''} onClick={() => setSq(s => ({ ...s, res: r.label }))}>{r.label}</button>)}
              </div>
              <div className="c2-menu-h">Частота кадров</div>
              <div className="c2-qrow">
                {SHARE_FPS.map(f => <button key={f} className={sq.fps === f ? 'on' : ''} onClick={() => setSq(s => ({ ...s, fps: f }))}>{f} FPS</button>)}
              </div>
              <button className="c2-go" onClick={startShare}><Icon name="screen-share" size={16} /> В эфир</button>
            </div>
          </>}
        </div>
        <button className={'c2-btn' + (showSb ? ' lit' : '')} onClick={() => setShowSb(s => !s)} title={'Саундпад / Моменты' + (settings.sbKey ? ' (' + settings.sbKey + ')' : '')}><Icon name="soundboard" size={20} /></button>
        <button className="c2-btn leave" onClick={leave} title="Завершить звонок"><Icon name="phone-off" size={20} /></button>
      </div>
    </div>
  )
}
