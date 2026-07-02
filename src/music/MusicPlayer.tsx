import { useEffect, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY, TRACKS_KEY } from './types'
import { idbGet } from '../lib/idb'
import { supabase } from '../lib/supabase'
import { MusicSettings, loadGif, loadBg } from './MusicSettings'

const PLAYLISTS_KEY = 'ponoi_mus_playlists_v1'
interface Playlist { id: string; name: string; trackIds: string[] }

function loadUrlTracks(): Track[] {
  try { return JSON.parse(localStorage.getItem(TRACKS_KEY) || '[]') } catch { return [] }
}
function saveUrlTracks(list: Track[]) {
  localStorage.setItem(TRACKS_KEY, JSON.stringify(list.filter(t => t.kind === 'url')))
}
function loadPlaylists(): Playlist[] {
  try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]') } catch { return [] }
}
function savePlaylists(p: Playlist[]) { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(p)) }
function fmt(s: number) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60), ss = Math.floor(s % 60)
  return m + ':' + String(ss).padStart(2, '0')
}
function isSoundcloud(u: string) { return /soundcloud\.com/i.test(u) }

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
  const [tab, setTab] = useState<'queue' | 'playlists'>('queue')
  const [scUrl, setScUrl] = useState('')
  const [qFilter, setQFilter] = useState('')
  const [showLib, setShowLib] = useState(false)
  const [libQ, setLibQ] = useState('')
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists)
  const [together, setTogether] = useState<{ code: string; host: boolean } | null>(null)
  const [togetherUi, setTogetherUi] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const togChan = useRef<any>(null)

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

  // ---- listen together (broadcast sync via supabase realtime) ----
  useEffect(() => {
    if (!together) { if (togChan.current) { supabase.removeChannel(togChan.current); togChan.current = null } return }
    const ch = supabase.channel('together:' + together.code)
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (together.host) return
      if (typeof payload.idx === 'number') setIdx(payload.idx)
      setPlaying(!!payload.playing)
      const a = audioRef.current
      if (a && typeof payload.t === 'number' && Math.abs(a.currentTime - payload.t) > 2) a.currentTime = payload.t
    })
    ch.subscribe()
    togChan.current = ch
    return () => { supabase.removeChannel(ch); togChan.current = null }
  }, [together])

  useEffect(() => {
    if (together?.host && togChan.current) {
      togChan.current.send({ type: 'broadcast', event: 'state', payload: { idx, playing, t: audioRef.current?.currentTime ?? 0 } })
    }
  }, [idx, playing, together])

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? [])
    const add: Track[] = fs.map((f, i) => ({ id: Date.now() + '_' + i, url: URL.createObjectURL(f), name: f.name.replace(/\.[^.]+$/, ''), owner: me, kind: 'file' }))
    setTracks(t => [...t, ...add])
    if (fileRef.current) fileRef.current.value = ''
  }

  function addSoundcloud() {
    const url = scUrl.trim(); if (!url) return
    const name = decodeURIComponent(url.split('/').filter(Boolean).pop() || 'Трек').replace(/[-_]/g, ' ')
    setTracks(t => { const n = [...t, { id: 'u_' + Date.now(), url, name, owner: me, kind: 'url' as const }]; saveUrlTracks(n); return n })
    setScUrl('')
  }

  function removeTrack(id: string) {
    setTracks(t => { const n = t.filter(x => x.id !== id); saveUrlTracks(n); return n })
    setIdx(i => Math.max(0, Math.min(i, tracks.length - 2)))
  }

  const next = () => {
    if (repeat === 'one') { const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}) } return }
    setIdx(i => {
      if (shuffle && tracks.length > 1) { let n = i; while (n === i) n = Math.floor(Math.random() * tracks.length); return n }
      const n = i + 1
      if (n >= tracks.length) return repeat === 'all' ? 0 : i
      return n
    })
  }
  const prev = () => setIdx(i => (i - 1 + tracks.length) % Math.max(tracks.length, 1))

  function addToPlaylist(trackId: string) {
    const name = prompt('Название плейлиста (существующее или новое)')?.trim(); if (!name) return
    setPlaylists(ps => {
      const found = ps.find(p => p.name === name)
      let n: Playlist[]
      if (found) n = ps.map(p => p.id === found.id ? { ...p, trackIds: [...new Set([...p.trackIds, trackId])] } : p)
      else n = [...ps, { id: 'pl_' + Date.now(), name, trackIds: [trackId] }]
      savePlaylists(n); return n
    })
  }
  function startTogether() {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    setTogether({ code, host: true }); setTogetherUi(false)
  }
  function joinTogether() {
    const code = prompt('Код совместного прослушивания')?.trim().toUpperCase(); if (!code) return
    setTogether({ code, host: false }); setTogetherUi(false)
  }

  const showLeft = gif.url && (gif.pos === 'left' || gif.pos === 'both')
  const showRight = gif.url && (gif.pos === 'right' || gif.pos === 'both')
  const filteredQueue = qFilter ? tracks.filter(t => t.name.toLowerCase().includes(qFilter.toLowerCase())) : tracks

  return (
    <main className={'mus2' + (bg.type !== 'none' && bgUrl ? ' hasbg' : '')}>
      {bg.type !== 'none' && bgUrl && <>
        {bg.type === 'video'
          ? <video className="musbg" src={bgUrl} autoPlay loop muted playsInline />
          : <div className="musbg" style={{ backgroundImage: `url(${bgUrl})` }} />}
        <div className="musbg-dim" style={{ opacity: bg.dim / 100 }} />
      </>}

      <header className="mus2-top">
        <div className="mus2-brand"><span className="mus2-logo">🎵</span> <b>Музыка</b></div>
        <div className="mus2-topr">
          <button title="Настройки" onClick={() => setSettings(true)}>⚙</button>
          <button title="Тема" onClick={() => document.documentElement.classList.toggle('mus-light')}>🌙</button>
          <button title="Закрыть" onClick={onClose}>✕</button>
        </div>
      </header>

      <div className="mus2-body">
        <aside className="mus2-side">
          <div className="mus2-sidehead">
            <span className="mus2-title">Ponoi Music</span>
            <div className="mus2-tabs">
              <button className={'mus2-tab' + (tab === 'queue' ? ' on' : '')} onClick={() => setTab('queue')}>Очередь</button>
              <button className={'mus2-tab' + (tab === 'playlists' ? ' on' : '')} onClick={() => setTab('playlists')}>Плейлисты</button>
            </div>
          </div>

          <div className="mus2-addrow">
            <input className="mus2-in" placeholder="Ссылка SoundCloud (трек или плейлист)…" value={scUrl}
              onChange={e => setScUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSoundcloud() }} />
            <button className="mus2-addbtn" onClick={addSoundcloud}>Добавить</button>
          </div>
          <div className="mus2-addrow">
            <input className="mus2-in" placeholder="🔎 Найти трек в очереди…" value={qFilter} onChange={e => setQFilter(e.target.value)} />
            <button className="mus2-libbtn" onClick={() => setShowLib(true)}>Трекотека</button>
          </div>

          {tab === 'queue' ? <>
            <div className="mus2-sec">ТЕКУЩАЯ ОЧЕРЕДЬ <button className="mus2-filebtn" title="Добавить файлы" onClick={() => fileRef.current?.click()}>＋</button></div>
            <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />
            <div className="mus2-list">
              {filteredQueue.length === 0 && <div className="mus2-empty">Пусто. Вставь ссылку SoundCloud, чтобы добавить трек.</div>}
              {filteredQueue.map((t) => {
                const i = tracks.indexOf(t)
                return (
                  <div key={t.id} className={'mus2-li' + (i === idx ? ' on' : '')} onClick={() => { setIdx(i); setPlaying(true) }}>
                    <span className="mus2-li-n">{i === idx && playing ? '🎶 ' : ''}{t.name}</span>
                    <span className="mus2-li-add" title="В плейлист" onClick={e => { e.stopPropagation(); addToPlaylist(t.id) }}>＋</span>
                    <span className="mus2-li-del" title="Убрать" onClick={e => { e.stopPropagation(); removeTrack(t.id) }}>✕</span>
                  </div>
                )
              })}
            </div>
          </> : <>
            <div className="mus2-sec">ПЛЕЙЛИСТЫ</div>
            <div className="mus2-list">
              {playlists.length === 0 && <div className="mus2-empty">Нет плейлистов. Добавляй треки из очереди кнопкой ＋.</div>}
              {playlists.map(p => (
                <div key={p.id} className="mus2-pl">
                  <div className="mus2-pl-h">
                    <b>{p.name}</b> <span className="mut">{p.trackIds.length} трек.</span>
                    <span className="mus2-li-del" title="Удалить" onClick={() => { const n = playlists.filter(x => x.id !== p.id); setPlaylists(n); savePlaylists(n) }}>✕</span>
                  </div>
                  {p.trackIds.map(tid => { const t = tracks.find(x => x.id === tid); if (!t) return null
                    return <div key={tid} className="mus2-pl-t" onClick={() => { const i = tracks.indexOf(t); setIdx(i); setPlaying(true) }}>{t.name}</div> })}
                </div>
              ))}
            </div>
          </>}
        </aside>

        <section className="mus2-now">
          {showLeft && <img className="mus-gif l" src={gif.url} alt="" />}
          <div className="mus2-art">{cur ? '🎵' : <span className="mus2-note">♫</span>}</div>
          <div className="mus2-nowt">{cur ? cur.name : 'Ничего не играет'}</div>
          <div className="mus2-nowsub">{cur ? (isSoundcloud(cur.url) ? 'SoundCloud' : cur.kind === 'url' ? 'по ссылке' : 'локальный файл') : 'Добавь трек, чтобы начать'}</div>
          {together && <div className="mus2-together-badge">👥 Вместе · код {together.code} {together.host ? '(хост)' : ''}</div>}
          {showRight && <img className="mus-gif r" src={gif.url} alt="" />}
        </section>
      </div>

      <footer className="mus2-bar">
        <div className="mus2-seek">
          <span>{fmt(curT)}</span>
          <input type="range" min={0} max={dur || 0} step={0.1} value={curT}
            onChange={e => { const a = audioRef.current; if (a) { a.currentTime = +e.target.value; setCurT(+e.target.value) } }} disabled={!cur} />
          <span>{fmt(dur)}</span>
        </div>
        <div className="mus2-ctlrow">
          <div className="mus2-vol">🔊 <input type="range" min={0} max={100} value={vol} onChange={e => setVol(+e.target.value)} /></div>
          <div className="mus2-ctl">
            <button className={shuffle ? 'on' : ''} title="Перемешать" onClick={() => setShuffle(s => !s)}>🔀</button>
            <button title="Предыдущий" onClick={prev} disabled={!tracks.length}>⏮</button>
            <button className="big" onClick={() => setPlaying(p => !p)} disabled={!tracks.length}>{playing ? '⏸' : '▶'}</button>
            <button title="Следующий" onClick={next} disabled={!tracks.length}>⏭</button>
            <button className={repeat !== 'off' ? 'on' : ''} title={'Повтор: ' + repeat} onClick={() => setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')}>{repeat === 'one' ? '🔂' : '🔁'}</button>
          </div>
          <div className="mus2-extra">
            <button className="mus2-inpl" onClick={() => cur && addToPlaylist(cur.id)} disabled={!cur}>＋ В плейлист</button>
            <div className="mus2-together-wrap">
              <button className="mus2-tog" onClick={() => setTogetherUi(u => !u)}>👥 Вместе {together ? '•' : '＋'}</button>
              {togetherUi && <div className="mus2-tog-pop" onMouseLeave={() => setTogetherUi(false)}>
                {together ? <>
                  <div className="mus2-tog-code">Код: <b>{together.code}</b></div>
                  <button onClick={() => { navigator.clipboard?.writeText(together.code) }}>Копировать код</button>
                  <button onClick={() => setTogether(null)}>Выйти</button>
                </> : <>
                  <button onClick={startTogether}>Создать сессию</button>
                  <button onClick={joinTogether}>Войти по коду</button>
                </>}
              </div>}
            </div>
          </div>
        </div>
      </footer>

      {showLib && <div className="mus2-lib" onClick={() => setShowLib(false)}>
        <div className="mus2-lib-inner" onClick={e => e.stopPropagation()}>
          <header className="mus2-lib-head">
            <b>Ponoi Music · Трекотека</b>
            <input className="mus2-in" placeholder="🔎 Поиск по названию или исполнителю…" value={libQ} onChange={e => setLibQ(e.target.value)} />
            <button className="mus2-lib-x" onClick={() => setShowLib(false)}>✕</button>
          </header>
          <div className="mus2-lib-body">
            {tracks.length === 0
              ? <div className="mus2-empty center">Очередь пуста. Добавь треки или разверни плейлист SoundCloud.</div>
              : tracks.filter(t => t.name.toLowerCase().includes(libQ.toLowerCase())).map(t => {
                  const i = tracks.indexOf(t)
                  return <div key={t.id} className="mus2-lib-row" onClick={() => { setIdx(i); setPlaying(true); setShowLib(false) }}>{t.name}</div>
                })}
          </div>
        </div>
      </div>}

      <audio ref={audioRef} src={cur?.url}
        onEnded={next}
        onTimeUpdate={e => setCurT((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration)} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} />}
    </main>
  )
}
