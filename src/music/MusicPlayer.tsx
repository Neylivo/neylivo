
import { useEffect, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY, TRACKS_KEY } from './types'
import { idbGet } from '../lib/idb'
import { MusicSettings, loadGif, loadBg } from './MusicSettings'

function loadUrlTracks(): Track[] {
  try { return JSON.parse(localStorage.getItem(TRACKS_KEY) || '[]') } catch { return [] }
}
function saveUrlTracks(list: Track[]) {
  localStorage.setItem(TRACKS_KEY, JSON.stringify(list.filter(t => t.kind === 'url')))
}
function fmt(s: number) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60), ss = Math.floor(s % 60)
  return m + ':' + String(ss).padStart(2, '0')
}

export function MusicPlayer({ me, onClose }: { me: string; onClose: () => void }) {
  const [tracks, setTracks] = useState<Track[]>(loadUrlTracks)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [settings, setSettings] = useState(false)
  const [gif, setGif] = useState(loadGif())
  const [bg, setBg] = useState<BgCfg>(loadBg())
  const [bgUrl, setBgUrl] = useState<string>('')
  const [curT, setCurT] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(() => Number(localStorage.getItem('ponoi_mus_vol') || '100'))
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cur = tracks[idx]

  function refreshCfg() { setGif(loadGif()); setBg(loadBg()) }

  useEffect(() => {
    let revoked = ''
    ;(async () => {
      if (bg.type === 'none') { setBgUrl(''); return }
      if (bg.mode === 'url') { setBgUrl(bg.url); return }
      const blob = await idbGet(BG_IDB_KEY)
      if (blob) { const u = URL.createObjectURL(blob); revoked = u; setBgUrl(u) }
    })()
    return () => { if (revoked) URL.revokeObjectURL(revoked) }
  }, [bg.type, bg.mode, bg.url, bg.ver])

  useEffect(() => {
    const a = audioRef.current; if (!a) return
    if (playing) a.play().catch(() => {}); else a.pause()
  }, [playing, idx])

  useEffect(() => { const a = audioRef.current; if (a) a.volume = vol / 100; localStorage.setItem('ponoi_mus_vol', String(vol)) }, [vol])

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? [])
    const add: Track[] = fs.map((f, i) => ({ id: Date.now() + '_' + i, url: URL.createObjectURL(f), name: f.name.replace(/\.[^.]+$/, ''), owner: me, kind: 'file' }))
    setTracks(t => [...t, ...add])
    if (fileRef.current) fileRef.current.value = ''
  }

  function addUrl() {
    const url = prompt('URL аудио (mp3/ogg…)')?.trim(); if (!url) return
    const name = prompt('Название трека')?.trim() || url.split('/').pop() || 'Трек'
    setTracks(t => { const n = [...t, { id: 'u_' + Date.now(), url, name, owner: me, kind: 'url' as const }]; saveUrlTracks(n); return n })
  }

  function removeTrack(id: string) {
    setTracks(t => { const n = t.filter(x => x.id !== id); saveUrlTracks(n); return n })
    setIdx(i => Math.max(0, Math.min(i, tracks.length - 2)))
  }

  const next = () => setIdx(i => (i + 1) % Math.max(tracks.length, 1))
  const prev = () => setIdx(i => (i - 1 + tracks.length) % Math.max(tracks.length, 1))

  const showLeft = gif.url && (gif.pos === 'left' || gif.pos === 'both')
  const showRight = gif.url && (gif.pos === 'right' || gif.pos === 'both')

  return (
    <main className={'mus-full' + (bg.type !== 'none' && bgUrl ? ' hasbg' : '')}>
      {bg.type !== 'none' && bgUrl && <>
        {bg.type === 'video'
          ? <video className="musbg" src={bgUrl} autoPlay loop muted playsInline />
          : <div className="musbg" style={{ backgroundImage: `url(${bgUrl})` }} />}
        <div className="musbg-dim" style={{ opacity: bg.dim / 100 }} />
      </>}

      <header className="mus-head">
        <b>🎵 Ponoi Music</b>
        <div className="mus-head-r">
          <button title="Настройки" onClick={() => setSettings(true)}>⚙</button>
          <button title="Закрыть" onClick={onClose}>✕</button>
        </div>
      </header>

      <div className="mus-stage">
        {showLeft && <img className="mus-gif l" src={gif.url} alt="" />}
        <div className="mus-center">
          <div className="mus-disc" data-spin={playing}>💿</div>
          <div className="mus-now">{cur ? cur.name : 'Нет трека'}</div>
          <div className="mus-artist">{cur ? (cur.kind === 'url' ? 'по ссылке' : 'локальный файл') : 'Добавь трек ниже'}</div>

          <div className="mus-seek">
            <span>{fmt(curT)}</span>
            <input type="range" min={0} max={dur || 0} step={0.1} value={curT}
              onChange={e => { const a = audioRef.current; if (a) { a.currentTime = +e.target.value; setCurT(+e.target.value) } }} disabled={!cur} />
            <span>{fmt(dur)}</span>
          </div>

          <div className="mus-ctl">
            <button onClick={prev} disabled={!tracks.length}>⏮</button>
            <button className="big" onClick={() => setPlaying(p => !p)} disabled={!tracks.length}>{playing ? '⏸' : '▶'}</button>
            <button onClick={next} disabled={!tracks.length}>⏭</button>
          </div>

          <div className="mus-vol">🔊 <input type="range" min={0} max={100} value={vol} onChange={e => setVol(+e.target.value)} /></div>

          <div className="mus-addrow">
            <button className="mus-add" onClick={() => fileRef.current?.click()}>＋ Файлы</button>
            <button className="mus-add" onClick={addUrl}>🔗 По URL</button>
          </div>
          <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />

          <div className="mus-list">
            {tracks.map((t, i) => (
              <div key={t.id} className={'mus-li' + (i === idx ? ' on' : '')} onClick={() => { setIdx(i); setPlaying(true) }}>
                <span className="mus-li-n">{i === idx && playing ? '🎶 ' : ''}{t.name}</span>
                <span className="mus-li-del" title="Убрать" onClick={e => { e.stopPropagation(); removeTrack(t.id) }}>✕</span>
              </div>
            ))}
            {!tracks.length && <div className="mut" style={{ padding: 10, textAlign: 'center' }}>Очередь пуста</div>}
          </div>
        </div>
        {showRight && <img className="mus-gif r" src={gif.url} alt="" />}
      </div>

      <audio ref={audioRef} src={cur?.url}
        onEnded={next}
        onTimeUpdate={e => setCurT((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration)} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} />}
    </main>
  )
}
