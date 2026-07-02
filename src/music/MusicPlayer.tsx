import { useEffect, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY } from './types'
import { idbGet } from '../lib/idb'
import { MusicSettings, loadGif, loadBg } from './MusicSettings'

// NOTE: device-uploaded tracks use object URLs (не переживают перезагрузку).
// The `owner` field keeps the shape backend-ready for later server-side track storage.
export function MusicPlayer({ me, onClose }: { me: string; onClose: () => void }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [settings, setSettings] = useState(false)
  const [gif, setGif] = useState(loadGif())
  const [bg, setBg] = useState<BgCfg>(loadBg())
  const [bgUrl, setBgUrl] = useState<string>('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cur = tracks[idx]

  function refreshCfg() { setGif(loadGif()); setBg(loadBg()) }

  // resolve background source (url or IndexedDB blob)
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

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? [])
    const add: Track[] = fs.map((f, i) => ({ id: Date.now() + '_' + i, url: URL.createObjectURL(f), name: f.name.replace(/\.[^.]+$/, ''), owner: me }))
    setTracks(t => [...t, ...add])
    if (fileRef.current) fileRef.current.value = ''
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
          <div className="mus-ctl">
            <button onClick={prev} disabled={!tracks.length}>⏮</button>
            <button className="big" onClick={() => setPlaying(p => !p)} disabled={!tracks.length}>{playing ? '⏸' : '▶'}</button>
            <button onClick={next} disabled={!tracks.length}>⏭</button>
          </div>
          <button className="mus-add" onClick={() => fileRef.current?.click()}>＋ Добавить треки</button>
          <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />
          <div className="mus-list">
            {tracks.map((t, i) => (
              <div key={t.id} className={'mus-li' + (i === idx ? ' on' : '')} onClick={() => { setIdx(i); setPlaying(true) }}>
                {i === idx && playing ? '🎶 ' : ''}{t.name}
              </div>
            ))}
          </div>
        </div>
        {showRight && <img className="mus-gif r" src={gif.url} alt="" />}
      </div>

      <audio ref={audioRef} src={cur?.url} onEnded={next} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} />}
    </main>
  )
}
