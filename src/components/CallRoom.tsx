

import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, DisconnectReason } from '../lib/livekit'
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
// v1.113.0: битрейты подняты — 4K теперь действительно 4K (40 Мбит/с), а не мыло.
const SHARE_RES = [
  { label: '720p', w: 1280, h: 720, br: 4_000_000 },
  { label: '1080p', w: 1920, h: 1080, br: 10_000_000 },
  { label: '1440p', w: 2560, h: 1440, br: 20_000_000 },
  { label: '4K', w: 3840, h: 2160, br: 40_000_000 },
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

// v1.183.0: «Отключить видео» из меню участника — чисто у себя, для остальных
// он продолжает транслировать камеру как ни в чём не бывало. Тот же реестр-паттерн,
// что у громкости (gainReg) — Tile подписан и перерисовывается по toggleVideoHidden.
const hiddenVideoReg = new Set<string>()
const hiddenVideoListeners = new Set<() => void>()
function isVideoHidden(identity: string): boolean { return hiddenVideoReg.has(identity) }
function toggleVideoHidden(identity: string) {
  if (hiddenVideoReg.has(identity)) hiddenVideoReg.delete(identity); else hiddenVideoReg.add(identity)
  hiddenVideoListeners.forEach(l => l())
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

export function Sinks({ room, meName }: { room: Room; meName?: string }) {
  const [, bump] = useState(0)
  useEffect(() => {
    const re = () => bump(v => v + 1)
    room.on(RoomEvent.ParticipantConnected, re)
    room.on(RoomEvent.ParticipantDisconnected, re)
    return () => { room.off(RoomEvent.ParticipantConnected, re); room.off(RoomEvent.ParticipantDisconnected, re) }
  }, [room])
  const remotes: any[] = Array.from((room as any).remoteParticipants?.values?.() ?? (room as any).participants?.values?.() ?? [])

  // v1.196.0: оверлей поверх игры со списком собеседников — Sinks смонтирован
  // ровно тогда, когда звонок идёт, а сам экран звонка не открыт (то есть как
  // раз может играть в игру), поэтому пуш сюда, не в CallRoom. Позиция/видимость
  // оверлея решает main-процесс (нужна ещё активная игра, см. electron/main.cjs).
  useEffect(() => {
    const d = (window as any).ponoiDesktop
    if (!d?.setCallOverlayParticipants) return
    let raf = 0
    const push = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const all = [room.localParticipant as any, ...remotes]
        const list = all.map(p => ({
          name: p === room.localParticipant ? (meName || p.name || p.identity || '?') : (p.name || p.identity || '?'),
          speaking: !!p.isSpeaking,
          micOn: p.isMicrophoneEnabled !== false,
        }))
        d.setCallOverlayParticipants(list)
      })
    }
    push()
    const evs = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished] as any[]
    evs.forEach(e => room.on(e, push))
    return () => {
      evs.forEach(e => room.off(e, push))
      cancelAnimationFrame(raf)
      try { d.setCallOverlayParticipants([]) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, meName, remotes.length])

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

// v1.183.0: правый клик по участнику звонка — меню как в Discord: профиль,
// громкость (тот же ползунок, что и VolCtl, просто внутри меню), заглушить у
// себя (не трогает его реальный микрофон — только твой гейн, как volume=0),
// отключить видео у себя, копировать ID. Паттерн ctx-overlay/ctx-menu/ctx-item —
// как везде в приложении (см. MessageList.tsx/ServerView.tsx контекстные меню).
function PartCtxMenu({ identity, x, y, onClose, onProfile }:
  { identity: string; x: number; y: number; onClose: () => void; onProfile?: () => void }) {
  const [vol, setVol] = useState(() => getVol(identity))
  const [hidden, setHidden] = useState(() => isVideoHidden(identity))
  const muted = vol === 0
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <>
      <div className="ctx-overlay" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div className="ctx-menu c2-pctx" style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 320) }}>
        {onProfile && <div className="ctx-item" onClick={() => { onClose(); onProfile() }}><span>Профиль</span><Icon name="user" size={14} /></div>}
        <div className="ctx-sep" />
        <div className="c2-pctx-vol" onClick={e => e.stopPropagation()}>
          <Icon name="volume" size={13} />
          <input type="range" min={0} max={200} step={5} value={vol}
            onChange={e => { const v = parseInt(e.target.value, 10); setVol(v); setPeerVolume(identity, v) }} />
          <span>{vol}%</span>
        </div>
        <div className="ctx-item" onClick={() => { const nv = muted ? 100 : 0; setVol(nv); setPeerVolume(identity, nv) }}>
          <span>{muted ? 'Включить звук' : 'Заглушить у себя'}</span><Icon name={muted ? 'volume' : 'mic-off'} size={14} />
        </div>
        <div className="ctx-item" onClick={() => { toggleVideoHidden(identity); setHidden(h => !h) }}>
          <span>{hidden ? 'Показать видео' : 'Отключить видео'}</span><Icon name={hidden ? 'video' : 'video-off'} size={14} />
        </div>
        <div className="ctx-sep" />
        <div className="ctx-item" onClick={() => { navigator.clipboard?.writeText(identity); onClose() }}><span>Копировать ID пользователя</span><Icon name="id-card" size={14} /></div>
      </div>
    </>
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

