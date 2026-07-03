import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY } from './types'
import { idbGet } from '../lib/idb'
import { supabase } from '../lib/supabase'
import { uploadTo } from '../lib/storage'
import { fetchTracks, addTrack, removeTrackDb } from '../lib/music'
import { MusicSettings, loadGif, loadBg } from './MusicSettings'
import { Icon } from '../components/icons'
import { isSoundcloudUrl, scMeta, loadWidgetApi, widgetSrc, cleanScUrl, type ScMeta } from './soundcloud'
import { artColor, boost, lighten, scale, rgb, type Rgb } from './artColor'

const PLAYLISTS_KEY = 'ponoi_mus_playlists_v1'
interface Playlist { id: string; name: string; trackIds: string[] }

function loadPlaylists(): Playlist[] {
  try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]') } catch { return [] }
}
function savePlaylists(p: Playlist[]) { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(p)) }
function fmt(s: number) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60), ss = Math.floor(s % 60)
  return m + ':' + String(ss).padStart(2, '0')
}

export function MusicPlayer({ me, meId, visible, onClose, onStop }:
  { me: string; meId: string; visible: boolean; onClose: () => void; onStop: () => void }) {
  // Shared library ("Трекотека"): tracks live in the music_tracks table, visible
  // to everyone, and anyone can add. Realtime keeps every listener's list in sync.
  const [tracks, setTracks] = useState<Track[]>([])
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
  const [uploading, setUploading] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists)
  const [together, setTogether] = useState<{ code: string; host: boolean } | null>(null)
  const [togetherUi, setTogetherUi] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const togChan = useRef<any>(null)
  const scRef = useRef<HTMLIFrameElement>(null)
  const widgetRef = useRef<any>(null)
  const playingRef = useRef(false)
  const volRef = useRef(100)
  const nextRef = useRef<() => void>(() => {})
  const [meta, setMeta] = useState<Record<string, ScMeta>>({})
  const [color, setColor] = useState<Rgb | null>(null)

  const cur = tracks[idx]
  const curSc = !!cur && isSoundcloudUrl(cur.url)
  const curMeta = cur ? meta[cur.url] : undefined
  const curArt = curMeta?.art ?? null
  // URL, который реально отдаём виджету: каноничный из oEmbed, если он уже известен.
  const scPlayUrl = curSc && cur ? (curMeta?.play || cur.url) : ''
  const acc = color ? boost(color) : null
  const musStyle = acc ? ({
    '--mus-a': rgb(acc),
    '--mus-a2': rgb(lighten(acc)),
    '--mus-a-soft': rgb(acc, .22),
    '--mus-bg1': rgb(scale(acc, .16)),
  } as React.CSSProperties) : undefined

  function refreshCfg() { setGif(loadGif()); setBg(loadBg()) }

  // Initial load + realtime subscription so new tracks appear for everyone live.
  useEffect(() => {
    let ok = true
    fetchTracks().then(t => { if (ok) setTracks(t) })
    const ch = supabase.channel('music_tracks_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'music_tracks' }, () => {
        fetchTracks().then(t => { if (ok) setTracks(t) })
      })
      .subscribe()
    return () => { ok = false; supabase.removeChannel(ch) }
  }, [])

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
    playingRef.current = playing
    if (curSc) {
      audioRef.current?.pause()
      const w = widgetRef.current
      if (w) { if (playing) w.play(); else w.pause() }
      return
    }
    const a = audioRef.current; if (!a) return
    if (playing) a.play().catch(() => {}); else a.pause()
  }, [playing, idx, curSc])

  useEffect(() => {
    volRef.current = vol
    const a = audioRef.current; if (a) a.volume = vol / 100
    widgetRef.current?.setVolume(vol)
    localStorage.setItem('ponoi_mus_vol', String(vol))
  }, [vol])

  // ---- SoundCloud: oEmbed metadata for every SC track in the list ----
  useEffect(() => {
    let ok = true
    const missing = tracks.filter(t => isSoundcloudUrl(t.url) && !meta[t.url])
    if (missing.length === 0) return
    ;(async () => {
      for (const t of missing) {
        const m = await scMeta(t.url)
        if (!ok) return
        if (m) setMeta(prev => ({ ...prev, [t.url]: m }))
      }
    })()
    return () => { ok = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  // ---- Тема под цвет трека: выжимаем доминирующий цвет из обложки ----
  useEffect(() => {
    let ok = true
    const art = cur ? meta[cur.url]?.art : null
    if (!art) { setColor(null); return }
    artColor(art).then(c => { if (ok) setColor(c) })
    return () => { ok = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.url, meta])

  // ---- SoundCloud widget (скрытый iframe) — реальное воспроизведение SC-ссылок ----
  useEffect(() => {
    setCurT(0); setDur(0)
    if (!curSc || !cur) { widgetRef.current = null; return }
    const curUrl = cur.url
    let disposed = false
    let gotDur = false
    // Если виджет молчит 10 секунд — почти всегда его режет блокировщик рекламы.
    const readyTimer = setTimeout(() => {
      if (!disposed && !widgetRef.current) toastErr('SoundCloud не отвечает — отключи блокировщик рекламы (w.soundcloud.com) или попробуй другую ссылку')
    }, 10000)
    ;(async () => {
      try {
        const SC = await loadWidgetApi()
        if (disposed || !scRef.current) return
        const w = SC.Widget(scRef.current)
        w.bind(SC.Widget.Events.READY, () => {
          if (disposed) return
          clearTimeout(readyTimer)
          widgetRef.current = w
          w.setVolume(volRef.current)
          w.getDuration((ms: number) => { if (!disposed && ms > 0) { gotDur = true; setDur(ms / 1000) } })
          w.getCurrentSound((s: any) => {   // запасной источник метаданных, если oEmbed не сработал
            if (disposed || !s) return
            const art = s.artwork_url ? String(s.artwork_url).replace('-large', '-t500x500') : null
            setMeta(prev => prev[curUrl] ? prev : ({ ...prev, [curUrl]: { title: s.title || '', author: s.user?.username || '', art } }))
          })
          if (playingRef.current) w.play()
        })
        w.bind(SC.Widget.Events.PLAY_PROGRESS, (e: any) => {
          if (disposed) return
          setCurT((e?.currentPosition || 0) / 1000)
          if (!gotDur) w.getDuration((ms: number) => { if (!disposed && ms > 0) { gotDur = true; setDur(ms / 1000) } })
        })
        w.bind(SC.Widget.Events.FINISH, () => { if (!disposed) nextRef.current() })
        w.bind(SC.Widget.Events.ERROR, () => { if (!disposed) toastErr('SoundCloud: трек не воспроизводится (закрытый или недоступен для встраивания)') })
      } catch { toastErr('Не удалось загрузить плеер SoundCloud — проверь блокировщик рекламы') }
    })()
    return () => { disposed = true; clearTimeout(readyTimer); widgetRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curSc, scPlayUrl])

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

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? [])
    if (fs.length === 0 || !meId) return
    setUploading(true)
    try {
      for (const f of fs) {
        const url = await uploadTo('attachments', meId, f)   // shared public URL
        await addTrack({ url, name: f.name.replace(/\.[^.]+$/, ''), ownerId: meId, ownerName: me, kind: 'file' })
      }
      setTracks(await fetchTracks())
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function addSoundcloud() {
    const url = cleanScUrl(scUrl); if (!url || !meId) return
    if (!/^https?:\/\//i.test(url)) { toastErr('Вставь полную ссылку (https://…)'); return }
    const m = await scMeta(url)   // настоящее название/автор/обложка через oEmbed
    const name = m?.title || decodeURIComponent(url.split('/').filter(Boolean).pop() || 'Трек').replace(/[-_]/g, ' ')
    if (m) setMeta(prev => ({ ...prev, [url]: m }))
    await addTrack({ url, name, ownerId: meId, ownerName: me, kind: 'url' })
    setScUrl('')
    setTracks(await fetchTracks())
  }

  async function removeTrack(id: string) {
    await removeTrackDb(id)
    setTracks(t => t.filter(x => x.id !== id))
    setIdx(i => Math.max(0, Math.min(i, tracks.length - 2)))
  }

  const next = () => {
    if (repeat === 'one') {
      const w = widgetRef.current
      if (w) { w.seekTo(0); w.play(); return }
      const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}) }
      return
    }
    setIdx(i => {
      if (shuffle && tracks.length > 1) { let n = i; while (n === i) n = Math.floor(Math.random() * tracks.length); return n }
      const n = i + 1
      if (n >= tracks.length) return repeat === 'all' ? 0 : i
      return n
    })
  }
  const prev = () => setIdx(i => (i - 1 + tracks.length) % Math.max(tracks.length, 1))
  nextRef.current = next

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

  return (<>
    <main className={'mus2' + (bg.type !== 'none' && bgUrl ? ' hasbg' : '') + (acc ? ' tinted' : '') + (visible ? '' : ' mus2-hidden')} style={musStyle}>
      {bg.type !== 'none' && bgUrl && <>
        {bg.type === 'video'
          ? <video className="musbg" src={bgUrl} autoPlay loop muted playsInline />
          : <div className="musbg" style={{ backgroundImage: `url(${bgUrl})` }} />}
        <div className="musbg-dim" style={{ opacity: bg.dim / 100 }} />
      </>}

      <header className="mus2-top">
        <div className="mus2-brand"><span className="mus2-logo"><Icon name="music" size={20} /></span> <b>Музыка</b></div>
        <div className="mus2-topr">
          <button title="Настройки" onClick={() => setSettings(true)}><Icon name="gear" size={18} /></button>
          <button title="Закрыть" onClick={onClose}><Icon name="close" size={18} /></button>
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
            <input className="mus2-in" placeholder="Найти трек в очереди…" value={qFilter} onChange={e => setQFilter(e.target.value)} />
            <button className="mus2-libbtn" onClick={() => setShowLib(true)}>Трекотека</button>
          </div>

          {tab === 'queue' ? <>
            <div className="mus2-sec">ТЕКУЩАЯ ОЧЕРЕДЬ <button className="mus2-filebtn" title="Добавить файлы" onClick={() => fileRef.current?.click()}>{uploading ? '…' : <Icon name="plus" size={16} />}</button></div>
            <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />
            <div className="mus2-list">
              {filteredQueue.length === 0 && <div className="mus2-empty">Пусто. Вставь ссылку SoundCloud, чтобы добавить трек.</div>}
              {filteredQueue.map((t) => {
                const i = tracks.indexOf(t)
                return (
                  <div key={t.id} className={'mus2-li' + (i === idx ? ' on' : '')} onClick={() => { setIdx(i); setPlaying(true) }}>
                    <span className="mus2-li-n">{i === idx && playing ? <Icon name="music" size={13} className="mus2-playing-ic" /> : null}{meta[t.url]?.title || t.name}</span>
                    <span className="mus2-li-add" title="В плейлист" onClick={e => { e.stopPropagation(); addToPlaylist(t.id) }}><Icon name="plus" size={14} /></span>
                    <span className="mus2-li-del" title="Убрать" onClick={e => { e.stopPropagation(); removeTrack(t.id) }}><Icon name="close" size={13} /></span>
                  </div>
                )
              })}
            </div>
          </> : <>
            <div className="mus2-sec">ПЛЕЙЛИСТЫ</div>
            <div className="mus2-list">
              {playlists.length === 0 && <div className="mus2-empty">Нет плейлистов. Добавляй треки из очереди кнопкой «плюс».</div>}
              {playlists.map(p => (
                <div key={p.id} className="mus2-pl">
                  <div className="mus2-pl-h">
                    <b>{p.name}</b> <span className="mut">{p.trackIds.length} трек.</span>
                    <span className="mus2-li-del" title="Удалить" onClick={() => { const n = playlists.filter(x => x.id !== p.id); setPlaylists(n); savePlaylists(n) }}><Icon name="close" size={13} /></span>
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
          <div className="mus2-artwrap">
            {curArt && <div className="mus2-artglow" style={{ backgroundImage: `url(${curArt})` }} />}
            <div className={'mus2-vinyl' + (playing ? ' spin' : '')}>{curArt && <img src={curArt} alt="" />}</div>
            <div className="mus2-art">{curArt ? <img src={curArt} alt="" /> : <Icon name="music" size={72} />}</div>
          </div>
          <div className="mus2-nowt">{cur ? (curMeta?.title || cur.name) : 'Ничего не играет'}</div>
          <div className="mus2-nowsub">{cur ? (curSc ? (curMeta?.author ? curMeta.author + ' · SoundCloud' : 'SoundCloud') : cur.kind === 'url' ? 'по ссылке' : 'файл · ' + cur.owner) : 'Добавь трек, чтобы начать'}</div>
          {together && <div className="mus2-together-badge"><Icon name="users" size={14} /> Вместе · код {together.code} {together.host ? '(хост)' : ''}</div>}
          {showRight && <img className="mus-gif r" src={gif.url} alt="" />}
        </section>
      </div>

      <footer className="mus2-bar">
        <div className="mus2-seek">
          <span>{fmt(curT)}</span>
          <input type="range" min={0} max={dur || 0} step={0.1} value={curT}
            onChange={e => { const v = +e.target.value; if (curSc) { widgetRef.current?.seekTo(v * 1000); setCurT(v) } else { const a = audioRef.current; if (a) { a.currentTime = v; setCurT(v) } } }} disabled={!cur} />
          <span>{fmt(dur)}</span>
        </div>
        <div className="mus2-ctlrow">
          <div className="mus2-vol"><Icon name="volume" size={16} /> <input type="range" min={0} max={100} value={vol} onChange={e => setVol(+e.target.value)} /></div>
          <div className="mus2-ctl">
            <button className={shuffle ? 'on' : ''} title="Перемешать" onClick={() => setShuffle(s => !s)}><Icon name="shuffle" size={18} /></button>
            <button title="Предыдущий" onClick={prev} disabled={!tracks.length}><Icon name="skip-back" size={18} /></button>
            <button className="big" onClick={() => setPlaying(p => !p)} disabled={!tracks.length}>{playing ? <Icon name="pause" size={20} /> : <Icon name="play" size={20} />}</button>
            <button title="Следующий" onClick={next} disabled={!tracks.length}><Icon name="skip-forward" size={18} /></button>
            <button className={repeat !== 'off' ? 'on' : ''} title={'Повтор: ' + repeat} onClick={() => setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')}><Icon name="repeat" size={18} />{repeat === 'one' ? <span className="mus2-repeat-one">1</span> : null}</button>
          </div>
          <div className="mus2-extra">
            <button className="mus2-inpl" onClick={() => cur && addToPlaylist(cur.id)} disabled={!cur}><Icon name="plus" size={15} /> В плейлист</button>
            <div className="mus2-together-wrap">
              <button className="mus2-tog" onClick={() => setTogetherUi(u => !u)}><Icon name="users" size={15} /> Вместе {together ? '•' : <Icon name="plus" size={13} />}</button>
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
            <input className="mus2-in" placeholder="Поиск по названию или исполнителю…" value={libQ} onChange={e => setLibQ(e.target.value)} />
            <button className="mus2-lib-x" onClick={() => setShowLib(false)}><Icon name="close" size={16} /></button>
          </header>
          <div className="mus2-lib-body">
            {tracks.length === 0
              ? <div className="mus2-empty center">Трекотека пуста. Добавь трек — его увидят все.</div>
              : tracks.filter(t => t.name.toLowerCase().includes(libQ.toLowerCase())).map(t => {
                  const i = tracks.indexOf(t)
                  return <div key={t.id} className="mus2-lib-row" onClick={() => { setIdx(i); setPlaying(true); setShowLib(false) }}>{meta[t.url]?.title || t.name}<span className="mus2-lib-own">{t.owner}</span></div>
                })}
          </div>
        </div>
      </div>}

      {curSc && cur && <iframe key={scPlayUrl} ref={scRef} className="mus2-scframe" title="SoundCloud" allow="autoplay"
        src={widgetSrc(scPlayUrl)} />}
      <audio ref={audioRef} src={cur && !curSc ? cur.url : undefined}
        onEnded={next}
        onTimeUpdate={e => setCurT((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration)} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} />}
    </main>
    {!visible && (
      <div className="mus-mini" style={musStyle}>
        <div className={'mus-mini-art' + (playing ? ' spin' : '')} onClick={onClose} title="Открыть плеер">
          {curArt ? <img src={curArt} alt="" /> : <Icon name="music" size={18} />}
        </div>
        <div className="mus-mini-meta" onClick={onClose} title="Открыть плеер">
          <div className="mus-mini-t">{cur ? (curMeta?.title || cur.name) : 'Ничего не играет'}</div>
          <div className="mus-mini-s">{cur ? (curMeta?.author || (curSc ? 'SoundCloud' : cur.kind === 'file' ? 'файл' : 'по ссылке')) : 'открой плеер и добавь трек'}</div>
        </div>
        <button className="mm-play" title={playing ? 'Пауза' : 'Играть'} onClick={() => setPlaying(pl => !pl)} disabled={!cur}>
          {playing ? <Icon name="pause" size={15} /> : <Icon name="play" size={15} />}
        </button>
        <button title="Следующий" onClick={next} disabled={tracks.length < 2}><Icon name="skip-forward" size={15} /></button>
        <button title="Выключить музыку" onClick={() => { setPlaying(false); onStop() }}><Icon name="close" size={15} /></button>
      </div>
    )}
  </>)
}