import { toastErr, toastOk } from '../lib/toast'
import { promptUi, confirmUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY } from './types'
import { idbGet } from '../lib/idb'
import { supabase } from '../lib/supabase'
import { usePresence } from '../lib/presence'
import { uploadTo } from '../lib/storage'
import { fetchTracks, addTrack, removeTrackDb, updateTrackMeta, isDuplicateTrack, recordPlay, myPlayCounts } from '../lib/music'
import { personalOrder } from './personalQueue'

/** Крупные числа сокращаем: «1.2K» вместо «1247» — на карточке важнее порядок. */
const fmtPlays = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'K' : String(n)
import { MusicSettings, loadGif, loadBg, loadLyricsCfg } from './MusicSettings'
import { parseLyrics, activeLineIndex, loadLyrics, saveLyrics, searchLyricsOnline, type Lyrics } from './lyrics'
import { Icon } from '../components/icons'
import { Portal } from '../components/Portal'
import { Avatar } from '../components/Avatar'
import { copyText } from '../lib/copyMedia'
import { isSoundcloudUrl, scMeta, scResolveTracks, lastImportSkipped, loadWidgetApi, widgetSrc, cleanScUrl, type ScMeta } from './soundcloud'
import { normalizeTrackUrl, sameTrack } from './trackUrl'
import { nextTrack } from './nextTrack'
import { useDragBar } from './useDragBar'
import { isYouTubeUrl, parseYouTubeId, ytMeta, isAudiusUrl, audiusMeta, loadYtApi } from './sources'
import { serviceOf, streamingMeta, findPlayable, titleFromUrl, isStreamingUrl, SERVICE_NAME } from './streaming'
import { openSafely } from '../lib/safeUrl'
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
  // v1.394.0: текст песни.
  const [lyrCfg, setLyrCfg] = useState(loadLyricsCfg())
  const [lyr, setLyr] = useState<Lyrics | null>(null)
  const [lyrEdit, setLyrEdit] = useState<string | null>(null)   // не null — открыто окно правки
  const [lyrBusy, setLyrBusy] = useState(false)
  const [lyrNote, setLyrNote] = useState('')
  const [bgUrl, setBgUrl] = useState<string>('')
  const [curT, setCurT] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(() => Number(localStorage.getItem('ponoi_mus_vol') || '100'))
  const [tab, setTab] = useState<'queue' | 'playlists'>('queue')
  const [scUrl, setScUrl] = useState('')
  const [showLib, setShowLib] = useState(false)
  const [libQ, setLibQ] = useState('')
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState('')
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists)
  const [together, setTogether] = useState<{ code: string; host: boolean } | null>(null)
  const [togetherUi, setTogetherUi] = useState(false)
  // v1.382.0: в лобби всем управляет ведущий.
  //
  // Раньше запрет был только на приём: гость получал состояние от ведущего, но
  // сам мог нажать паузу, перемотать или переключить трек — и рассинхронизировался
  // до следующего события. Со стороны это выглядело как «оно само сбилось».
  // А ещё гость мог удалить трек из трекотеки посреди общего прослушивания —
  // трекотека общая, и это касалось всех.
  //
  // Поэтому у гостя выключены и управление, и правка склада. Громкость своя —
  // её слышит только он, и отбирать её не за что.
  const guest = !!together && !together.host
  const noGuest = 'Управляет ведущий лобби'

  const miniDrag = useDragBar()
  const [lobby, setLobby] = useState<{ id: string; name: string; avatar: string | null; host: boolean }[]>([])
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
  const prevRef = useRef<() => void>(() => {})
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
  // v1.367.0: трек со стримингового сервиса, для которого играбельной копии не
  // нашлось. Сам адрес отдавать <audio> нельзя — это страница, а не звук: тег
  // молча не заиграет, и человек будет думать, что сломался плеер. Показываем
  // карточку и кнопку открыть в сервисе.
  const curPlayable = (curMeta?.play || cur?.play) ?? null
  const curStreamOnly = !!cur && !curSc && !curYt && !curPlayable && isStreamingUrl(cur.url)
  const curSvc = cur ? serviceOf(cur.url) : null
  // Обычный <audio>: для Audius-ссылок подставляем прямой stream-URL из resolve.
  const audioSrc = cur && !curSc && !curYt && !curStreamOnly ? (curPlayable || cur.url) : undefined
  const acc = color ? boost(color) : null
  const musStyle = acc ? ({
    '--mus-a': rgb(acc),
    '--mus-a2': rgb(lighten(acc)),
    '--mus-a-soft': rgb(acc, .22),
    '--mus-bg1': rgb(scale(acc, .16)),
  } as React.CSSProperties) : undefined

  // v1.369.0: в базе нет колонок под обложку и ссылку воспроизведения — тогда
  // они живут только в кэше этого браузера и «пропадают навсегда» при переходе
  // на другое устройство. Молчать об этом нельзя: выглядит как поломка плеера.
  useEffect(() => {
    const h = () => toastErr('Обложки и ссылки треков не сохраняются: примени миграцию supabase/22_music_meta.sql')
    window.addEventListener('ponoi-music-nometa', h)
    return () => window.removeEventListener('ponoi-music-nometa', h)
  }, [])

  // v1.371.0: название, автор и обложка уходят в системный проигрыватель — тот
  // самый, что всплывает в Windows при нажатии кнопок громкости, и живёт на
  // экране блокировки телефона. Оттуда же работают кнопки на клавиатуре и
  // наушниках: раньше нажатие «плей» на гарнитуре не делало ничего.
  useEffect(() => {
    const ms = (navigator as any).mediaSession
    if (!ms || !cur) return
    try {
      const art = curArt
      ms.metadata = new (window as any).MediaMetadata({
        title: curMeta?.title || cur.name || 'Трек',
        artist: curMeta?.author || cur.author || 'Ponoi Music',
        album: 'Ponoi Music',
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      })
      ms.playbackState = playing ? 'playing' : 'paused'
    } catch { /* браузер не умеет — просто не будет системной карточки */ }
  }, [cur, curMeta, curArt, playing])

  useEffect(() => {
    const ms = (navigator as any).mediaSession
    if (!ms?.setActionHandler) return
    const set = (name: string, fn: (() => void) | null) => {
      // Не все действия поддерживаются везде: неизвестное имя бросает исключение,
      // и без try один незнакомый обработчик отменил бы все остальные.
      try { ms.setActionHandler(name, fn) } catch { /* это действие не умеют */ }
    }
    set('play', () => setPlaying(true))
    set('pause', () => setPlaying(false))
    set('previoustrack', () => prevRef.current())
    set('nexttrack', () => nextRef.current())
    set('stop', () => setPlaying(false))
    return () => {
      for (const n of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) set(n, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc закрывает трекотеку — как любое другое окно приложения.
  useEffect(() => {
    if (!showLib) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setShowLib(false) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showLib])

  function refreshCfg() { setGif(loadGif()); setBg(loadBg()); setLyrCfg(loadLyricsCfg()) }

  // v1.394.0: текст текущего трека. Сначала общий (Трекотека), потом — если
  // человек сам разрешил — поиск в интернете, и найденное складывается обратно,
  // чтобы второй раз никуда не ходить и чтобы текст был у всех.
  useEffect(() => {
    let ok = true
    setLyr(null); setLyrNote('')
    const t = cur
    if (!t || lyrCfg.mode === 'off') return
    ;(async () => {
      let raw = await loadLyrics(t.id)
      if (!ok) return
      if (raw) { setLyr(parseLyrics(raw)); return }
      if (!lyrCfg.online) {
        // Разные причины пустоты — разные подсказки: «текста нет» и «его даже не
        // искали» это не одно и то же, а раньше человек видел одну фразу на оба.
        setLyrNote('Текста нет. Поиск в интернете выключен в настройках плеера; свой текст можно вставить кнопкой «Текст».')
        return
      }
      setLyrNote('Ищу текст…')
      const found = await searchLyricsOnline(curMeta?.title || t.name, curMeta?.author || t.author || '', dur || t.dur)
      if (!ok) return
      if (!found.ok) {
        setLyrNote(found.why === 'net'
          ? 'Не получилось спросить lrclib.net — нет сети или сервис молчит.'
          : 'Текст не нашёлся в каталоге. Кнопка «Текст» — вставить свой.')
        return
      }
      raw = found.hit.text
      setLyr(parseLyrics(raw))
      setLyrNote('Текст найден: ' + found.hit.by)
      void saveLyrics(t.id, raw, t.ownerId === meId)
    })()
    return () => { ok = false }
  }, [cur?.id, lyrCfg.mode, lyrCfg.online])

  async function keepLyrics(text: string) {
    if (!cur) return
    setLyrBusy(true)
    try {
      const where = await saveLyrics(cur.id, text, lyrMine)
      setLyr(text.trim() ? parseLyrics(text) : null)
      setLyrNote(text.trim() ? '' : 'Текста нет. Кнопка «Текст» — вставить свой.')
      setLyrEdit(null)
      toastOk(where === 'db' ? 'Текст сохранён — его увидят все' : 'Текст сохранён на этом устройстве')
    } finally { setLyrBusy(false) }
  }

  // Караоке возможно только с метками времени. Без них не притворяемся: текст
  // показываем фоном, а в окне правки объясняем, чего не хватает.
  const lyrMode: 'off' | 'back' | 'karaoke' =
    lyrCfg.mode === 'off' || !lyr || lyr.lines.length === 0 ? 'off'
    : lyrCfg.mode === 'karaoke' && lyr.synced ? 'karaoke' : 'back'
  const lyrActive = lyr && lyr.synced ? activeLineIndex(lyr.lines, curT) : -1
  // v1.395.0: общий текст ставит только тот, кто выложил трек. Трекотека общая,
  // но текст — часть карточки трека, и переписывать её каждому встречному не за
  // что: один добавил, второй заменил, третий стёр. Найденное в интернете
  // остальным достаётся, но только на своё устройство.
  const lyrMine = !!cur && !!meId && cur.ownerId === meId

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
    // v1.369.0: добираем и тем, у кого нет ссылки воспроизведения, а не только
    // обложки: у SoundCloud без неё трек играет через адрес страницы.
    const missing = tracks.filter(t => !meta[t.url] && (!t.art || !t.play) && (isSoundcloudUrl(t.url) || isYouTubeUrl(t.url) || isAudiusUrl(t.url)))
    if (missing.length === 0) return
    ;(async () => {
      for (const t of missing) {
        const m = isSoundcloudUrl(t.url) ? await scMeta(t.url) : isYouTubeUrl(t.url) ? await ytMeta(t.url) : await audiusMeta(t.url)
        if (!ok) return
        if (m) {
          setMeta(prev => ({ ...prev, [t.url]: m }))
          // v1.79.0: дозаписываем в базу — обложка/название появятся у всех.
          // v1.369.0: заодно и ссылку воспроизведения, если её у трека не было:
          // без неё SoundCloud-трек играет через адрес страницы, что медленнее и
          // не всегда срабатывает. Пустые поля не перезаписываются (см. metaPatch).
          if (!t.art || !t.play) updateTrackMeta(t.id, m)
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
    // v1.379.0: кто сидит в лобби. Раньше «Вместе» показывало только код — с кем
    // ты слушаешь и слушает ли кто-то вообще, узнать было нельзя ниоткуда, и
    // непонятно было даже, дошло ли приглашение.
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState() as Record<string, any[]>
      const seen = new Map<string, { id: string; name: string; avatar: string | null; host: boolean }>()
      for (const arr of Object.values(st)) {
        for (const m of arr) {
          if (!m?.id) continue
          // Один человек может открыть плеер дважды — считаем его одним.
          seen.set(m.id, { id: m.id, name: m.name ?? 'Гость', avatar: m.avatar ?? null, host: !!m.host })
        }
      }
      setLobby([...seen.values()].sort((a, b) => Number(b.host) - Number(a.host)))
    })
    ch.subscribe(st => {
      if (st !== 'SUBSCRIBED' || !meId) return
      void ch.track({ id: meId, name: me, avatar: null, host: together.host })
    })
    togChan.current = ch
    return () => { setLobby([]); supabase.removeChannel(ch); togChan.current = null }
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
      let dupes = 0
      for (const f of fs) {
        const url = await uploadTo('attachments', meId, f)   // shared public URL
        const r = await addTrack({ url, name: f.name.replace(/\.[^.]+$/, ''), ownerId: meId, ownerName: me, kind: 'file' })
        // v1.373.0: у файлов проверки не было вовсе — один и тот же трек заливался
        // сколько угодно раз. Теперь отказ приходит из базы, и мы его показываем,
        // а не глотаем: человек должен понимать, почему добавилось не всё.
        if (isDuplicateTrack(r.error)) dupes++
        else if (r.error) throw new Error(r.error.message)
      }
      if (dupes > 0) {
        toastErr(dupes === fs.length
          ? (dupes === 1 ? 'Такой трек уже есть в трекотеке' : 'Все эти треки уже есть в трекотеке')
          : `Уже были в трекотеке: ${dupes}`)
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
        // v1.373.0: сравниваем приведённые адреса. Один и тот же трек приезжает
        // с разными хвостами (?si=, ?in=…/sets/…), и по строкам это разные ссылки.
        const have = new Set(tracks.map(x => normalizeTrackUrl(x.url)))
        let added = 0, dupes = 0
        for (const s of list) {
          const key = normalizeTrackUrl(s.url)
          if (have.has(key)) { dupes++; continue }
          have.add(key)
          setMeta(prev => ({ ...prev, [s.url]: { title: s.title, author: s.author, art: s.art, play: s.play } }))
          await addTrack({ url: s.url, name: s.title, ownerId: meId, ownerName: me, kind: 'url', author: s.author, art: s.art, dur: s.dur, play: s.play })
          added++
        }
        setScUrl('')
        setTracks(await fetchTracks())
        // v1.370.0: если SoundCloud отдал не весь плейлист — говорим, сколько
        // недостаёт. Раньше пропущенные исчезали молча, и человек видел «добавлено
        // 47» вместо 52, не зная, что чего-то не хватает.
        const lost = lastImportSkipped()
        if (added === 0) toastErr(dupes > 0 ? 'Эти треки уже есть в трекотеке' : 'Из плейлиста нечего добавить')
        else if (dupes > 0 && !lost.length) toastOk(`Добавлено треков: ${added}, уже были: ${dupes}`)
        else if (lost.length) {
          toastOk(`Добавлено треков: ${added}`)
          toastErr(`SoundCloud не отдал ${lost.length} ${lost.length === 1 ? 'трек' : 'треков'} из плейлиста — попробуй добавить плейлист ещё раз, их доберёт`)
        }
        else toastOk(added === 1 ? 'Трек добавлен в трекотеку' : `Добавлено треков: ${added}`)
      } catch {
        // Запасной путь: сохраняем сам линк с oEmbed-метаданными.
        try {
          setImporting('Сохраняю трек…')
          const m = await scMeta(url)
          if (tracks.some(x => sameTrack(x.url, url))) { toastErr('Этот трек уже есть в трекотеке') }
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
    // v1.367.0: ссылка со стримингового сервиса (Spotify, Apple Music, Deezer,
    // Яндекс, Bandcamp). Полный трек оттуда сторонним приложением не играется —
    // он отдаётся только их собственным проигрывателем и только подписчику.
    // Поэтому берём название с обложкой и ищем ту же запись там, где её можно
    // играть целиком. Не нашли — трек всё равно сохраняется карточкой, а не
    // пропадает: у него есть обложка, автор и кнопка открыть в сервисе.
    const svc = serviceOf(url)
    if (svc) {
      setImporting('Читаю ' + SERVICE_NAME[svc] + '…')
      try {
        const sm = await streamingMeta(url)
        if (tracks.some(x => sameTrack(x.url, url))) { toastErr('Этот трек уже есть в трекотеке'); return }
        setImporting('Ищу, где это можно послушать…')
        const found = await findPlayable(sm?.title ?? titleFromUrl(url), sm?.author ?? '')
        const meta2 = {
          title: sm?.title ?? titleFromUrl(url),
          author: sm?.author ?? SERVICE_NAME[svc],
          art: sm?.art ?? found?.art ?? null,
          play: found?.play ?? null,
        }
        setMeta(prev => ({ ...prev, [url]: meta2 }))
        const r = await addTrack({
          url, name: meta2.title, ownerId: meId, ownerName: me, kind: 'url',
          author: meta2.author, art: meta2.art, play: meta2.play,
        })
        if (isDuplicateTrack(r.error)) { toastErr('Этот трек уже есть в трекотеке'); return }
        setScUrl('')
        setTracks(await fetchTracks())
        toastOk(found
          ? 'Трек добавлен и играет целиком'
          : `«${meta2.title}» добавлен. ${SERVICE_NAME[svc]} не даёт играть свои треки снаружи, а копии в открытых каталогах не нашлось — карточка откроется в сервисе`)
      } catch (err: any) {
        toastErr(err?.message ?? String(err))
      } finally { setImporting('') }
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

  async function removeTrack(id: string, name?: string) {
    // v1.376.0: спрашиваем. Трекотека общая — удаляя трек, человек убирает его у
    // всех, и промах по кнопке на карточке стоит дороже, чем лишний вопрос.
    if (!await confirmUi(`Убрать «${name || 'трек'}» из трекотеки? Он пропадёт у всех.`,
      { okText: 'Убрать', danger: true })) return
    const { data, error } = await removeTrackDb(id)
    if (error || !data?.length) { toastErr('Не удалось удалить трек' + (error?.message ? ': ' + error.message : '')); return }
    const gone = tracks.findIndex(x => x.id === id)
    const rest = tracks.filter(x => x.id !== id)
    setTracks(rest)
    // Удалили трек ПЕРЕД текущим — иначе играть начало бы соседнюю песню:
    // номер тот же, а список сдвинулся. Раньше номер просто прижимался к концу.
    if (gone >= 0 && gone < idx) setIdx(i => Math.max(0, i - 1))
    else if (gone === idx) setIdx(i => Math.min(i, Math.max(0, rest.length - 1)))
    // Из очереди тоже убираем: ждать удалённого нечего.
    saveManual(manual.filter(x => x !== id))
  }

  /** Перезапустить то, что играет сейчас, каким бы источником оно ни было. */
  const restartCurrent = () => {
    const w = widgetRef.current
    if (w) { w.seekTo(0); w.play(); return }
    const y = ytRef.current
    if (y) { try { y.seekTo(0, true); y.playVideo() } catch {}; return }
    const a = audioRef.current
    if (a) { a.currentTime = 0; a.play().catch(() => {}) }
  }

  // v1.377.0: решение «что дальше» вынесено в lib и проверяется тестом. Здесь
  // только исполнение: раньше вся логика жила тут и потому не проверялась ничем —
  // повтор списка из одного трека молча превращался в тишину.
  const next = () => {
    const first = manualLive.find(id => tracks.some(t => t.id === id))
    const manualIdx = first ? tracks.findIndex(t => t.id === first) : -1
    const act = nextTrack({ idx, count: tracks.length, repeat, shuffle, manualIdx })
    if (first && act.kind !== 'restart') saveManual(manual.filter(x => x !== first))
    if (act.kind === 'restart') { restartCurrent(); return }
    if (act.kind === 'stop') { setPlaying(false); return }
    if (act.index === idx) { restartCurrent(); return }
    setIdx(act.index)
  }
  const prev = () => setIdx(i => (i - 1 + tracks.length) % Math.max(tracks.length, 1))
  // v1.371.0: системные кнопки («предыдущий» на гарнитуре) вешаются один раз, и
  // без ссылки обработчик держал бы список таким, каким он был на первом рендере
  // — то есть пустым, и кнопка всегда возвращала бы к первому треку.
  prevRef.current = prev
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

  // ── Очередь: что заиграет дальше (v1.374.0) ──────────────────────────────
  //
  // Раньше «очередь» и «трекотека» были одним и тем же списком, и панель
  // показывала весь склад целиком. У Spotify это разные вещи, и не из вредности:
  // очередь отвечает на вопрос «что сейчас будет», а склад — «что у меня есть».
  // Смешивать их значит не отвечать ни на один.
  //
  // Ручная очередь — то, что человек поставил кнопкой «в очередь»: играет сразу
  // после текущего, вперёд обычного порядка. Дальше идёт обычный порядок склада.
  const MANUAL_KEY = 'ponoi_mus_queue_v1'
  const [manual, setManual] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '[]') } catch { return [] }
  })
  const saveManual = (v: string[]) => {
    setManual(v)
    try { localStorage.setItem(MANUAL_KEY, JSON.stringify(v)) } catch { /* переполнено — переживём */ }
  }
  // Треки могли удалить из трекотеки, пока они стояли в очереди.
  const manualLive = manual.filter(id => tracks.some(t => t.id === id))

  /** Сколько ближайших показываем лентой. Больше не нужно: это подсказка, не список. */
  const UP_NEXT_SHOWN = 8

  // v1.377.0: сколько раз я слушал каждый трек — по этому и строится очередь.
  const [myPlays, setMyPlays] = useState<Record<string, number>>({})
  useEffect(() => { myPlayCounts().then(setMyPlays) }, [])

  // Отмечаем прослушивание один раз на трек: не на каждую перемотку и не на
  // паузу, иначе число говорило бы о нажатиях, а не о том, что человек слушал.
  const countedRef = useRef<string>('')
  useEffect(() => {
    if (!cur || !playing || countedRef.current === cur.id) return
    countedRef.current = cur.id
    void recordPlay(cur.id)
    setMyPlays(p => ({ ...p, [cur.id]: (p[cur.id] ?? 0) + 1 }))
    setTracks(ts => ts.map(t => (t.id === cur.id ? { ...t, plays: (t.plays ?? 0) + 1 } : t)))
  }, [cur, playing])

  const upNextAll = (() => {
    const out: { t: typeof tracks[number]; i: number; manual: boolean }[] = []
    const seen = new Set<string>()
    for (const id of manualLive) {
      const i = tracks.findIndex(t => t.id === id)
      if (i < 0 || i === idx || seen.has(id)) continue
      seen.add(id)
      out.push({ t: tracks[i], i, manual: true })
    }
    // v1.377.0: дальше — не «по порядку склада», а то, что слушает сам человек.
    // Порядок склада — это время, когда трек кто-то добавил, и к слушателю он
    // отношения не имеет: он слушает пять песен, а очередь предлагала то, что
    // позавчера выложил сосед.
    for (const t of personalOrder({ tracks, idx, plays: myPlays })) {
      if (seen.has(t.id)) continue
      const i = tracks.findIndex(x => x.id === t.id)
      if (i < 0) continue
      seen.add(t.id)
      out.push({ t, i, manual: false })
    }
    return out
  })()
  const upNext = upNextAll.slice(0, UP_NEXT_SHOWN)
  const moreAfter = Math.max(0, upNextAll.length - upNext.length)

  /** Поставить трек следующим. Уже стоящий — переставляем, а не задваиваем. */
  function queueNext(id: string) {
    saveManual([id, ...manual.filter(x => x !== id)])
    toastOk('Заиграет следующим')
  }
  /** Убрать из ручной очереди. Обычный порядок склада так не выкинуть — это не очередь. */
  function dropFromQueue(id: string) {
    if (!manual.includes(id)) { toastOk('Этот трек идёт по порядку — убрать можно только из трекотеки'); return }
    saveManual(manual.filter(x => x !== id))
  }
  /** Перейти к треку и снять его с ручной очереди: он уже играет, ждать нечего. */
  function playAt(i: number) {
    const t = tracks[i]
    if (t && manual.includes(t.id)) saveManual(manual.filter(x => x !== t.id))
    setIdx(i)
  }

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
            <input className="mus2-in" disabled={guest} placeholder={guest ? 'В лобби треки добавляет ведущий' : 'Ссылка: Spotify, YouTube, SoundCloud, Apple Music, Deezer, Bandcamp, .mp3…'} value={scUrl}
              onChange={e => setScUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSoundcloud() }} />
            <button className="mus2-addbtn" onClick={addSoundcloud} disabled={!!importing || guest} title={guest ? noGuest : undefined}>{importing ? '…' : 'Добавить'}</button>
          </div>
          {importing && <div className="mus2-importing">{importing}</div>}
          {/* v1.376.0: поле «найти трек в очереди» убрано — после того, как очередь
              стала лентой ближайших, фильтровать в ней было нечего, и поле просто
              ничего не делало. Поиск по всему складу живёт в самой трекотеке. */}
          {/* v1.382.0: без этой строки выключенные кнопки выглядят поломкой, а не
              правилом. Человек должен понимать, почему он не может нажать. */}
          {guest && <div className="mus2-guestbar">
            <Icon name="users" size={14} /> Слушаешь вместе — треками управляет ведущий
          </div>}
          <div className="mus2-addrow">
            <button className="mus2-libbtn wide" onClick={() => setShowLib(true)}>
              <Icon name="music" size={15} /> Трекотека{tracks.length > 0 ? ` · ${tracks.length}` : ''}
            </button>
          </div>

          {tab === 'queue' ? <>
            {/* v1.374.0: очередь — это то, что заиграет ДАЛЬШЕ, а не весь склад.
                Раньше сюда вываливалась вся трекотека целиком: с сотней треков
                список занимал пол-экрана, а прокрутить его до нужного было
                дольше, чем найти трек в самой трекотеке.

                Показываем ближайшие несколько лентой вбок — она занимает одну
                строку вместо половины панели, и по ней видно, что будет, не
                листая ничего. Весь склад живёт в трекотеке, отдельной кнопкой. */}
            <div className="mus2-sec">
              ДАЛЬШЕ В ОЧЕРЕДИ
              <span className="mus2-qn">{upNext.length > 0 ? upNext.length : ''}</span>
              <button className="mus2-filebtn" title={guest ? noGuest : 'Добавить файлы'} disabled={guest} onClick={() => fileRef.current?.click()}>{uploading ? '…' : <Icon name="plus" size={16} />}</button>
            </div>
            <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />

            {upNext.length === 0
              ? <div className="mus2-empty">{tracks.length === 0
                  ? 'Пусто. Вставь ссылку — Spotify, YouTube, SoundCloud или прямой .mp3.'
                  : 'Это последний трек. Открой трекотеку и выбери, что дальше.'}</div>
              : <div className="mus2-upnext">
                  {upNext.map(({ t, i, manual }) => {
                    const art = meta[t.url]?.art || t.art
                    return (
                      <div key={'q' + t.id} className={'mus2-up' + (manual ? ' manual' : '')}
                        title={(meta[t.url]?.title || t.name) + (manual ? ' · добавлен в очередь вручную' : '')}
                        onClick={() => { if (guest) { toastErr(noGuest); return } playAt(i); setPlaying(true) }}>
                        <div className="mus2-up-art">
                          {art ? <img src={art} alt="" loading="lazy" /> : <Icon name="music" size={18} />}
                          {manual && <span className="mus2-up-mark" title="Добавлен вручную"><Icon name="plus" size={10} /></span>}
                          <button className="mus2-up-x" title="Убрать из очереди"
                            onClick={e => { e.stopPropagation(); dropFromQueue(t.id) }}><Icon name="close" size={11} /></button>
                        </div>
                        <div className="mus2-up-t notr" translate="no">{meta[t.url]?.title || t.name}</div>
                      </div>
                    )
                  })}
                  {moreAfter > 0 && <div className="mus2-up mus2-up-more" title="Открыть трекотеку"
                    onClick={() => setShowLib(true)}>
                    <div className="mus2-up-art"><span className="mus2-up-morecnt">+{moreAfter}</span></div>
                    <div className="mus2-up-t">ещё</div>
                  </div>}
                </div>}
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

        <section className={'mus2-now' + (lyrMode === 'karaoke' ? ' karaoke' : '')}>
          {showLeft && <img className="mus-gif l" src={gif.url} alt="" />}
          {/* v1.394.0: текст фоном — за обложкой, приглушённо. Строки не
              перехватывают мышь: под ними живая обложка и кнопки. */}
          {lyrMode === 'back' && lyr && <div className="mus2-lyrback" aria-hidden="true">
            <div className="mus2-lyrback-in"
              style={{ transform: `translateY(calc(-1.05em - ${Math.max(lyrActive, 0) * 2.1}em))` }}>
              {lyr.lines.map((l, i) => (
                <div key={i} className={'mus2-lyrback-l' + (i === lyrActive ? ' on' : '')}>{l.text || '\u00a0'}</div>
              ))}
            </div>
          </div>}
          <div className="mus2-artwrap">
            {curArt && <div className="mus2-artglow" style={{ backgroundImage: `url(${curArt})` }} />}
            <div className={'mus2-vinyl' + (playing ? ' spin' : '')}>{curArt && <img src={curArt} alt="" />}</div>
            <div className="mus2-art">{curArt ? <img src={curArt} alt="" /> : <Icon name="music" size={72} />}</div>
            {/* v1.367.0: честная табличка вместо молчащего плеера. Сервис не даёт
                играть свои треки снаружи, копии не нашлось — так и говорим. */}
            {curStreamOnly && curSvc && <div className="mus2-extonly">
              <div className="mus2-extonly-t">{SERVICE_NAME[curSvc]} не даёт играть свои треки снаружи</div>
              <div className="mus2-extonly-d">Копии в открытых каталогах не нашлось. Обложка и название — здесь, сам трек — там.</div>
              <button className="pqs2-btn" onClick={() => openSafely(cur.url)}>
                <Icon name="external" size={15} /> Открыть в {SERVICE_NAME[curSvc]}
              </button>
            </div>}
          </div>
          {lyrMode === 'karaoke' && lyr && <div className="mus2-karaoke">
            <div className="mus2-karaoke-in"
              style={{ transform: `translateY(calc(-1.2em - ${Math.max(lyrActive, 0) * 2.4}em))` }}>
              {lyr.lines.map((l, i) => (
                <div key={i} className={'mus2-kline' + (i === lyrActive ? ' on' : i < lyrActive ? ' past' : '')}
                  onClick={() => { const a = audioRef.current; if (a && l.t !== null) { a.currentTime = l.t; setCurT(l.t) } }}
                  title={l.t !== null ? 'Перейти к строке' : undefined}>{l.text || '\u00a0'}</div>
              ))}
            </div>
          </div>}
          <div className="mus2-nowt">{cur ? (curMeta?.title || cur.name) : 'Ничего не играет'}</div>
          <div className="mus2-nowsub">{cur ? (curSc ? (curMeta?.author || cur.author || 'Трекотека') : curYt ? (curMeta?.author ? curMeta.author + ' · YouTube' : 'YouTube') : cur.kind === 'url' ? (curMeta?.author || cur.author || 'по ссылке') : 'файл · ' + cur.owner) : 'Добавь трек, чтобы начать'}</div>
          {/* v1.396.0: что происходит с текстом — словами. Раньше эти подсказки
              вычислялись и никуда не выводились: человек видел пустой экран и не
              знал, ищут ли текст, не нашли его или поиск вообще выключен. */}
          {lyrCfg.mode !== 'off' && lyrNote && <div className="mus2-lyrnote">{lyrNote}</div>}
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
            onChange={e => { const v = +e.target.value; if (curSc) { widgetRef.current?.seekTo(v * 1000); setCurT(v) } else if (curYt) { try { ytRef.current?.seekTo(v, true) } catch {}; setCurT(v) } else { const a = audioRef.current; if (a) { a.currentTime = v; setCurT(v) } } }} disabled={!cur || guest} title={guest ? noGuest : undefined} />
          <span>{fmt(dur)}</span>
        </div>
        <div className="mus2-ctlrow">
          <div className="mus2-vol"><Icon name="volume" size={16} /> <input type="range" min={0} max={100} value={vol} onChange={e => setVol(+e.target.value)} /></div>
          <div className="mus2-ctl">
            <button className={shuffle ? 'on' : ''} title={guest ? noGuest : 'Перемешать'} disabled={guest} onClick={() => setShuffle(s => !s)}><Icon name="shuffle" size={18} /></button>
            <button title={guest ? noGuest : 'Предыдущий'} onClick={prev} disabled={!tracks.length || guest}><Icon name="skip-back" size={18} /></button>
            <button className="big" title={guest ? noGuest : undefined} onClick={() => setPlaying(p => !p)} disabled={!tracks.length || guest}>{playing ? <Icon name="pause" size={20} /> : <Icon name="play" size={20} />}</button>
            <button title={guest ? noGuest : 'Следующий'} onClick={next} disabled={!tracks.length || guest}><Icon name="skip-forward" size={18} /></button>
            <button className={repeat !== 'off' ? 'on' : ''} title={guest ? noGuest : repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повторять весь список' : 'Повторять один трек'} disabled={guest} onClick={() => setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')}><Icon name="repeat" size={18} />{repeat === 'one' ? <span className="mus2-repeat-one">1</span> : null}</button>
          </div>
          <div className="mus2-extra">
            <button className="mus2-inpl" onClick={() => cur && addToPlaylist(cur.id)} disabled={!cur}><Icon name="plus" size={15} /> В плейлист</button>
            {/* v1.394.0: свой текст песни — без интернета и без чужих серверов. */}
            <button className={'mus2-inpl' + (lyr ? ' on' : '')} disabled={!cur || !lyrMine}
              title={!lyrMine ? 'Текст ставит тот, кто выложил трек'
                : lyrCfg.mode === 'off' ? 'Показ текста выключен в настройках плеера' : 'Текст песни'}
              onClick={() => setLyrEdit(lyr?.raw ?? '')}><Icon name="music" size={15} /> Текст</button>
            <button className={'mus2-tog' + (together ? ' on' : '')} onClick={() => setTogetherUi(true)}>
              <Icon name="users" size={15} /> Вместе
              {together && lobby.length > 0 ? <span className="mus2-tog-n">{lobby.length}</span> : null}
            </button>
          </div>
        </div>
      </footer>

      {/* v1.379.0: «Вместе» — отдельное окно, а не выпадашка на наведении.
          Прежняя закрывалась, стоило увести мышь, и в ней помещался только код;
          с кем ты слушаешь — не было видно нигде. */}
      {togetherUi && <Portal>
        <div className="modal-overlay" onClick={() => setTogetherUi(false)}>
          <div className="modal tog-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setTogetherUi(false)}><Icon name="close" size={18} /></button>
            <div className="modal-title">Слушать вместе</div>

            {together ? <>
              <div className="tog-code-box">
                <div className="tog-code-lbl">Код лобби</div>
                {/* Сам код тоже копирует: если буфер почему-то недоступен, текст
                    хотя бы выделяется одним щелчком и его можно взять руками. */}
                <div className="tog-code notr" translate="no" title="Нажми, чтобы скопировать"
                  onClick={() => void copyText(together.code, 'Код скопирован')}>{together.code}</div>
                <button className="pqs2-btn" onClick={() => void copyText(together.code, 'Код скопирован')}>
                  <Icon name="copy" size={15} /> Скопировать
                </button>
              </div>
              <div className="tog-hint">
                {together.host
                  ? 'Ты ведущий: что играет у тебя, то играет у всех. Отдай код тому, кого зовёшь.'
                  : 'Ты слушаешь вместе с ведущим — переключение треков за ним.'}
              </div>

              <label className="modal-lbl">В лобби{lobby.length > 0 ? ` — ${lobby.length}` : ''}</label>
              {lobby.length === 0
                ? <div className="tog-empty">Пока никого. Отдай код — и человек появится здесь.</div>
                : <div className="tog-list">
                    {lobby.map(u => (
                      <div key={u.id} className="tog-row">
                        <Avatar name={u.name} url={u.avatar} userId={u.id} size={28} />
                        <span className="tog-nm notr" translate="no">{u.name}</span>
                        {u.host && <span className="tog-host">ведущий</span>}
                        {u.id === meId && <span className="tog-me">это ты</span>}
                      </div>
                    ))}
                  </div>}

              <div className="modal-foot">
                <button className="modal-ghost" onClick={() => setTogetherUi(false)}>Закрыть</button>
                <button className="modal-primary danger" onClick={() => { setTogether(null); setTogetherUi(false) }}>Выйти из лобби</button>
              </div>
            </> : <>
              <div className="tog-hint">
                Один человек включает музыку, остальные слышат то же и тогда же.
                Треки берутся из трекотеки — она общая, так что у всех они есть.
              </div>
              <div className="modal-foot tog-foot">
                <button className="modal-primary" onClick={() => { startTogether(); }}>
                  <Icon name="plus" size={15} /> Создать лобби
                </button>
                <button className="modal-ghost" onClick={() => { void joinTogether() }}>Войти по коду</button>
              </div>
            </>}
          </div>
        </div>
      </Portal>}

      {/* v1.374.0: трекотека — отдельное меню поверх приложения, а не выдвижная
          часть плеера. Это разные дела: плеер отвечает «что играет», трекотека —
          «что у меня есть», и склад на сотню записей не должен ютиться в узкой
          колонке рядом с обложкой. */}
      {showLib && <Portal><div className="mus2-lib" onClick={() => setShowLib(false)}>
        <div className="mus2-lib-inner" onClick={e => e.stopPropagation()}>
          <header className="mus2-lib-head">
            <b>Ponoi Music · Трекотека</b>
            <input className="mus2-in" placeholder="Поиск по названию или исполнителю…" value={libQ} onChange={e => setLibQ(e.target.value)} />
            <button className="mus2-lib-x" onClick={() => setShowLib(false)}><Icon name="close" size={16} /></button>
          </header>
          {/* v1.371.0: сетка карточек вместо строчек, как на главной Spotify.
              Кто выложил трек — убрано: в списке из сотни записей это ничего не
              говорит и только занимает место, а обложка узнаётся мгновенно. */}
          <div className="mus2-lib-body">
            {(() => {
              const q = libQ.trim().toLowerCase()
              const shown = tracks.filter(t => {
                if (!q) return true
                const title = (meta[t.url]?.title || t.name || '').toLowerCase()
                const author = (meta[t.url]?.author || t.author || '').toLowerCase()
                return title.includes(q) || author.includes(q)
              })
              if (tracks.length === 0) {
                return <div className="mus2-empty center">Трекотека пуста. Добавь трек — его увидят все.</div>
              }
              if (shown.length === 0) {
                return <div className="mus2-empty center">Ничего не нашлось по запросу «{libQ.trim()}»</div>
              }
              return <>
                <div className="mus2-lib-count">{shown.length === tracks.length
                  ? `Треков: ${tracks.length}`
                  : `Найдено: ${shown.length} из ${tracks.length}`}</div>
                <div className="mus2-grid">
                  {shown.map(t => {
                    const i = tracks.indexOf(t)
                    const art = meta[t.url]?.art || t.art
                    const author = meta[t.url]?.author || t.author
                    const title = meta[t.url]?.title || t.name
                    const on = i === idx
                    return (
                      <div key={t.id} className={'mus2-card' + (on ? ' on' : '')}
                        title={title + (author ? ' — ' + author : '')}
                        onClick={() => { if (guest) { toastErr(noGuest); return } playAt(i); setPlaying(true); setShowLib(false) }}>
                        <div className="mus2-card-art">
                          {art ? <img src={art} alt="" loading="lazy" /> : <Icon name="music" size={34} />}
                          {/* Кнопка появляется на наведении и по фокусу — до неё
                              можно дойти и с клавиатуры, а не только мышью. */}
                          <button className="mus2-card-play" tabIndex={-1} aria-hidden
                            onClick={e => { e.stopPropagation(); playAt(i); setPlaying(true); setShowLib(false) }}>
                            <Icon name={on && playing ? 'pause' : 'play'} size={18} />
                          </button>
                          {/* v1.374.0: поставить в очередь, не бросая то, что играет. */}
                          {!guest && <button className="mus2-card-q" title="Поставить следующим"
                            onClick={e => { e.stopPropagation(); queueNext(t.id) }}>
                            <Icon name="plus" size={15} />
                          </button>}
                          {/* v1.376.0: удаление вернулось сюда. Кнопка жила в старом
                              вертикальном списке очереди и исчезла вместе с ним —
                              убрать трек из трекотеки стало нечем вовсе. */}
                          {!guest && <button className="mus2-card-del" title="Убрать из трекотеки"
                            onClick={e => { e.stopPropagation(); void removeTrack(t.id, title) }}>
                            <Icon name="trash" size={14} />
                          </button>}
                          {t.dur ? <span className="mus2-card-d">{fmt(t.dur)}</span> : null}
                        </div>
                        <div className="mus2-card-t notr" translate="no">{title}</div>
                        <div className="mus2-card-a">
                          <span className="notr" translate="no">{author || ''}</span>
                          {/* v1.377.0: сколько раз слушали все. Ноль не пишем: «0
                              прослушиваний» ничего не сообщает, только шумит. */}
                          {(t.plays ?? 0) > 0 && <span className="mus2-card-p" title="Прослушиваний">
                            <Icon name="play" size={10} />{fmtPlays(t.plays ?? 0)}
                          </span>}
                          {!author && !(t.plays ?? 0) ? '\u00a0' : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            })()}
          </div>
        </div>
      </div></Portal>}

      {curYt && ytId && <iframe key={ytId} ref={ytFrameRef} className="mus2-ytframe" title="YouTube" allow="autoplay; encrypted-media"
        src={'https://www.youtube.com/embed/' + ytId + '?enablejsapi=1&playsinline=1&controls=0&rel=0'} />}
      <audio ref={audioRef} src={audioSrc}
        onEnded={next}
        onTimeUpdate={e => setCurT((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration)} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} />}
      {/* v1.394.0: окно текста песни. Через портал, как и остальные окна плеера:
          изнутри .mus2 со своим слоем окно не выбирается и прижимается к низу. */}
      {lyrEdit !== null && cur && <Portal>
        <div className="modal-overlay" onClick={() => setLyrEdit(null)}>
          <div className="modal lyr-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setLyrEdit(null)}><Icon name="close" size={18} /></button>
            <div className="modal-title">Текст песни</div>
            <div className="lyr-sub">{curMeta?.title || cur.name}</div>
            <div className="lyr-hint">
              Обычный текст поплывёт фоном. Для караоке нужны метки времени в формате LRC —
              строка вида <code>[01:23.45] слова строки</code>: по ним видно, когда её поют.
              Текст сохраняется для всех в Трекотеке — ставит его тот, кто выложил трек.
            </div>
            <textarea className="lyr-area" autoFocus value={lyrEdit} onChange={e => setLyrEdit(e.target.value)}
              placeholder={'Вставь текст песни сюда. Для караоке — со строками вида [00:12.50] слова'} />
            {lyrEdit.trim() && <div className="lyr-state">
              {parseLyrics(lyrEdit).synced
                ? '✓ Метки времени найдены — караоке будет работать'
                : 'Меток времени нет — текст покажется фоном, караоке для него невозможно'}
            </div>}
            <div className="lyr-btns">
              {lyr && <button className="pqs2-btn ghost danger" disabled={lyrBusy} onClick={() => keepLyrics('')}>Убрать текст</button>}
              <button className="pqs2-btn ghost" onClick={() => setLyrEdit(null)}>Отмена</button>
              <button className="pqs2-btn primary" disabled={lyrBusy} onClick={() => keepLyrics(lyrEdit)}>{lyrBusy ? 'Сохраняю…' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      </Portal>}
    </main>
    {!visible && cur && (
      // v1.381.0: плашку можно утащить куда угодно, пока тащишь — она сворачивается
      // в кружок. Полоса шириной в треть экрана, летающая за курсором, закрывает
      // больше, чем стояла на месте.
      <div ref={miniDrag.ref} className={'mus-mini' + (miniDrag.dragging ? ' dragging' : '')}
        style={{ ...musStyle, ...miniDrag.style }} onPointerDown={miniDrag.onPointerDown}>
        <div className={'mus-mini-art' + (playing ? ' spin' : '')}
          onClick={() => { if (!miniDrag.wasDrag()) onClose() }} title="Открыть плеер · тяни, чтобы переставить">
          {/* v1.386.0: без запрета перетаскивания браузер тащил саму картинку —
              вместо плашки за курсором ехала копия обложки, и переставить её
              было почти невозможно. */}
          {curArt ? <img src={curArt} alt="" draggable={false} onDragStart={e => e.preventDefault()} /> : <Icon name="music" size={18} />}
        </div>
        <div className="mus-mini-meta" onClick={() => { if (!miniDrag.wasDrag()) onClose() }} title="Открыть плеер">
          <div className="mus-mini-t">{curMeta?.title || cur.name}</div>
          <div className="mus-mini-s">{curMeta?.author || cur.author || (cur.kind === 'file' ? 'файл' : 'Ponoi Music')}</div>
        </div>
        <button className="mm-play" onPointerDown={e => e.stopPropagation()} title={guest ? noGuest : playing ? 'Пауза' : 'Играть'} onClick={() => setPlaying(pl => !pl)} disabled={!cur || guest}>
          {playing ? <Icon name="pause" size={15} /> : <Icon name="play" size={15} />}
        </button>
        <button onPointerDown={e => e.stopPropagation()} title={guest ? noGuest : 'Следующий'} onClick={next} disabled={tracks.length < 2 || guest}><Icon name="skip-forward" size={15} /></button>
        <button onPointerDown={e => e.stopPropagation()} title="Выключить музыку" onClick={() => { setPlaying(false); onStop() }}><Icon name="close" size={15} /></button>
      </div>
    )}
  </>)
}