type CtxOpener = (p: any, name: string, avatar: string | null | undefined, x: number, y: number) => void

/** Кружочек участника — голосовой режим, когда никто не показывает видео. */
function Bubble({ p, isLocal, avatar, meName, onCtx }: { p: any; isLocal: boolean; avatar?: string | null; meName?: string; onCtx?: CtxOpener }) {
  const { speaking, micOn } = useSpeakMic(p)
  const name = isLocal ? (meName || p.name || p.identity || localStorage.getItem('ponoi_username') || '?') : (p.name || p.identity || '?')
  return (
    <div className="c2-bub" onContextMenu={!isLocal && onCtx ? e => { e.preventDefault(); onCtx(p, String(name), avatar, e.clientX, e.clientY) } : undefined}>
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
function Tile({ p, isLocal, avatar, color, small, meName, onCtx }: { p: any; isLocal: boolean; avatar?: string | null; color?: string | null; small?: boolean; meName?: string; onCtx?: CtxOpener }) {
  const vidRef = useRef<HTMLDivElement>(null)
  const [hasCam, setHasCam] = useState(false)
  const [vidHidden, setVidHidden] = useState(() => isVideoHidden(p.identity))
  const { speaking, micOn } = useSpeakMic(p)
  useEffect(() => {
    const l = () => setVidHidden(isVideoHidden(p.identity))
    hiddenVideoListeners.add(l)
    return () => { hiddenVideoListeners.delete(l) }
  }, [p.identity])
  useEffect(() => {
    const host = vidRef.current!
    let attached: HTMLElement[] = []
    function refresh() {
      attached.forEach(e => e.remove()); attached = []
      let cam = false
      p.trackPublications.forEach((pub: any) => {
        const t = pub.track
        if (!t || t.kind !== 'video' || pub.source !== 'camera') return
        cam = true
        if (isVideoHidden(p.identity)) return   // отключено у себя из меню — трек не рендерим
        const el = t.attach(); el.classList.add('c2-media'); host.appendChild(el); attached.push(el)
      })
      setHasCam(cam)
    }
    refresh()
    const evs = ['trackSubscribed', 'trackUnsubscribed', 'trackMuted', 'trackUnmuted',
      'trackPublished', 'trackUnpublished', 'localTrackPublished', 'localTrackUnpublished']
    evs.forEach(e => p.on(e, refresh))
    return () => { evs.forEach(e => p.off(e, refresh)); attached.forEach(e => e.remove()) }
  }, [p, vidHidden])
  const name = isLocal ? (meName || p.name || p.identity || localStorage.getItem('ponoi_username') || '?') : (p.name || p.identity || '?')
  const showCam = hasCam && !vidHidden
  return (
    <div className={'c2-tile' + (speaking ? ' speaking' : '') + (showCam ? ' cam' : '') + (isLocal ? ' local' : '')} style={!showCam && color ? { background: color } : undefined}
      onContextMenu={!isLocal && onCtx ? e => { e.preventDefault(); onCtx(p, String(name), avatar, e.clientX, e.clientY) } : undefined}>
      <div className="c2-vid" ref={vidRef} />
      {!showCam && <div className="c2-tile-av"><Avatar name={String(name)} url={avatar} size={small ? 44 : 72} /></div>}
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
function Stage({ room, avatars, colors, meName, onMainDblClick, onCtx }: { room: Room; avatars: Record<string, string | null>; colors: Record<string, string | null>; meName?: string; onMainDblClick?: () => void; onCtx?: CtxOpener }) {
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
      if (pub.source === 'screen_share' && pub.track) shares.push({ pub, who: local ? (meName || p.name || p.identity || localStorage.getItem('ponoi_username') || '?') : (p.name || p.identity || '?'), key: 'sh:' + (pub.trackSid || p.sid || '') })
      if (pub.source === 'camera' && pub.track) anyCam = true
    })
  })

  const av = (p: any) => avatars[p.identity] ?? null
  const col = (p: any) => colors[p.identity] ?? null

  // Голосовой режим: кружочки-аватарки по центру, как звонок в Discord.
  if (!shares.length && !anyCam) return (
    <div className="c2-bubbles">
      {all.map(({ p, local }) => <Bubble key={p.sid || p.identity} p={p} isLocal={local} avatar={av(p)} meName={meName} onCtx={onCtx} />)}
    </div>
  )

  // v1.78.0: фокус как в Discord — кликом разворачивается не только демка,
  // но и любой участник; клик по главной плитке возвращает обратно.
  const pKey = (p: any) => 'p:' + String(p.sid || p.identity)
  const focusedShare = focus && focus.startsWith('sh:') ? shares.find(s => s.key === focus) ?? null : null
  const focusedPart = focus && focus.startsWith('p:') ? all.find(x => pKey(x.p) === focus) ?? null : null
  const mainShare = focusedShare ?? (focusedPart ? null : shares[0] ?? null)
  // Камеры без демки и без фокуса: сетка плиток, клик по плитке — развернуть.
  if (!mainShare && !focusedPart) return (
    <div className="c2-board">
      <div className="c2-grid">
        {all.map(({ p, local }) => <div key={p.sid || p.identity} className="c2-click" onClick={() => setFocus(pKey(p))}><Tile p={p} isLocal={local} avatar={av(p)} color={col(p)} meName={meName} onCtx={onCtx} /></div>)}
      </div>
    </div>
  )
  // Главная сцена (демка или развёрнутый участник) + лента маленьких плиток снизу.
  return (
    <div className="c2-board">
      <div className="c2-main" onDoubleClick={onMainDblClick}>
        {mainShare
          ? <ShareTile key={mainShare.key} pub={mainShare.pub} who={mainShare.who} onClick={() => { if (focusedShare) setFocus(null) }} />
          : <div className="c2-click" onClick={() => setFocus(null)}><Tile p={focusedPart!.p} isLocal={focusedPart!.local} avatar={av(focusedPart!.p)} color={col(focusedPart!.p)} meName={meName} onCtx={onCtx} /></div>}
      </div>
      <div className="c2-strip">
        {shares.filter(s => s.key !== (mainShare && mainShare.key)).map(s => <ShareTile key={s.key} pub={s.pub} who={s.who} onClick={() => setFocus(s.key)} />)}
        {all.map(({ p, local }) => <div key={p.sid || p.identity} className="c2-click" onClick={() => setFocus(pKey(p))}><Tile p={p} isLocal={local} avatar={av(p)} color={col(p)} small meName={meName} onCtx={onCtx} /></div>)}
      </div>
    </div>
  )
}

