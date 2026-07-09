import { toastErr, toastOk } from '../lib/toast'
import { promptUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY } from './types'
import { idbGet } from '../lib/idb'
import { supabase } from '../lib/supabase'
import { usePresence } from '../lib/presence'
import { uploadTo } from '../lib/storage'
import { fetchTracks, addTrack, removeTrackDb, updateTrackMeta } from '../lib/music'
import { MusicSettings, loadGif, loadBg } from './MusicSettings'
import { Icon } from '../components/icons'
import { isSoundcloudUrl, scMeta, scResolveTracks, loadWidgetApi, widgetSrc, cleanScUrl, type ScMeta } from './soundcloud'
import { isYouTubeUrl, parseYouTubeId, ytMeta, isAudiusUrl, audiusMeta, loadYtApi } from './sources'
import { artColor, boost, lighten, scale, rgb, type Rgb } from './artColor'
import { getUserPrefs, patchUserPrefs } from '../lib/userPrefs'

interface Playlist { id: string; name: string; trackIds: string[] }

// Плейлисты синхронизируются через user_prefs (миграция 39), как остальные личные настройки.
function loadPlaylists(): Playlist[] { return getUserPrefs().mus_playlists as Playlist[] }
function savePlaylists(p: Playlist[]) { patchUserPrefs({ mus_playlists: p }) }
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
  const [full, setFull] = useState(false)  // панель справа <-> на весь экран
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
  const [importing, setImporting] = useState('')
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists)
  const [together, setTogether] = useState<{ code: string; host: boolean } | null>(null)
  const [togetherUi, setTogetherUi] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const togChan = useRef<any>(null)
  const scRef = useRef<HTMLIFrameElement>(null)
  const ytFrameRef = useRef<HTMLIFrameElement>(null)
  const ytRef = useRef<any>(null)          // YT.Player поверх скрытого iframe
  const ytTimer = useRef<number | null>(null)
  const widgetRef = useRef<any>(null)
  const playingRef = useRef(false)
  const volRef = useRef(100)
  const nextRef = useRef<() => void>(() => {})
  const [meta, setMeta] = useState<Record<string, ScMeta>>({})
  const [color, setColor] = useState<Rgb | null>(null)

  const cur = tracks[idx]
  const curSc = !!cur && isSoundcloudUrl(cur.url)
  const curYt = !!cur && !curSc && isYouTubeUrl(cur.url)
  const curMeta = cur ? meta[cur.url] : undefined
  const curArt = curMeta?.art ?? cur?.art ?? null
  // URL, который реально отдаём виджету: каноничный из oEmbed, если он уже известен.
  // v1.80.0: play-URL и обложка берутся и из базы (22_music_meta.sql) — трек
  // играет сразу и с обложкой, даже если oEmbed/виджет у этого клиента молчат.
  const scPlayUrl = curSc && cur ? (curMeta?.play || cur.play || cur.url) : ''
  // YouTube: id видео прямо из ссылки.
  const ytId = curYt && cur ? (parseYouTubeId(cur.url) || '') : ''
  // Обычный <audio>: для Audius-ссылок подставляем прямой stream-URL из resolve.
  const audioSrc = cur && !curSc && !curYt ? (curMeta?.play || cur.play || cur.url) : undefined
  const acc = color ? boost(color) : null
  const musStyle = acc ? ({
    '--mus-a': rgb(acc),
    '--mus-a2': rgb(lighten(acc)),
    '--mus-a-soft': rgb(acc, .22),
    '--mus-bg1': rgb(scale(acc, .16)),
  } as React.CSSProperties) : undefined

  function refreshCfg() { setGif(loadGif()); setBg(loadBg()) }

  // ---- Авто-активность «Слушает…» (как Spotify-статус в Discord) ----
  // Пока трек играет — публикуем название/автора/источник и позицию; на паузе сбрасываем.
  const { setMyListening } = usePresence()
  const curTRef = useRef(0)
  // Плейлисты могли догрузиться с сети уже после открытия плеера.
  useEffect(() => {
    const onSync = () => setPlaylists(loadPlaylists())
    window.addEventListener('ponoi-uprefs', onSync)
    return () => window.removeEventListener('ponoi-uprefs', onSync)
  }, [])
  useEffect(() => { curTRef.current = curT }, [curT])
  useEffect(() => {
    if (!playing || !cur) { setMyListening(null); return }
    const source = curYt ? 'YouTube' : !curSc && isAudiusUrl(cur.url) ? 'Audius' : 'Ponoi Music'
    const pub = () => setMyListening({
      title: curMeta?.title || cur.name, author: curMeta?.author || cur.author || '',
      source, pos: curTRef.current, dur: dur || undefined, at: Date.now(),
    })
    pub()
    const t = window.setInterval(pub, 15000)   // периодически освежаем позицию (перемотки и т.п.)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cur?.url, curMeta?.title, curMeta?.author, dur])
  useEffect(() => () => { setMyListening(null) }, [])   // размонтирование плеера = слушание кончилось

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

  // Метаданные из базы (автор/обложка/play-URL) — видны всем сразу, без oEmbed.
  useEffect(() => {
    setMeta(prev => {
      let ch = false
      const n = { ...prev }
      for (const t of tracks) {
        if (!(t.author || t.art || t.play)) continue
        const old = n[t.url]
        if (old && (old.art || !t.art)) continue
        n[t.url] = { title: old?.title || t.name, author: old?.author || t.author || '', art: old?.art || t.art || null, play: old?.play || t.play || null }
        ch = true
      }
      return ch ? n : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

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
    if (curYt) {
      audioRef.current?.pause()
      const y = ytRef.current
      if (y) { try { if (playing) y.playVideo(); else y.pauseVideo() } catch {} }
      return
    }
    const a = audioRef.current; if (!a) return
    if (playing) a.play().catch(() => {}); else a.pause()
  }, [playing, idx, curSc, curYt])

  useEffect(() => {
    volRef.current = vol
    const a = audioRef.current; if (a) a.volume = vol / 100
    widgetRef.current?.setVolume(vol)
    try { ytRef.current?.setVolume?.(vol) } catch {}
    localStorage.setItem('ponoi_mus_vol', String(vol))
  }, [vol])

  // ---- Метаданные для всех ссылок в списке: SoundCloud / YouTube / Audius ----
  useEffect(() => {
    let ok = true
    // v1.79.0: тянем метаданные для всего, у чего нет обложки (раньше — только без любых метаданных).
    const missing = tracks.filter(t => !meta[t.url] && !t.art && (isSoundcloudUrl(t.url) || isYouTubeUrl(t.url) || isAudiusUrl(t.url)))
    if (missing.length === 0) return
    ;(async () => {
      for (const t of missing) {
        const m = isSoundcloudUrl(t.url) ? await scMeta(t.url) : isYouTubeUrl(t.url) ? await ytMeta(t.url) : await audiusMeta(t.url)
        if (!ok) return
        if (m) {
          setMeta(prev => ({ ...prev, [t.url]: m }))
          // v1.79.0: дозаписываем в базу — обложка/название появятся у всех.
          if (!t.art) updateTrackMeta(t.id, m)
        }
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
    const curTrack = cur
    let disposed = false
    let gotDur = false
    // Если виджет молчит 10 секунд — почти всегда его режет блокировщик рекламы.
    const readyTimer = setTimeout(() => {
      if (!disposed && !widgetRef.current) toastErr('SoundCloud-плеер не отвечает — его режет блокировщик рекламы (w.soundcloud.com) или SoundCloud заблокирован в твоей сети (нужен VPN)')
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
            if (!gotDur && s.duration > 0) { gotDur = true; setDur(s.duration / 1000) }
            const art = s.artwork_url ? String(s.artwork_url).replace('-large', '-t500x500') : null
            setMeta(prev => {
              const old = prev[curUrl]
              return { ...prev, [curUrl]: {
                title: old?.title || s.title || '',
                author: old?.author || s.user?.username || '',
                art: old?.art || art,
                play: old?.play,
              } }
            })
            // v1.80.0: дозаписываем недостающие метаданные в базу — трек
            // «чинится» для всех и навсегда, а не только в этом браузере.
            if (curTrack.id && (!curTrack.art || !curTrack.author || !curTrack.play)) {
              updateTrackMeta(curTrack.id, {
                author: curTrack.author || s.user?.username || undefined,
                art: curTrack.art ?? art,
                play: curTrack.play ?? (s.id ? 'https://api.soundcloud.com/tracks/' + s.id : null),
              })
            }
          })
          if (playingRef.current) w.play()
        })
        w.bind(SC.Widget.Events.PLAY_PROGRESS, (e: any) => {
          if (disposed) return
          setCurT((e?.currentPosition || 0) / 1000)
          if (!gotDur) w.getDuration((ms: number) => { if (!disposed && ms > 0) { gotDur = true; setDur(ms / 1000) } })
        })
        w.bind(SC.Widget.Events.FINISH, () => { if (!disposed) nextRef.current() })
        // Виджет скрыт, но его события всё равно синхронизируем с нашими кнопками.
        w.bind(SC.Widget.Events.PLAY, () => { if (!disposed) setPlaying(true) })
        w.bind(SC.Widget.Events.PAUSE, () => { if (!disposed) setPlaying(false) })
        w.bind(SC.Widget.Events.ERROR, () => { if (!disposed) toastErr('SoundCloud: трек не воспроизводится (закрытый или недоступен для встраивания)') })
      } catch { toastErr('Не удалось загрузить плеер SoundCloud — проверь блокировщик рекламы') }
    })()
    return () => { disposed = true; clearTimeout(readyTimer); widgetRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curSc, scPlayUrl])

  // ---- YouTube (скрытый iframe + IFrame API) — музыка по ссылке YouTube ----
  useEffect(() => {
    if (!curYt || !ytId) { ytRef.current = null; return }
    setCurT(0); setDur(0)
    let disposed = false
    ;(async () => {
      try {
        const YT = await loadYtApi()
        if (disposed || !ytFrameRef.current) return
        new YT.Player(ytFrameRef.current, {
          events: {
            onReady: (e: any) => {
              if (disposed) return
              ytRef.current = e.target
              try { e.target.setVolume(volRef.current) } catch {}
              try { const d = e.target.getDuration(); if (d > 0) setDur(d) } catch {}
              if (playingRef.current) { try { e.target.playVideo() } catch {} }
            },
            onStateChange: (e: any) => {
              if (disposed) return
              try { const d = e.target.getDuration(); if (d > 0) setDur(d) } catch {}
              if (e.data === 0) nextRef.current()
            },
            onError: () => { if (!disposed) toastErr('YouTube: видео закрыто для встраивания — попробуй другую ссылку') },
          },
        })
        ytTimer.current = window.setInterval(() => {
          const y = ytRef.current
          if (!y) return
          try { const t = y.getCurrentTime(); if (typeof t === 'number') setCurT(t) } catch {}
        }, 500)
      } catch { toastErr('Не удалось загрузить плеер YouTube') }
    })()
    return () => {
      disposed = true
      if (ytTimer.current) { window.clearInterval(ytTimer.current); ytTimer.current = null }
      ytRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curYt, ytId])

  // При смене трека сразу показываем длительность из базы (точную даст плеер позже).
  useEffect(() => {
    setCurT(0); setDur(tracks[idx]?.dur || 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])

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
    if (isSoundcloudUrl(url)) {
      // SoundCloud (трек ИЛИ плейлист/сет): пробуем развернуть ссылку в полный
      // список треков через виджет. v1.77.0: если виджет молчит/зарезан
      // блокировщиком — ссылка ВСЁ РАВНО сохраняется в трекотеку (метаданные
      // берём из oEmbed, а без него — хотя бы имя из самой ссылки).
      setImporting('Читаю SoundCloud…')
      try {
        const list = await scResolveTracks(url, (d, t) => setImporting(t > 1 ? `Добавляю: ${d}/${t}…` : 'Добавляю трек…'))
        if (list.length === 0) throw new Error('empty')
        const have = new Set(tracks.map(x => x.url))
        let added = 0
        for (const s of list) {
          if (have.has(s.url)) continue
          have.add(s.url)
          setMeta(prev => ({ ...prev, [s.url]: { title: s.title, author: s.author, art: s.art, play: s.play } }))
          await addTrack({ url: s.url, name: s.title, ownerId: meId, ownerName: me, kind: 'url', author: s.author, art: s.art, dur: s.dur, play: s.play })
          added++
        }
        setScUrl('')
        setTracks(await fetchTracks())
        if (added === 0) toastErr('Эти треки уже есть в трекотеке')
        else toastOk(added === 1 ? 'Трек добавлен в трекотеку' : `Добавлено треков: ${added}`)
      } catch {
        // Запасной путь: сохраняем сам линк с oEmbed-метаданными.
        try {
          setImporting('Сохраняю трек…')
          const m = await scMeta(url)
          if (tracks.some(x => x.url === url)) { toastErr('Этот трек уже есть в трекотеке') }
          else {
            const name = m?.title || decodeURIComponent(url.split('/').filter(Boolean).pop() || 'Трек').replace(/[-_]/g, ' ')
            if (m) setMeta(prev => ({ ...prev, [url]: m }))
            await addTrack({ url, name, ownerId: meId, ownerName: me, kind: 'url', author: m?.author, art: m?.art ?? null, play: m?.play ?? null })
            setTracks(await fetchTracks())
            toastOk('Трек добавлен в трекотеку' + (m ? '' : ' (название уточнится при воспроизведении)'))
          }
          setScUrl('')
        } catch (err: any) { toastErr(err?.message ?? String(err)) }
      }
      finally { setImporting('') }
      return
    }
    // Остальные источники: YouTube / Audius / прямой аудио-файл по ссылке.
    const m = isYouTubeUrl(url) ? await ytMeta(url) : isAudiusUrl(url) ? await audiusMeta(url) : null
    if (!m && isAudiusUrl(url)) { toastErr('Не удалось прочитать ссылку Audius — проверь её'); return }
    const name = m?.title || decodeURIComponent(url.split('/').filter(Boolean).pop() || 'Трек').replace(/[-_]/g, ' ')
    if (m) setMeta(prev => ({ ...prev, [url]: m }))
    await addTrack({ url, name, ownerId: meId, ownerName: me, kind: 'url', author: m?.author, art: m?.art ?? null, play: m?.play ?? null })
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
      const y = ytRef.current
      if (y) { try { y.seekTo(0, true); y.playVideo() } catch {}; return }
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

  async function addToPlaylist(trackId: string) {
    const name = (await promptUi('Название плейлиста (существующее или новое)', { placeholder: 'Моя музыка' }))?.trim(); if (!name) return
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
  async function joinTogether() {
    const code = (await promptUi('Код совместного прослушивания', { placeholder: 'ABC123' }))?.trim().toUpperCase(); if (!code) return
    setTogether({ code, host: false }); setTogetherUi(false)
  }

  const showLeft = gif.url && (gif.pos === 'left' || gif.pos === 'both')
  const showRight = gif.url && (gif.pos === 'right' || gif.pos === 'both')
  const filteredQueue = qFilter ? tracks.filter(t => t.name.toLowerCase().includes(qFilter.toLowerCase())) : tracks

  return (<>
    <main className={'mus2' + (bg.type !== 'none' && bgUrl ? ' hasbg' : '') + (acc ? ' tinted' : '') + (full ? ' full' : '') + (visible ? '' : ' mus2-hidden')} style={musStyle}>
      {bg.type !== 'none' && bgUrl && <>
        {bg.type === 'video'
          ? <video className="musbg" src={bgUrl} autoPlay loop muted playsInline />
          : <div className="musbg" style={{ backgroundImage: `url(${bgUrl})` }} />}
        <div className="musbg-dim" style={{ opacity: bg.dim / 100 }} />
      </>}

      <header className="mus2-top">
        <div className="mus2-brand"><span className="mus2-logo"><Icon name="music" size={20} /></span> <b>Музыка</b></div>
        <div className="mus2-topr">
          <button title={full ? 'Свернуть в панель' : 'На весь экран'} onClick={() => setFull(f => !f)}><Icon name={full ? 'shrink' : 'expand'} size={18} /></button>
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
            <input className="mus2-in" placeholder="Ссылка: SoundCloud, YouTube, Audius или .mp3…" value={scUrl}
              onChange={e => setScUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSoundcloud() }} />
            <button className="mus2-addbtn" onClick={addSoundcloud} disabled={!!importing}>{importing ? '…' : 'Добавить'}</button>
          </div>
          {importing && <div className="mus2-importing">{importing}</div>}
          <div className="mus2-addrow">
            <input className="mus2-in" placeholder="Найти трек в очереди…" value={qFilter} onChange={e => setQFilter(e.target.value)} />
            <button className="mus2-libbtn" onClick={() => setShowLib(true)}>Трекотека</button>
          </div>

          {tab === 'queue' ? <>
            <div className="mus2-sec">ТЕКУЩАЯ ОЧЕРЕДЬ <button className="mus2-filebtn" title="Добавить файлы" onClick={() => fileRef.current?.click()}>{uploading ? '…' : <Icon name="plus" size={16} />}</button></div>
            <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />
            <div className="mus2-list">
              {filteredQueue.length === 0 && <div className="mus2-empty">Пусто. Вставь ссылку — SoundCloud, YouTube, Audius или прямой .mp3.</div>}
              {filteredQueue.map((t) => {
                const i = tracks.indexOf(t)
                return (
                  <div key={t.id} className={'mus2-li' + (i === idx ? ' on' : '')} onClick={() => { setIdx(i); setPlaying(true) }}>
                    <span className="mus2-li-art">{(meta[t.url]?.art || t.art) ? <img src={(meta[t.url]?.art || t.art) as string} alt="" /> : <Icon name="music" size={13} />}</span>
                    <span className="mus2-li-n">
                      <span className="mus2-li-t">{i === idx && playing ? <Icon name="music" size={13} className="mus2-playing-ic" /> : null}{meta[t.url]?.title || t.name}</span>
                      {(meta[t.url]?.author || t.author) ? <span className="mus2-li-a">{meta[t.url]?.author || t.author}</span> : null}
                    </span>
                    {t.dur ? <span className="mus2-li-d">{fmt(t.dur)}</span> : null}
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
          <div className="mus2-nowsub">{cur ? (curSc ? (curMeta?.author || cur.author || 'Трекотека') : curYt ? (curMeta?.author ? curMeta.author + ' · YouTube' : 'YouTube') : cur.kind === 'url' ? (curMeta?.author || cur.author || 'по ссылке') : 'файл · ' + cur.owner) : 'Добавь трек, чтобы начать'}</div>
          {curSc && cur && <iframe key={scPlayUrl} ref={scRef} className="mus2-scframe" title="SoundCloud" allow="autoplay"
            src={widgetSrc(scPlayUrl)} />}
          {together && <div className="mus2-together-badge"><Icon name="users" size={14} /> Вместе · код {together.code} {together.host ? '(хост)' : ''}</div>}
          {showRight && <img className="mus-gif r" src={gif.url} alt="" />}
        </section>
      </div>

      <footer className="mus2-bar">
        <div className="mus2-seek">
          <span>{fmt(curT)}</span>
          <input type="range" min={0} max={dur || 0} step={0.1} value={curT}
            onChange={e => { const v = +e.target.value; if (curSc) { widgetRef.current?.seekTo(v * 1000); setCurT(v) } else if (curYt) { try { ytRef.current?.seekTo(v, true) } catch {}; setCurT(v) } else { const a = audioRef.current; if (a) { a.currentTime = v; setCurT(v) } } }} disabled={!cur} />
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
              : tracks.filter(t => (t.name + ' ' + (t.author || '')).toLowerCase().includes(libQ.toLowerCase())).map(t => {
                  const i = tracks.indexOf(t)
                  const art = meta[t.url]?.art || t.art
                  const author = meta[t.url]?.author || t.author
                  return <div key={t.id} className="mus2-lib-row" onClick={() => { setIdx(i); setPlaying(true); setShowLib(false) }}>
                    <span className="mus2-lib-art">{art ? <img src={art} alt="" /> : <Icon name="music" size={15} />}</span>
                    <span className="mus2-lib-meta"><span className="mus2-lib-t">{meta[t.url]?.title || t.name}</span>{author ? <span className="mus2-lib-a">{author}</span> : null}</span>
                    {t.dur ? <span className="mus2-lib-d">{fmt(t.dur)}</span> : null}
                    <span className="mus2-lib-own">{t.owner}</span>
                  </div>
                })}
          </div>
        </div>
      </div>}

      {curYt && ytId && <iframe key={ytId} ref={ytFrameRef} className="mus2-ytframe" title="YouTube" allow="autoplay; encrypted-media"
        src={'https://www.youtube.com/embed/' + ytId + '?enablejsapi=1&playsinline=1&controls=0&rel=0'} />}
      <audio ref={audioRef} src={audioSrc}
        onEnded={next}
        onTimeUpdate={e => setCurT((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration)} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} />}
    </main>
    {!visible && cur && (
      <div className="mus-mini" style={musStyle}>
        <div className={'mus-mini-art' + (playing ? ' spin' : '')} onClick={onClose} title="Открыть плеер">
          {curArt ? <img src={curArt} alt="" /> : <Icon name="music" size={18} />}
        </div>
        <div className="mus-mini-meta" onClick={onClose} title="Открыть плеер">
          <div className="mus-mini-t">{curMeta?.title || cur.name}</div>
          <div className="mus-mini-s">{curMeta?.author || cur.author || (cur.kind === 'file' ? 'файл' : 'Ponoi Music')}</div>
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