export function CallRoom({ room, meId, meName, onLeave, peer, onProfile }:
  { room: Room; meId: string; meName: string; onLeave: () => void; peer?: { name: string; avatarUrl?: string | null } | null
    // v1.183.0: правый клик по участнику — меню как в Discord (профиль/громкость/
    // заглушить у себя/скрыть видео/копировать ID). Профиль открывает родитель
    // (у него уже есть MiniProfile) — CallRoom только сообщает, кого открыть.
    onProfile?: (userId: string, name: string, avatarUrl: string | null | undefined, x: number, y: number) => void }) {
  const { settings } = useSettings()
  const [pctx, setPctx] = useState<{ p: any; name: string; avatar: string | null | undefined; x: number; y: number } | null>(null)
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(false)
  const [screen, setScreen] = useState(false)
  const [deaf, setDeaf] = useState(false)
  const [fs, setFs] = useState(false)
  const [qMenu, setQMenu] = useState(false)
  const [devMenu, setDevMenu] = useState<null | 'mic' | 'cam'>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [sq, setSq] = useState<{ res: string; fps: number }>(() => {
    // v1.113.0: одноразовая миграция — качество демонстрации по умолчанию теперь 4K.
    const mig = localStorage.getItem('ponoi_mig_113_4k')
    try { const s = JSON.parse(localStorage.getItem('ponoi_share_q') || '{}'); if (s.res && s.fps && mig) return s } catch {}
    localStorage.setItem('ponoi_mig_113_4k', '1')
    return { res: '4K', fps: 30 }
  })
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const [count, setCount] = useState(1)
  const [showSb, setShowSb] = useState(false)
  const [flash, setFlash] = useState(false)
  const [idle, setIdle] = useState(false)
  const micBeforeDeaf = useRef(true)
  const recRef = useRef<CallRecorder | null>(null)
  const [avatars, setAvatars] = useState<Record<string, string | null>>({})
  const [colors, setColors] = useState<Record<string, string | null>>({})

  // Аватарки участников из profiles: identity — это id (или юзернейм) пользователя.
  useEffect(() => {
    let ok = true
    async function load() {
      const ps: any[] = [room.localParticipant, ...Array.from((room as any).remoteParticipants?.values?.() ?? [])]
      const ids = ps.map(p => String(p.identity || '')).filter(Boolean)
      const uu = ids.filter(x => UUID_RE.test(x))
      const nn = ids.filter(x => !UUID_RE.test(x))
      const map: Record<string, string | null> = {}
      const cmap: Record<string, string | null> = {}
      try {
        if (uu.length) {
          const { data } = await supabase.from('profiles').select('id,avatar_url,avatar_color').in('id', uu)
          for (const r of (data ?? []) as any[]) { map[r.id] = r.avatar_url; cmap[r.id] = r.avatar_color }
        }
        if (nn.length) {
          const { data } = await supabase.from('profiles').select('username,avatar_url,avatar_color').in('username', nn)
          for (const r of (data ?? []) as any[]) { map[r.username] = r.avatar_url; cmap[r.username] = r.avatar_color }
        }
      } catch {}
      if (ok) { setAvatars(m => ({ ...m, ...map })); setColors(m => ({ ...m, ...cmap })) }
    }
    load()
    const re = () => load()
    room.on(RoomEvent.ParticipantConnected, re)
    return () => { ok = false; room.off(RoomEvent.ParticipantConnected, re) }
  }, [room])

  useEffect(() => {
    // Возврат в чат со звонком не должен сбрасывать микрофон/камеру — восстанавливаем.
    const lp: any = room.localParticipant
    if (!(room as any).__ponoiInit) {
      ;(room as any).__ponoiInit = true
      lp.setMicrophoneEnabled(true).then(() => setMic(true))
    } else {
      setMic(lp.isMicrophoneEnabled !== false)
      setCam(!!lp.isCameraEnabled)
      setScreen(!!lp.isScreenShareEnabled)
      try { setDeaf(master().gain.value === 0) } catch {}
    }
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
    // v1.150.0: раньше окончательный обрыв связи (LiveKit исчерпал реконнекты,
    // сервер закрыл сессию, истёк токен) никак не обрабатывался — экран звонка
    // замирал в «Переподключение…» навсегда. CLIENT_INITIATED — это наш же
    // leave(), там onLeave() уже вызван явно, здесь не дублируем и не пугаем тостом.
    const onDisc = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return
      toastErr('Звонок прерван — соединение потеряно')
      onLeave()
    }
    room.on(RoomEvent.Disconnected, onDisc)
    return () => {
      room.off(RoomEvent.Connected, onConn)
      room.off(RoomEvent.Reconnecting, onRec)
      room.off(RoomEvent.Reconnected, onRecd)
      room.off(RoomEvent.ParticipantConnected, onPJoin)
      room.off(RoomEvent.ParticipantDisconnected, onPLeave)
      room.off(RoomEvent.LocalTrackUnpublished, onLocalUnpub)
      room.off(RoomEvent.Disconnected, onDisc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  // v1.150.0: браузер/Electron иногда блокирует автовоспроизведение аудио удалённых
  // участников (нет предшествующего пользовательского жеста — например, звонок
  // открылся из уведомления). Раньше это происходило молча — звук просто не играл.
  const [audioBlocked, setAudioBlocked] = useState(false)
  useEffect(() => {
    const check = () => setAudioBlocked(!room.canPlaybackAudio)
    check()
    room.on(RoomEvent.AudioPlaybackStatusChanged, check)
    return () => { room.off(RoomEvent.AudioPlaybackStatusChanged, check) }
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

  // v1.78.0: как в Discord — «заглушить всех» глушит и твой микрофон,
  // а включение микрофона при заглушке сначала снимает её.
  async function toggleMic() {
    if (deaf) {
      try { master().gain.value = 1 } catch {}
      setDeaf(false)
      try { await room.localParticipant.setMicrophoneEnabled(true) } catch {}
      setMic(true); sndUnmute()
      return
    }
    const v = !mic; await room.localParticipant.setMicrophoneEnabled(v); setMic(v); v ? sndUnmute() : sndMute()
  }
  async function toggleDeaf() {
    const v = !deaf
    try { master().gain.value = v ? 0 : 1 } catch {}
    if (v) {
      micBeforeDeaf.current = mic
      if (mic) { try { await room.localParticipant.setMicrophoneEnabled(false) } catch {}; setMic(false) }
    } else if (micBeforeDeaf.current && !mic) {
      try { await room.localParticipant.setMicrophoneEnabled(true) } catch {}
      setMic(true)
    }
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
      // v1.64.0: contentHint подсказывает браузеру, что важнее (чёткость/плавность),
      // simulcast выключен — зритель всегда получает полное разрешение.
      // v1.80.0: демка как в Discord — системный звук в чистом стерео без
      // «улучшайзеров» (иначе музыка/игра звучат глухо и тихо), дорожка демки
      // с высоким приоритетом — при слабой сети страдает камера, а не демка.
      // v1.113.0: реальное 4K — до 60 FPS чёткость важнее плавности (contentHint
      // 'detail'), и браузеру запрещено снижать разрешение под нагрузкой
      // (degradationPreference: maintain-resolution) — лучше потерять кадры, чем мыло.
      await (room.localParticipant as any).setScreenShareEnabled(true,
        { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
          systemAudio: 'include',
          resolution: { width: r.w, height: r.h, frameRate: sq.fps },
          contentHint: sq.fps >= 60 ? 'motion' : 'detail' },
        { screenShareEncoding: { maxBitrate: r.br, maxFramerate: sq.fps, priority: 'high' }, degradationPreference: 'maintain-resolution', simulcast: false })
      setScreen(true)
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  async function stopShare() {
    try { await room.localParticipant.setScreenShareEnabled(false) } catch {}
    setScreen(false)
  }
  function leave() { room.disconnect(); onLeave() }

  // ---- v1.43.0: состояние звонка наружу (панель в сайдбаре, MeBar) + команды оттуда. ----
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ponoi-call-state', { detail: { mic, deaf, cam, screen, connected: status === 'connected' } }))
  }, [mic, deaf, cam, screen, status])
  useEffect(() => {
    const h = (e: Event) => {
      const what = (e as CustomEvent).detail?.what
      if (what === 'mic') toggleMic()
      else if (what === 'deaf') toggleDeaf()
      else if (what === 'cam') toggleCam()
      else if (what === 'screen') { screen ? stopShare() : startShare() }
    }
    window.addEventListener('ponoi-call-toggle', h)
    return () => window.removeEventListener('ponoi-call-toggle', h)
  })

  // v1.78.0: горячие клавиши как в Discord — Ctrl+Shift+M (микрофон),
  // Ctrl+Shift+D (заглушить всех), Esc — выход из полноэкранного режима.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') { e.preventDefault(); toggleMic() }
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); toggleDeaf() }
      else if (e.key === 'Escape' && fs) setFs(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // v1.78.0: в полноэкранном режиме панель и шапка прячутся, если мышь замерла.
  useEffect(() => {
    if (!fs) { setIdle(false); return }
    let t = window.setTimeout(() => setIdle(true), 3000)
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 3000) }
    window.addEventListener('mousemove', wake)
    return () => { window.clearTimeout(t); window.removeEventListener('mousemove', wake) }
  }, [fs])

  // Выбор микрофона/камеры — как стрелочки у кнопок в Discord.
  async function openDev(kind: 'mic' | 'cam') {
    setQMenu(false)
    try {
      const list = await (Room as any).getLocalDevices(kind === 'mic' ? 'audioinput' : 'videoinput', true)
      setDevices((list ?? []).filter((d: MediaDeviceInfo) => d.deviceId))
    } catch { setDevices([]) }
    setDevMenu(kind)
  }
  async function pickDev(id: string) {
    const kind = devMenu === 'mic' ? 'audioinput' : 'videoinput'
    try {
      await (room as any).switchActiveDevice(kind, id)
      try { localStorage.setItem('ponoi_dev_' + devMenu, id) } catch {}
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    setDevMenu(null)
  }

  const alone = status === 'connected' && count <= 1
  const statusLabel = status === 'reconnecting' ? 'Переподключение…'
    : status === 'connecting' ? 'Соединение…'
    : alone && peer ? 'Звоним ' + peer.name + '…' : 'Голосовой звонок'

  return (
    <div className={'c2-wrap' + (fs ? ' fs' : '') + (fs && idle ? ' idle' : '') + (flash ? ' sb-flash' : '') + (alone && peer ? ' ringing' : '')}>
      <Sinks room={room} />
      <div className="c2-top">
        <span className={'c2-status ' + (alone && peer ? 'connecting' : status)}><i />{statusLabel}</span>
        <span className="c2-cnt"><Icon name="users" size={14} /> {count}</span>
        {flash && <span className="c2-flashtag"><Icon name="soundboard" size={13} /> Момент сохранён</span>}
        <div className="c2-topbtns">
          <button title={fs ? 'Свернуть' : 'На весь экран'} onClick={() => setFs(f => !f)}><Icon name={fs ? 'shrink' : 'expand'} size={16} /></button>
        </div>
      </div>
      <Stage room={room} avatars={avatars} colors={colors} meName={meName} onMainDblClick={() => setFs(f => !f)}
        onCtx={(p, name, avatar, x, y) => setPctx({ p, name, avatar, x, y })} />
      {alone && peer && <div className="c2-waiting">{'Ждём ответа — ' + peer.name + '…'}</div>}
      {audioBlocked && <button className="c2-audio-blocked" onClick={() => room.startAudio().catch(() => {})}>
        <Icon name="volume" size={14} /> Браузер заблокировал звук — нажми, чтобы включить
      </button>}
      {showSb && <Soundboard room={room} recorder={recRef.current} meId={meId} meName={meName} onClose={() => setShowSb(false)} />}
      {pctx && <PartCtxMenu identity={pctx.p.identity} x={pctx.x} y={pctx.y} onClose={() => setPctx(null)}
        onProfile={onProfile ? () => onProfile(pctx.p.identity, pctx.name, pctx.avatar, pctx.x, pctx.y) : undefined} />}
      <div className="c2-bar">
        <div className="c2-grp">
          <button className={'c2-btn' + (mic ? '' : ' lit')} onClick={toggleMic} title={mic ? 'Выключить микрофон' : 'Включить микрофон'}><Icon name={mic ? 'mic' : 'mic-off'} size={20} /></button>
          <button className={'c2-caret' + (devMenu === 'mic' ? ' on' : '')} title="Выбрать микрофон" onClick={() => devMenu === 'mic' ? setDevMenu(null) : openDev('mic')}><Icon name="chevron-down" size={14} /></button>
          <span className="c2-grp-sep" />
          <button className={'c2-btn' + (cam ? ' lit' : '')} onClick={toggleCam} title={cam ? 'Выключить камеру' : 'Включить камеру'}><Icon name={cam ? 'video' : 'video-off'} size={20} /></button>
          <button className={'c2-caret' + (devMenu === 'cam' ? ' on' : '')} title="Выбрать камеру" onClick={() => devMenu === 'cam' ? setDevMenu(null) : openDev('cam')}><Icon name="chevron-down" size={14} /></button>
        </div>
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
        <button className={'c2-btn' + (deaf ? ' lit' : '')} onClick={toggleDeaf} title={deaf ? 'Включить звук' : 'Заглушить всех'}><Icon name={deaf ? 'headphones-off' : 'headphones'} size={20} /></button>
        <button className="c2-btn leave" onClick={leave} title="Завершить звонок"><Icon name="phone-off" size={20} /></button>
        {devMenu && <>
          <div className="c2-menu-ov" onClick={() => setDevMenu(null)} />
          <div className="c2-menu c2-devmenu">
            <div className="c2-menu-h">{devMenu === 'mic' ? 'Микрофон' : 'Камера'}</div>
            {devices.length === 0 && <div className="c2-dev-empty">Устройства не найдены — разреши доступ в браузере</div>}
            {devices.map(d => <button key={d.deviceId} className={'c2-dev' + (localStorage.getItem('ponoi_dev_' + devMenu) === d.deviceId ? ' on' : '')} onClick={() => pickDev(d.deviceId)}>{d.label || (devMenu === 'mic' ? 'Микрофон' : 'Камера')}</button>)}
          </div>
        </>}
      </div>
    </div>
  )
}
