import { toastErr, toastOk } from '../lib/toast'
import { recommend, libraryOrder, WHY_LABEL } from './personalQueue'
import { markFailed, markOk, isBroken, BROKEN_AFTER, isEmbedDeniedCode, markNoEmbed, isNoEmbed, forgetBroken, forgetNoEmbed, pauseKind, playKind, silenceStuck, SILENCE_MS, pushFail, sourceDown, type FailMark } from './broken'
import { setMusicBridge } from '../lib/plugins/musicApi'
import { emitPluginEvent } from '../lib/plugins/bridge'
import { PluginPanels } from '../components/PluginPanels'
import { promptUi, confirmUi } from '../lib/confirm'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track, BgCfg } from './types'
import { BG_IDB_KEY } from './types'
import { idbGet } from '../lib/idb'
import { supabase } from '../lib/supabase'
import { usePresence } from '../lib/presence'
import { uploadTo } from '../lib/storage'
import { fetchTracks, fetchTracksPage, fetchTracksAfter, tracksCount, rowToTrack, TRACKS_PAGE, addTrack, removeTrackDb, updateTrackMeta, isDuplicateTrack, recordPlay, myPlayCounts } from '../lib/music'
import { mergeTracks } from './mergeTracks'
import { sendTrackToFriend } from './shareTrack'
import { trackScore, suggestQuery } from './fuzzy'
import { buildDsp, readDsp, dspActive, type DspSettings, type DspChain } from './dsp'
import { setAnalyser, spectrumWanted, onSpectrumWanted } from './spectrum'
// v1.453.0: «Подборка» убрана по просьбе владельца — кнопка ушла из Трекотеки.
// Сам подбор никуда не делся: он и был подбором волны, который работает
// дальше (см. recommend). Убрана именно кнопка, а не умение.
import { emptyHist, pushPlayed, back as histBack, forward as histForward, recentIds, canForward, type Hist } from './history'
import { loadLibrary, saveLibrary, libraryPlan } from './libCache'
import { MIN_TRACK_SEC, tooShortWhy, audioDuration } from './minLength'
import {
  normalizePlaylists, createPlaylist, renamePlaylist, removePlaylist,
  addTrackTo, addFailText, setPlaylistCover, removeFromPlaylist, movePlaylistTrack,
  playlistsOrder, playlistTracks, playlistSize, PL_NAME_MAX, PL_TRACKS_MAX, type Playlist,
} from './playlists'
import { advance, credited, freshListened, type Listened } from './playCredit'
import { IS_MOBILE } from '../lib/mobile'
import { Capacitor } from '@capacitor/core'
import { keepAliveAction, keepAliveAsked, canKeepAlive, askKeepAlive, startKeepAlive, stopKeepAlive, onMediaKey, mediaSeeked } from '../lib/keepAlive'
/** Приложение на Android: только там есть постоянная служба (v1.444.0). */
const IS_NATIVE = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
import { useBackClose } from '../lib/mobileBack'
import { bindMediaKeys, setMediaNow, updateMediaPosition } from './mediaSession'
import { needRepublish, REPUBLISH_TOLERANCE } from '../lib/listenProgress'
import { startLongPress } from '../lib/longPress'
import { chunksToLrc, alignPlainToChunks, whyCantRecognize, type AiProgress } from './aiLyrics'
import { listenToTrack } from './aiListen'

/** Крупные числа сокращаем: «1.2K» вместо «1247» — на карточке важнее порядок. */
const fmtPlays = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'K' : String(n)
import { MusicSettings, loadGif, loadBg, loadLyricsCfg } from './MusicSettings'
import { parseLyrics, activeLineIndex, loadLyrics, saveLyrics, searchLyricsOnline, lyricsScale, lyricsTime, lyricsShift, setLyricsShift, centerScrollTop, autoScrollOk, LYRICS_HOLD_MS, lyricsScrollMs, lyricsEase, livePosition, type Lyrics } from './lyrics'
import { Icon } from '../components/icons'
import { Portal } from '../components/Portal'
import { Avatar } from '../components/Avatar'
import { copyText } from '../lib/copyMedia'
import { isSoundcloudUrl, scMeta, cachedMeta as scCached, scResolveTracks, lastImportSkipped, loadWidgetApi, widgetSrc, cleanScUrl, type ScMeta } from './soundcloud'
import { normalizeTrackUrl, sameTrack } from './trackUrl'
import { resolveNext, type StopWhy } from './nextTrack'
import { useDragBar } from './useDragBar'
import { isYouTubeUrl, parseYouTubeId, ytMeta, isAudiusUrl, audiusMeta, loadYtApi, cachedMeta as srcCached } from './sources'
import { planMeta, seedFromCache, needsFetch } from './metaPlan'
import { saveSession, loadSession, clearSession, worthSaving, findTrack } from './session'
import { LiveBg } from './MusicLiveBg'
import { serviceOf, streamingMeta, findPlayable, titleFromUrl, isStreamingUrl, SERVICE_NAME } from './streaming'
import { openSafely } from '../lib/safeUrl'
import { artColor, boost, lighten, scale, rgb, type Rgb } from './artColor'
import { getUserPrefs, patchUserPrefs } from '../lib/userPrefs'

// v1.428.0: сами действия над плейлистами — в music/playlists.ts, с проверками.

// Плейлисты синхронизируются через user_prefs (миграция 39), как остальные личные настройки.
function loadPlaylists(): Playlist[] { return normalizePlaylists(getUserPrefs().mus_playlists) }
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
  /** v1.462.0: сколько треков в базе всего — показывается сразу. */
  const [libTotal, setLibTotal] = useState<number | null>(null)
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
  // v1.420.0: треки, которым YouTube отказал во встраивании прямо сейчас.
  // Список в состоянии нужен, чтобы плеер тут же перерисовался и пошёл через
  // копию; на диске это же помнится отдельно (isNoEmbed), чтобы в следующий раз
  // не биться в тот же отказ.
  const [ytDenied, setYtDenied] = useState<string[]>([])
  const [lyrNote, setLyrNote] = useState('')
  const [bgUrl, setBgUrl] = useState<string>('')
  const [curT, setCurT] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(() => Number(localStorage.getItem('ponoi_mus_vol') || '100'))
  const [tab, setTab] = useState<'queue' | 'playlists'>('queue')
  const [scUrl, setScUrl] = useState('')
  const [showLib, setShowLib] = useState(false)
  // v1.410.0: сколько карточек склада показано сейчас.
  //
  // Раньше рисовались все разом. На трёх сотнях треков это триста карточек с
  // обложками в одном кадре — окно просто вставало, и выглядело это как «после
  // трёхсотой не грузит». Показываем порциями, добавка — по кнопке.
  const LIB_PAGE = 60
  const [libShown, setLibShown] = useState(LIB_PAGE)
  // v1.416.0: подгрузка по прокрутке вместо кнопки. Наблюдатель следит за меткой
  // в конце списка: показалась на экране — добавляем порцию. Так склад листается
  // бесконечно, а рисуется по-прежнему кусками, и большие склады не вешают окно.
  const libEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = libEndRef.current
    if (!showLib || !el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setLibShown(n => n + LIB_PAGE)
    }, { rootMargin: '400px' })   // начинаем заранее, чтобы не было рывка
    io.observe(el)
    return () => io.disconnect()
  })
  const [libQ, setLibQ] = useState('')
  /** Вкладка склада: треки или плейлисты (v1.428.0). */
  const [libTab, setLibTab] = useState<'tracks' | 'playlists'>('tracks')
  /** Открытый плейлист — его содержимое показывается вместо сетки. */
  const [openPl, setOpenPl] = useState<string | null>(null)
  // «Назад» на телефоне закрывает и выбор плейлиста, и открытый плейлист.
  useBackClose(!!openPl, () => setOpenPl(null))
  /**
   * Меню карточки склада (v1.426.0). Открывается правым щелчком и долгим
   * нажатием — там живёт всё, что раньше висело кнопками поверх обложки.
   */
  const [cardMenu, setCardMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(null)
  // Открыли склад заново или начали искать — снова с первой порции.
  useEffect(() => { setLibShown(LIB_PAGE) }, [showLib, libQ])
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
  /**
   * Обработка звука (v1.442.0): эквалайзер, «глухо», эхо.
   *
   * Работает только для того звука, который приложение играет само. У YouTube и
   * SoundCloud звук живёт внутри их окна, и добраться до него нечем — там
   * обработка не применяется, и в настройках об этом написано прямо.
   *
   * Цепочка строится ОДИН раз на элемент: createMediaElementSource можно позвать
   * для одного элемента ровно однажды, второй вызов бросает ошибку и оставляет
   * плеер без звука совсем — это первое, на чём тут можно всё сломать.
   */
  const [dsp, setDsp] = useState<DspSettings>(() => readDsp(localStorage.getItem('ponoi_mus_dsp')))
  const dspRef = useRef<{ ctx: AudioContext; src: MediaElementAudioSourceNode; chain: DspChain } | null>(null)
  // v1.491.0: цепочка строится ещё и тогда, когда спектр нужен плагину.
  //
  // Раньше условие было только про эффекты, и визуализатор в плагине получал
  // тишину, пока человек не включит эквалайзер, — то есть работал бы через раз
  // и необъяснимо. Сама цепочка при выключенных эффектах прозрачна: настройки
  // применяются ровно те же (apply(dsp)), просто все на нуле.
  const [спектрНужен, setСпектрНужен] = useState(false)
  useEffect(() => onSpectrumWanted(() => setСпектрНужен(true)), [])
  useEffect(() => {
    const el = audioRef.current
    const нужно = dspActive(dsp) || спектрНужен || spectrumWanted()
    if (!el || !нужно) { dspRef.current?.chain.apply(dsp); return }
    if (!dspRef.current) {
      try {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext
        const ctx: AudioContext = new Ctor()
        const src = ctx.createMediaElementSource(el)
        const chain = buildDsp(ctx, ctx.destination)
        src.connect(chain.input)
        // Анализатор висит ОТДЕЛЬНОЙ веткой и никуда не ведёт дальше: он не
        // выход, а измеритель. Подключи его к destination — и звук пошёл бы
        // дважды, вдвое громче.
        const a = ctx.createAnalyser()
        a.fftSize = 512
        a.smoothingTimeConstant = 0.75
        src.connect(a)
        setAnalyser(a)
        dspRef.current = { ctx, src, chain }
      } catch { return }   // нет WebAudio — играем как есть, это не повод падать
    }
    const d = dspRef.current
    if (!d) return
    if (d.ctx.state === 'suspended') void d.ctx.resume().catch(() => {})
    d.chain.apply(dsp)
  }, [dsp, спектрНужен])
  useEffect(() => () => {
    setAnalyser(null)
    dspRef.current?.chain.dispose()
    void dspRef.current?.ctx.close().catch(() => {})
  }, [])
  const saveDsp = (d: DspSettings) => {
    setDsp(d)
    try { localStorage.setItem('ponoi_mus_dsp', JSON.stringify(d)) } catch { /* переполнено */ }
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const togChan = useRef<any>(null)
  const scRef = useRef<HTMLIFrameElement>(null)
  /** Сколько раз пробовали продолжить самопроизвольно вставший SC-трек (v1.421.0). */
  const scResumeRef = useRef(0)
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

  // Ссылки на текущее — для обработчиков, которые живут дольше одного рендера.
  // Обработчик отказа тоже нужен через ссылку: плеер YouTube создаётся один
  // раз, и в его замыкании иначе застынет функция с первого рендера.
  const trackFailedRef = useRef<(reason: string, forId?: string) => void>(() => {})
  /** id трека, который играет прямо сейчас, — им подписываются отказы источников. */
  const curTrackIdRef = useRef<string>('')
  const idxRef = useRef(0); idxRef.current = idx
  // v1.443.0: переключать трек — только через это. Раньше «дальше» считало
  // следующий номер от idx из состояния, а состояние до перерисовки не
  // меняется: два быстрых нажатия подряд оба считали от ОДНОЙ позиции и
  // приводили в один и тот же трек — второе нажатие пропадало впустую. На
  // телефоне, где по кнопке бьют пальцем несколько раз, это выглядело как
  // «перемотка залипла». Ссылка двигается сразу, поэтому следующее нажатие
  // считает уже от нового места.
  const goIdx = (n: number) => { idxRef.current = n; setIdx(n) }
  const tracksRef = useRef(tracks); tracksRef.current = tracks
  const cur = tracks[idx]
  // v1.412.0: играющий трек держится за себя, а не за место в списке.
  //
  // Трекотека общая и живая: пока идёт песня, кто-то с другого устройства
  // может убрать трек, стоящий выше по списку. Номер при этом оставался
  // прежним, список сдвигался — и плеер молча начинал играть соседнюю песню.
  // Удаление со СВОЕГО устройства такой случай уже разбирало (v1.376.0), а
  // чужое — нет, хотя оно ровно то же самое.
  const curIdRef = useRef<string | null>(null)
  useEffect(() => { if (cur?.id) curIdRef.current = cur.id }, [cur?.id])
  useEffect(() => {
    const id = curIdRef.current
    if (!id || tracks.length === 0) return
    if (tracks[idx]?.id === id) return
    const i = tracks.findIndex(t => t.id === id)
    if (i >= 0) { goIdx(i); return }
    // Трек убрали у всех — молча играть вместо него соседний нельзя.
    curIdRef.current = null
    setPlaying(false)
    toastErr('Трек убрали из Трекотеки')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])
  const curScLink = !!cur && isSoundcloudUrl(cur.url)
  // v1.420.0: у трека, который сервис отказался отдавать (официальные клипы на
  // YouTube, закрытые для встраивания загрузки на SoundCloud), появляется
  // найденная копия — и тогда он идёт обычным звуком, а не через чужой виджет,
  // который для него всё равно откажет.
  const curNoEmbed = !!cur && (ytDenied.includes(cur.id) || isNoEmbed(cur.id))
  // Копия — это ссылка, по которой играет обычный <audio>. Адрес самого сервиса
  // копией не считается: у SoundCloud в play_url лежит его же api-ссылка,
  // которой умеет пользоваться только его виджет.
  const curPlayRaw = (cur ? (meta[cur.url]?.play || cur.play) : null) ?? null
  const curCopy = curPlayRaw && !isSoundcloudUrl(curPlayRaw) && !isYouTubeUrl(curPlayRaw) ? curPlayRaw : null
  const curYtLink = !!cur && !curScLink && isYouTubeUrl(cur.url)
  const curYt = curYtLink && !(curNoEmbed && !!curCopy)
  const curSc = curScLink && !(curNoEmbed && !!curCopy)
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
  // v1.420.0: у отказавшего трека играем НАЙДЕННУЮ КОПИЮ, а не адрес сервиса:
  // страницу YouTube или SoundCloud <audio> не воспроизведёт и молча замолчит —
  // а это ровно то, что человек видит как «плеер встал».
  const audioSrc = cur && !curSc && !curYt && !curStreamOnly
    ? (curYtLink || curScLink ? (curCopy || undefined) : (curPlayable || cur.url))
    : undefined
  const acc = color ? boost(color) : null
  const musStyle = acc ? ({
    '--mus-a': rgb(acc),
    '--mus-a2': rgb(lighten(acc)),
    '--mus-a-soft': rgb(acc, .22),
    // v1.435.0: те же цифры без обёртки rgb() — для свечения поющейся строки,
    // где нужен именно набор чисел внутри rgba(..., прозрачность).
    '--mus-a-rgb': acc.r + ',' + acc.g + ',' + acc.b,
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
  // наушниках.
  //
  // v1.425.0: всё это переехало в src/music/mediaSession.ts и заодно доделано.
  // Здесь были только метаданные и четыре кнопки: полосы в системной карточке
  // не было вовсе (setPositionState никто не звал), перемотку системе отдать
  // было нечем, а метаданные пересобирались на каждое изменение — карточка
  // мигала обложкой. Сама подписка и обновление — ниже, рядом с активностью:
  // там же считается всё, что нужно системе.

  // v1.427.0: на телефоне то же делает системная «назад» — иначе она закрывала
  // приложение вместе с музыкой.
  useBackClose(showLib, () => setShowLib(false))
  useBackClose(lyrEdit !== null, () => setLyrEdit(null))
  useBackClose(!!cardMenu, () => setCardMenu(null))
  // Сам плеер: «назад» сворачивает его в плашку, а не выходит из приложения.
  useBackClose(visible, onClose)

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
        void autoRecognize(t, '')
        return
      }
      setLyrNote('Ищу текст…')
      const found = await searchLyricsOnline(curMeta?.title || t.name, curMeta?.author || t.author || '', dur || t.dur)
      if (!ok) return
      if (!found.ok) {
        setLyrNote(found.why === 'net'
          ? 'Не получилось спросить lrclib.net — нет сети или сервис молчит.'
          : 'Текст не нашёлся в каталоге. Кнопка «Текст» — вставить свой.')
        void autoRecognize(t, '')
        return
      }
      raw = found.hit.text
      setLyr(parseLyrics(raw))
      setLyrNote('Текст найден: ' + found.hit.by)
      void saveLyrics(t.id, raw, t.ownerId === meId)
      // v1.420.0: слова нашлись, а меток времени в каталоге нет — караоке
      // невозможно. Ровно тот случай, где ИИ полезнее всего: слова остаются
      // выверенными, а время берётся из самой записи.
      if (!found.hit.synced) void autoRecognize(t, raw)
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
  // v1.420.0: караоке показывается и без меток времени. Раньше текст без них
  // уезжал в фон за обложку — то есть прочитать его было нельзя, а пролистать
  // и вовсе: фон мышь не перехватывает. Подсветки без меток по-прежнему нет и
  // выдумывать её никто не будет, но САМ ТЕКСТ человек видит и листает.
  const lyrMode: 'off' | 'back' | 'karaoke' =
    lyrCfg.mode === 'off' || !lyr || lyr.lines.length === 0 ? 'off'
    : lyrCfg.mode === 'karaoke' ? 'karaoke' : 'back'
  // v1.404.0: время, по которому ищем строку, — не то же самое, что время
  // трека. Метки сняты с другой записи: у ускоренной версии песня короче, и
  // разница копится к концу; плюс ручная поправка и небольшой взгляд вперёд,
  // потому что об истёкшем времени приложение узнаёт с задержкой в четверть
  // секунды (у YouTube — полсекунды).
  const [lyrShift, setLyrShiftState] = useState(0)
  useEffect(() => { setLyrShiftState(cur ? lyricsShift(cur.id) : 0) }, [cur?.id])
  const lyrK = lyr && lyr.synced ? lyricsScale(lyr.srcDur, dur || cur?.dur) : 1
  // v1.440.0: текст идёт по ДОСЧИТАННОМУ времени, а не по последнему сообщению.
  //
  // Позиция приезжает рывками (YouTube — раз в полсекунды), и между рывками
  // приложение считало, что песня стоит: строка вспыхивала не когда её запели, а
  // когда пришло очередное сообщение. Ошибка гуляла от нуля до полусекунды —
  // ровно то, что видно как «текст то отстаёт, то прыгает вперёд».
  //
  // Отдельные часы, тикающие ради этого: двадцать раз в секунду, только пока
  // открыт текст и идёт музыка. Караоке — единственное место, где такая точность
  // нужна; полосе времени и всему остальному хватает и рывков.
  const posAtRef = useRef(0)
  useEffect(() => { posAtRef.current = Date.now() }, [curT])
  const [lyrTick, setLyrTick] = useState(0)
  useEffect(() => {
    if (!lyr?.synced || !playing || lyrMode === 'off') return
    const id = window.setInterval(() => setLyrTick(v => v + 1), 50)
    return () => window.clearInterval(id)
  }, [lyr?.synced, playing, lyrMode])
  const lyrPos = lyr && lyr.synced
    ? livePosition(curT, posAtRef.current, Date.now(), playing)
    : curT
  const lyrActive = lyr && lyr.synced
    ? activeLineIndex(lyr.lines, lyricsTime(lyrPos, lyrK, lyrShift))
    : -1
  void lyrTick   // от него зависит только пересчёт выше
  /**
   * Поющаяся строка всегда посередине, а текст можно листать (v1.420.0).
   *
   * Раньше список сдвигался расчётом «номер строки × высота строки». На
   * коротких строках это совпадало, а первая же длинная переносилась на два
   * ряда — и дальше весь текст съезжал вниз тем сильнее, чем больше таких
   * строк было выше. К середине песни поющаяся строка уходила из центра, а
   * иногда и за край: выглядело это как «текст отстал».
   *
   * Теперь центр считается по измеренной строке (centerScrollTop), а сам блок
   * стал обычным прокручиваемым списком: его можно листать руками, и на время
   * этого мы уступаем — вырывать текст из-под пальца на следующей же строке
   * нельзя. Через LYRICS_HOLD_MS ведём снова сами; кнопка «К этой строке»
   * возвращает сразу.
   */
  const kBoxRef = useRef<HTMLDivElement>(null)
  const kLineRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const lyrTouchRef = useRef(0)
  const [lyrHeld, setLyrHeld] = useState(false)

  // v1.435.0: текст едет своим ходом, а не системной плавной прокруткой.
  // Почему — см. lyricsScrollMs: у системной одна скорость на любое расстояние,
  // и соседняя строка тянется столько же, сколько прыжок через припев. Свой ход
  // ещё и прерывается на полуслове без рывка: новая цель просто продолжает
  // движение с того места, где оно сейчас.
  const lyrAnimRef = useRef(0)
  const stopLyrScroll = () => {
    if (lyrAnimRef.current) { cancelAnimationFrame(lyrAnimRef.current); lyrAnimRef.current = 0 }
  }
  const centerLyrLine = (i: number, smooth = true) => {
    const box = kBoxRef.current
    const el = kLineRefs.current.get(i)
    if (!box || !el) return
    const top = centerScrollTop(el.offsetTop, el.offsetHeight, box.clientHeight, box.scrollHeight - box.clientHeight)
    stopLyrScroll()
    if (!smooth || document.body.classList.contains('no-anim')) { box.scrollTop = top; return }
    const from = box.scrollTop
    const dist = top - from
    if (Math.abs(dist) < 1) return
    const ms = lyricsScrollMs(dist)
    const t0 = performance.now()
    const step = (now: number) => {
      const p = (now - t0) / ms
      box.scrollTop = from + dist * lyricsEase(p)
      if (p < 1) lyrAnimRef.current = requestAnimationFrame(step)
      else lyrAnimRef.current = 0
    }
    lyrAnimRef.current = requestAnimationFrame(step)
  }
  useEffect(() => stopLyrScroll, [])

  useEffect(() => {
    if (lyrMode !== 'karaoke' || lyrActive < 0) return
    if (!autoScrollOk(lyrTouchRef.current, Date.now())) return
    centerLyrLine(lyrActive)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrActive, lyrMode])

  // Открыли трек заново — начинаем с начала и снова ведём сами.
  useEffect(() => { lyrTouchRef.current = 0; setLyrHeld(false) }, [cur?.id, lyrMode])

  // Человек листает — уступаем. Ловим именно ЕГО действия (колесо, палец,
  // клавиши), а не событие прокрутки: последнее приходит и от наших собственных
  // сдвигов, и отличить их надёжно нельзя.
  const lyrTouched = () => {
    stopLyrScroll()   // v1.435.0: под пальцем свой ход прекращаем сразу
    lyrTouchRef.current = Date.now()
    setLyrHeld(true)
    window.setTimeout(() => {
      if (autoScrollOk(lyrTouchRef.current, Date.now())) setLyrHeld(false)
    }, LYRICS_HOLD_MS + 50)
  }

  /**
   * Распознать текст на слух (v1.420.0).
   *
   * Два случая, и они разные по смыслу:
   *   • в поле уже есть слова — распознанное идёт ТОЛЬКО как источник времени,
   *     слова остаются те, что вписал человек или нашлись в каталоге;
   *   • поля пусты — берём и слова, и время, и подписываем в самом тексте, что
   *     они услышаны, а не выверены.
   *
   * Не получилось — говорим, что именно: молчащая кнопка на минутной операции
   * это худшее из возможного.
   */
  const [aiRun, setAiRun] = useState<AiProgress | null>(null)
  const aiWhy = whyCantRecognize(audioSrc, curSc || curYt)

  /**
   * Распознать самому, когда текста нигде не нашлось (v1.420.0).
   *
   * Запускается только при включённой настройке и только раз на трек за сессию:
   * работа занимает процессор на минуту-две, и повторять её на каждый повтор
   * песни было бы издевательством. Тихо ничего не делает там, где звук
   * недоступен (YouTube, SoundCloud) — обещать распознавание на встроенном
   * проигрывателе нельзя, его звука у нас нет.
   *
   * known — уже известные слова: тогда из записи берётся ТОЛЬКО время.
   */
  const aiTriedRef = useRef<Set<string>>(new Set())
  async function autoRecognize(t: Track, known: string) {
    if (!lyrCfgRef.current.ai || aiRunRef.current) return
    if (aiTriedRef.current.has(t.id)) return
    // Источник звука берём из ссылки: состояние могло ещё не обновиться, а
    // решение зависит именно от трека, для которого нас позвали.
    const src = srcOfRef.current(t)
    if (whyCantRecognize(src, false) || !src) return
    aiTriedRef.current.add(t.id)
    setLyrNote(known ? 'Меток времени нет — слушаю запись и расставляю их…' : 'Текста нигде нет — слушаю запись…')
    setAiRun({ stage: 'audio', percent: 0, note: 'Начинаю' })
    try {
      const chunks = await listenToTrack(src, p => setAiRun(p))
      // Трек мог уже смениться — тогда результат не наш, и лезть с ним в
      // чужую песню нельзя.
      if (curIdRef.current !== t.id) return
      const built = known ? alignPlainToChunks(known, chunks, dur || t.dur) : chunksToLrc(chunks, dur || t.dur)
      if (!built) {
        setLyrNote(known
          ? 'Распознанное не похоже на этот текст — метки времени не расставил.'
          : 'Ничего разборчивого не услышал — текста нет.')
        return
      }
      setLyr(parseLyrics(built))
      setLyrNote(known ? 'Метки времени расставлены на слух' : 'Текст распознан на слух — слова могут быть с ошибками')
      // Сохраняем как и найденный в интернете: свой трек — для всех, чужой — себе.
      void saveLyrics(t.id, built, t.ownerId === meId)
    } catch (err: any) {
      setLyrNote('Распознать не удалось: ' + (err?.message ?? String(err)))
    } finally {
      setAiRun(null)
    }
  }
  // Ссылки на свежие значения: автозапуск живёт внутри эффекта поиска текста,
  // который нарочно не перезапускается на каждое изменение настроек и плеера.
  const lyrCfgRef = useRef(lyrCfg); lyrCfgRef.current = lyrCfg
  const aiRunRef = useRef(aiRun); aiRunRef.current = aiRun
  const srcOfRef = useRef<(t: Track) => string>(() => '')
  srcOfRef.current = (t: Track) => {
    if (isSoundcloudUrl(t.url)) return ''
    const play = meta[t.url]?.play || t.play || ''
    if (isYouTubeUrl(t.url)) return play   // само видео нам недоступно, только найденная копия
    return play || t.url
  }

  async function recognizeLyricsNow() {
    if (!cur || aiRun) return
    const why = whyCantRecognize(audioSrc, curSc || curYt)
    if (why) { toastErr(why); return }
    setAiRun({ stage: 'audio', percent: 0, note: 'Начинаю' })
    try {
      const chunks = await listenToTrack(audioSrc!, p => setAiRun(p))
      const known = (lyrEdit ?? '').trim()
      const built = known
        ? alignPlainToChunks(known, chunks, dur || cur.dur)
        : chunksToLrc(chunks, dur || cur.dur)
      if (!built) {
        toastErr(known
          ? 'Не удалось привязать слова к записи: распознанное на неё не похоже (инструментал, шум или другой язык). Текст оставил как был.'
          : 'Ничего разборчивого не услышал — похоже, в записи нет пения или оно неразборчиво.')
        return
      }
      // В поле, а не сразу в базу: человек должен увидеть, что получилось, и
      // при желании поправить слова перед сохранением.
      setLyrEdit(built)
      toastOk(known ? 'Метки времени расставлены — проверь и сохрани' : 'Текст распознан — проверь слова и сохрани')
    } catch (err: any) {
      toastErr('Распознать не удалось: ' + (err?.message ?? String(err)))
    } finally {
      setAiRun(null)
    }
  }

  function nudgeLyrics(delta: number) {
    if (!cur) return
    const v = Math.max(-15, Math.min(15, Math.round((lyrShift + delta) * 10) / 10))
    setLyricsShift(cur.id, v)
    setLyrShiftState(v)
  }
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

  // v1.460.0: плеер помнит, на чём остановился. Раньше громкость помнилась, а
  // сам сеанс — нет: закрыл приложение и ищи заново, где слушал.
  //
  // Пишем не на каждую секунду, а раз в несколько: запись в хранилище на каждый
  // тик — это лишняя работа шестьдесят раз в минуту ради того, что понадобится
  // один раз при следующем запуске.
  const сеансRef = useRef(0)
  useEffect(() => {
    const t = cur
    if (!t || !playing) return
    if (Math.abs(curT - сеансRef.current) < 5) return
    сеансRef.current = curT
    const длина = dur || t.dur || 0
    if (worthSaving(curT, длина)) saveSession({ id: t.id, url: t.url, pos: curT, at: Date.now() })
    else clearSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curT, playing, cur?.id])

  /** Куда перемотать, как только источник будет готов (см. восстановление ниже). */
  const seekWanted = useRef<number | null>(null)
  // Восстановление: ставим трек и место, но НЕ включаем. Приложение, которое
  // начинает играть само при запуске, — это то, за что выключают звук навсегда.
  const восстановлено = useRef(false)
  useEffect(() => {
    if (восстановлено.current || tracks.length === 0) return
    восстановлено.current = true
    const s = loadSession()
    const i = findTrack(s, tracks)
    if (i < 0 || !s) return
    goIdx(i)
    setCurT(s.pos)
    seekWanted.current = s.pos
  }, [tracks])
  /**
   * Активность «Слушает…» (v1.425.0 — переписана публикация).
   *
   * Что было не так. Позиция уходила всем строго раз в пятнадцать секунд, а
   * зрители досчитывали её от последней опубликованной точки. Стоило человеку
   * перемотать песню — и до следующей публикации у всех (и у него самого в
   * профиле) висело старое время: перетащил на 0:54, а в активности 0:12.
   *
   * Теперь публикуем в трёх случаях: сменилось то, что играет; прошло пять
   * секунд; настоящая позиция разошлась с досчитанной (см. needRepublish) —
   * именно это и есть перемотка, чья бы она ни была.
   */
  // Адрес трека, который заиграет следующим, — им приоритезируется подгрузка
  // метаданных (см. выше). Через ссылку, потому что считается он ниже по файлу,
  // а нужен раньше: подгрузка живёт в эффекте и читает его уже после отрисовки.
  const qNextUrlRef = useRef<string | undefined>(undefined)
  const pubRef = useRef<{ pos: number; dur?: number; at: number } | null>(null)
  const pubListenRef = useRef(() => {})
  useEffect(() => {
    // v1.428.0: пауза больше не убирает активность.
    //
    // Раньше на паузе активность гасла совсем: у людей рядом трек просто
    // исчезал, будто музыку выключили. Теперь он остаётся, но вместо полосы
    // видно «на паузе» — как в Spotify и Discord: человек слушает эту песню,
    // просто остановил её на минуту.
    if (!cur) { setMyListening(null); pubRef.current = null; return }
    const source = curYt ? 'YouTube' : !curSc && isAudiusUrl(cur.url) ? 'Audius' : 'Ponoi Music'
    const pub = () => {
      const snap = { pos: curTRef.current, dur: dur || undefined, at: Date.now() }
      pubRef.current = snap
      setMyListening({
        title: curMeta?.title || cur.name, author: curMeta?.author || cur.author || '',
        // v1.423.0: обложка. Ссылка и так лежит в общем складе и видна всем — а
        // другим при этом показывалась нота-заглушка.
        source, art: curArt || null, paused: !playing, ...snap,
      })
    }
    pubListenRef.current = pub
    pub()
    // На паузе позицию освежать незачем — она не двигается.
    if (!playing) return
    const t = window.setInterval(pub, 5000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cur?.url, curMeta?.title, curMeta?.author, curArt, dur])
  /**
   * Системная карточка проигрывателя (v1.425.0).
   *
   * Та же информация, что уходит в активность, отдаётся и системе: шторка
   * уведомлений, экран блокировки, кнопки гарнитуры. Раньше о Ponoi Music не
   * знало ничего за пределами открытого окна — свернул приложение, и на телефоне
   * не было даже названия, не то что кнопок.
   *
   * Кнопки подписываются один раз и зовут свежие действия через ссылки: сами
   * обработчики живут дольше любого рендера.
   */
  const mediaRef = useRef({ play: () => {}, pause: () => {}, next: () => {}, prev: () => {}, seek: (_: number) => {}, stop: () => {} })
  mediaRef.current = {
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    next: () => nextRef.current(),
    prev: () => prevRef.current(),
    seek: (sec: number) => seekTo(sec),
    // «Стоп» в системной карточке — это закрыть проигрыватель, а не пауза.
    stop: () => { setPlaying(false); setMediaNow(null) },
  }
  useEffect(() => {
    bindMediaKeys({
      play: () => mediaRef.current.play(),
      pause: () => mediaRef.current.pause(),
      next: () => mediaRef.current.next(),
      prev: () => mediaRef.current.prev(),
      seek: (sec: number) => mediaRef.current.seek(sec),
      stop: () => mediaRef.current.stop(),
    })
  }, [])
  // v1.502.0: те же кнопки, но с НАШЕЙ системной карточки на Android.
  //
  // В браузере карточку рисует сам движок по данным navigator.mediaSession, и
  // нажатия приходят туда же — этим занят bindMediaKeys выше. В приложении
  // страница живёт в WebView, а WebView системной карточки не показывает вовсе:
  // её рисует наша служба, и нажатия идут через мост. Действия одни и те же —
  // расходиться им нельзя, поэтому оба пути ведут в mediaRef.
  useEffect(() => {
    if (!IS_NATIVE) return
    return onMediaKey(k => {
      if (k.action === 'play') mediaRef.current.play()
      else if (k.action === 'pause') mediaRef.current.pause()
      else if (k.action === 'next') mediaRef.current.next()
      else if (k.action === 'prev') mediaRef.current.prev()
      else if (k.action === 'stop') mediaRef.current.stop()
      else if (k.action === 'seek') mediaRef.current.seek(k.sec)
    })
  }, [])
  useEffect(() => {
    if (!cur) { setMediaNow(null); return }
    setMediaNow({
      title: curMeta?.title || cur.name,
      artist: curMeta?.author || cur.author || '',
      album: curSc ? 'SoundCloud' : curYt ? 'YouTube' : 'Ponoi Music',
      art: curArt || null,
      dur: dur || cur.dur,
      pos: curTRef.current,
      playing,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, curMeta?.title, curMeta?.author, curArt, dur, playing])
  // Полосу в системной карточке освежаем отдельно: метаданные при этом не
  // пересобираются, иначе система мигала бы обложкой на каждом тике.
  useEffect(() => {
    if (!cur) return
    updateMediaPosition(curT, dur || cur.dur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curT, dur, cur?.id])
  // Закрыли плеер — карточка уходит вместе с ним.
  useEffect(() => () => setMediaNow(null), [])

  // v1.444.0: пока играет музыка, приложение не выгружается из памяти.
  //
  // Одной системной карточки для этого мало: она поднимает приоритет, но
  // процесс всё равно обычный, и Android при нехватке памяти вправе его
  // прибрать — музыка обрывалась на полуслове. Теперь на время воспроизведения
  // поднимается постоянная служба (MusicService.java). Решение «нужна ли она»
  // принимает keepAliveAction и только она — см. src/lib/keepAlive.ts.
  const kaOn = useRef(false)
  // Позицию системной карточке отдают ОДИН раз на событие, а дальше система
  // двигает полосу сама — по скорости из состояния. Слать её каждую секунду
  // значило бы дёргать мост шестьдесят раз в минуту без всякой пользы.
  //
  // Но перемотку так не поймать: полоса у системы поедет со старого места. Ниже
  // сравнивается ОЖИДАЕМОЕ время с настоящим, и карточка пересобирается только
  // при расхождении — то есть ровно на перемотке, своей или чужой.
  const kaAt = useRef<{ pos: number; at: number } | null>(null)
  const [kaSeek, setKaSeek] = useState(0)
  useEffect(() => {
    if (!IS_NATIVE || !cur) return
    if (mediaSeeked(kaAt.current, curT, playing, Date.now())) setKaSeek(n => n + 1)
    kaAt.current = { pos: curT, at: Date.now() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curT, playing, cur?.id])
  useEffect(() => {
    if (!IS_NATIVE) return
    let alive = true
    const decide = async () => {
      const act = keepAliveAction({
        native: true, playing, hasTrack: !!cur,
        hidden: document.visibilityState === 'hidden',
        allowed: await canKeepAlive(), askedBefore: keepAliveAsked(),
      })
      if (!alive) return
      if (act === 'start' || act === 'show') {
        kaOn.current = true
        // «show» — это пауза: карточка остаётся, но держать процесс незачем.
        await startKeepAlive({
          title: curMeta?.title || cur?.name,
          artist: curMeta?.author || cur?.author || '',
          album: curSc ? 'SoundCloud' : curYt ? 'YouTube' : 'Ponoi Music',
          art: curArt || null,
          playing,
          dur: dur || cur?.dur,
          pos: curTRef.current,
        }, act === 'start')
      } else if (act === 'stop') {
        // Отпускаем только то, что сами держали: висящее уведомление без музыки
        // — это съеденная батарея и недоумение.
        if (kaOn.current) { kaOn.current = false; await stopKeepAlive() }
      } else if (act === 'ask') {
        await askKeepAlive()
        if (alive) decide()   // разрешили — служба поднимется тут же
      }
    }
    void decide()
    // Свернули приложение — это и есть момент, когда служба начинает значить.
    const onVis = () => void decide()
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cur?.id, curMeta?.title, curMeta?.author, curArt, dur, kaSeek])
  // Плеер закрыли — службу отпускаем вместе с ним.
  useEffect(() => () => { if (kaOn.current) { kaOn.current = false; void stopKeepAlive() } }, [])

  // Перемотка — сразу, не дожидаясь таймера. Сюда попадает и своя мышью, и
  // чужая: полоса YouTube, ведущий лобби, кнопки на гарнитуре.
  // v1.433.0: и перемотка НА ПАУЗЕ тоже. Раньше здесь стоял выход при !playing:
  // человек останавливал песню, перетаскивал полосу на другое место, и у себя
  // видел новое время, а у людей рядом под «На паузе» оставалось старое — и так
  // до самого нажатия «играть». Досчитывать от времени публикации на паузе
  // нельзя (время не идёт), поэтому сравниваем прямо позиции.
  useEffect(() => {
    if (!cur) return
    const p = pubRef.current
    const stale = !playing
      ? !p || Math.abs(curT - p.pos) > REPUBLISH_TOLERANCE
      : needRepublish(p, curT, Date.now())
    if (stale) pubListenRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curT, playing])
  useEffect(() => () => { setMyListening(null) }, [])   // размонтирование плеера = слушание кончилось

  /**
   * Склад приезжает страницами, а чужие треки — по одному (v1.420.0).
   *
   * Что было не так, и это две беды сразу.
   *
   * Первая: перед тем как показать хоть что-нибудь, приложение выкачивало склад
   * ЦЕЛИКОМ — тысячами строк, подряд, каждый раз при открытии плеера. Пока это
   * шло, не было ни списка, ни первой песни.
   *
   * Вторая, злее: на ЛЮБОЕ изменение таблицы — то есть на каждый чужой трек —
   * склад выкачивался заново, весь. Когда кто-то заливал плейлист, это
   * означало сотню полных перезагрузок подряд у всех, кто в этот момент
   * слушал: список перестраивался, метаданные запрашивались снова, окно
   * заметно спотыкалось. Ровно это и выглядит как «ломается, когда другие
   * загружают музыку».
   *
   * Теперь: первая страница показывается сразу, остальные догружаются следом, а
   * живое событие ПРИМЕНЯЕТСЯ (добавили — дописали строку, поправили — поправили
   * её же, убрали — убрали), и ни одного лишнего запроса при этом нет: все поля
   * приходят в самом событии.
   */
  useEffect(() => {
    let ok = true

    ;(async () => {
      // v1.435.0: сначала — то, что уже лежит на устройстве. Список появляется
      // мгновенно, до единого запроса; см. music/libCache.ts, там же и почему.
      const snap = await loadLibrary()
      if (!ok) return
      if (snap) setTracks(prev => (prev.length ? mergeTracks(prev, snap.tracks) : snap.tracks))
      // v1.462.0: общее число спрашиваем ВСЕГДА и сразу — это один дешёвый
      // запрос, а без него человек не знает, сколько всего треков и кончится ли
      // загрузка. Показ не ждёт: снимок уже на экране.
      void tracksCount().then(n => { if (ok && typeof n === 'number') setLibTotal(n) })

      // Счёт спрашиваем ТОЛЬКО когда есть что с ним сверять: без снимка ответ
      // всё равно один — качать целиком, а лишний запрос отодвинул бы первую
      // страницу, ради которой всё и делалось.
      const count = snap ? await tracksCount() : null
      if (!ok) return
      if (typeof count === 'number') setLibTotal(count)
      const plan = libraryPlan(snap, count, Date.now())

      if (plan.kind === 'incremental') {
        // Склад не изменился в размере — спрашиваем только появившееся после
        // самого свежего известного. Обычно это ноль строк и один запрос.
        const fresh = await fetchTracksAfter(plan.since)
        if (!ok) return
        if (fresh.length) setTracks(prev => mergeTracks(prev, fresh))
        return
      }

      for (let from = 0; ok; from += TRACKS_PAGE) {
        const { tracks: page, done } = await fetchTracksPage(from)
        if (!ok) return
        if (page.length) setTracks(prev => mergeTracks(prev, page))
        if (done) break
        if (from > 100_000) break
        // Пауза между страницами: склад догружается фоном и не должен мешать
        // ни первой песне, ни прокрутке списка.
        await new Promise(r => setTimeout(r, 120))
      }
    })()

    const ch = supabase.channel('music_tracks_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'music_tracks' }, (p: any) => {
        if (!ok || !p.new?.id) return
        setTracks(prev => mergeTracks(prev, [rowToTrack(p.new)]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'music_tracks' }, (p: any) => {
        if (!ok || !p.new?.id) return
        const t = rowToTrack(p.new)
        setTracks(prev => prev.map(x => (x.id === t.id ? t : x)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'music_tracks' }, (p: any) => {
        const id = p.old?.id
        if (!ok || !id) return
        setTracks(prev => prev.filter(x => x.id !== id))
      })
      .subscribe()

    return () => { ok = false; supabase.removeChannel(ch) }
  }, [])

  /**
   * Снимок склада на устройство (v1.435.0).
   *
   * С задержкой: во время догрузки страниц список меняется десятки раз подряд, и
   * писать снимок на каждую значило бы тратить больше, чем экономим. Пишем, когда
   * склад успокоился.
   */
  useEffect(() => {
    if (tracks.length === 0) return
    const t = window.setTimeout(() => { void saveLibrary(tracksRef.current) }, 3000)
    return () => window.clearTimeout(t)
  }, [tracks])

  /**
   * Дописать только что добавленное, не выкачивая склад заново (v1.420.0).
   *
   * Раньше после каждого добавления — своего файла, плейлиста, ссылки — склад
   * запрашивался целиком. На тысячах треков это заметная пауза ровно в тот
   * момент, когда человек ждёт свою песню, а при импорте плейлиста таких пауз
   * было столько же, сколько треков. Строка уже пришла ответом на добавление:
   * её и берём.
   */
  const appendAdded = (rows: any[]) => {
    const list = rows.filter(Boolean).map(rowToTrack)
    if (list.length) setTracks(prev => mergeTracks(prev, list))
  }

  /**
   * Догнать пропущенное (v1.420.0).
   *
   * Живая подписка не вечная: вкладку свернули, ноутбук уснул, сеть моргнула —
   * канал молчит, и о чужих треках за это время никто не узнает. Возвращаемся к
   * окну — спрашиваем только то, что появилось после самого свежего известного
   * трека. Это один короткий запрос, а не склад заново.
   */
  useEffect(() => {
    const catchUp = async () => {
      if (document.visibilityState !== 'visible') return
      const known = tracksRef.current
      if (!known.length) return
      let newest = ''
      for (const t of known) if (t.at && t.at > newest) newest = t.at
      if (!newest) return
      const fresh = await fetchTracksAfter(newest)
      if (fresh.length) setTracks(prev => mergeTracks(prev, fresh))
    }
    window.addEventListener('focus', catchUp)
    document.addEventListener('visibilitychange', catchUp)
    return () => {
      window.removeEventListener('focus', catchUp)
      document.removeEventListener('visibilitychange', catchUp)
    }
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
    // v1.462.0: раньше сюда попадал ВЕСЬ склад, у которого нет обложки. На
    // тринадцати тысячах это тринадцать тысяч запросов к чужим сервисам —
    // очередь не кончалась никогда, а SoundCloud от такого потока просто
    // перестаёт отвечать: именно поэтому «треки из SoundCloud не работают».
    //
    // Теперь спрашиваем только то, что человеку сейчас нужно: играющее,
    // следующее, найденное поиском и показанное на экране. Остальное подтянется,
    // когда до него долистают, — и не раньше.
    const нужные = new Set<string>()
    if (cur?.url) нужные.add(cur.url)
    if (qNextUrlRef.current) нужные.add(qNextUrlRef.current)
    for (const u of libFoundRef.current) нужные.add(u)
    for (const u of libShownRef.current) нужные.add(u)
    const missing = tracks.filter(t => нужные.has(t.url) && !meta[t.url] && (!t.art || !t.play)
      && (isSoundcloudUrl(t.url) || isYouTubeUrl(t.url) || isAudiusUrl(t.url)))
    if (missing.length === 0) return
    // v1.445.0: сперва забираем всё, что уже лежит в кэше на устройстве, — разом
    // и без единого запроса. Раньше приложение узнавало о лежащем в кэше только
    // через ту же очередь: каждая карточка ждала своей очереди, чтобы получить
    // то, что и так на диске, и обложки на складе проявлялись по одной.
    const seeded = seedFromCache(missing, u => (isSoundcloudUrl(u) ? scCached(u) : srcCached(u)))
    if (Object.keys(seeded).length) setMeta(prev => ({ ...seeded, ...prev }))
    const toFetch = needsFetch(missing, seeded)
    if (toFetch.length === 0) return
    // v1.405.0: чем больше склад, тем дольше начиналась песня — и вот почему.
    //
    // Метаданные (в том числе ссылка, по которой трек реально играет) тянулись
    // строго по одному и строго в порядке склада. Тот трек, который человек
    // включил, оказывался в этой очереди где придётся: при сотне записей он мог
    // ждать сотню чужих запросов. Играть без своей ссылки SoundCloud умеет, но
    // через адрес страницы — то есть медленно и не всегда.
    //
    // Правим две вещи: включённое идёт первым (и следующее за ним — вторым), а
    // остальные тянутся по нескольку сразу, а не гуськом. Больше четырёх зараз
    // не берём: это чужие сервисы, и заваливать их пачкой запросов невежливо, да
    // и отвечать они начнут отказом.
    const first = cur?.url
    // v1.433.0: «следующий» здесь считался третьим по счёту способом — по номеру
    // в складе и волне, мимо ручной очереди и мимо обхода неиграбельных. То есть
    // вперёд подгружался не тот трек, который заиграет: поставленный кнопкой «в
    // очередь» ждал своих метаданных наравне со всем складом и потому начинался
    // медленно, а у SoundCloud — ещё и через адрес страницы. Берём то же, что
    // показано в очереди и что сыграет кнопка (см. qNext).
    const nextUrl = qNextUrlRef.current
    // v1.410.0: за раз берём не больше шестидесяти. На складе в три сотни
    // это триста запросов к чужим сервисам подряд: они начинают
    // отвечать отказом, а окно всё это время занято. Остальные догрузятся
    // следующим заходом — когда список изменится или человек откроет склад.
    // v1.445.0: порядок считает planMeta (music/metaPlan.ts). Раньше он знал ровно
    // про два трека — играющий и следующий, — а найденное поиском грузилось
    // последним, потому что лежит в середине склада: человек искал, получал
    // двадцать карточек без обложек и включал трек, у которого ещё нет своей
    // ссылки. Теперь найденное идёт сразу за играющим, а показанное на экране —
    // за найденным.
    const queue = planMeta(toFetch, {
      current: first, next: nextUrl,
      found: libFoundRef.current, shown: libShownRef.current,
    })
    ;(async () => {
      const CONCURRENCY = 4
      let at = 0
      const worker = async () => {
        while (ok && at < queue.length) {
          const t = queue[at++]
          // v1.464.0: играющий и следующий спрашиваются НАСТОЙЧИВО, даже если
          // сервис отдыхает после отказов. Отдых нужен, чтобы фоновый добор не
          // мешал главному, — а не чтобы мешать главному самому: из-за этого
          // музыка «еле грузилась» целую минуту.
          const главный = t.url === first || t.url === nextUrl
          const m = isSoundcloudUrl(t.url) ? await scMeta(t.url, главный)
            : isYouTubeUrl(t.url) ? await ytMeta(t.url) : await audiusMeta(t.url)
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
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    })()
    return () => { ok = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  // v1.416.0: и на смену играющего трека тоже. Это была настоящая причина
  // задержки: человек выбирал трек из склада, а данные о нём (в том числе
  // ссылка, по которой он реально играет) не запрашивались вовсе — пока не
  // изменится список или не откроют склад. То есть выбранное ждало чего-то
  // постороннего.
  }, [tracks, showLib, libShown, cur?.id, libQ])

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
    scResumeRef.current = 0
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
        //
        // v1.439.0: но САМ он музыку не включает.
        //
        // Что было. Любое «играю» от виджета включало плеер у нас. А виджет
        // умеет стартовать сам: iframe создаётся с разрешением на автозапуск, и
        // SoundCloud этим пользуется — открыл приложение, и музыка заиграла без
        // единого нажатия. Владелец попросил, чтобы при входе было тихо, и это
        // правильно: звук в приложении должен начинаться только по просьбе
        // человека.
        //
        // Отличаем так же, как отличаем свою паузу от чужой (v1.421.0): наше
        // «играю» приходит ПОСЛЕ того, как мы сами включили воспроизведение.
        // Пришло, когда у нас пауза, — это виджет сам, и мы его останавливаем.
        w.bind(SC.Widget.Events.PLAY, () => {
          if (disposed) return
          if (playKind(playingRef.current) === 'ours') return   // подтверждение нашего включения
          try { w.pause() } catch { /* виджет уже уехал */ }
        })
        // v1.421.0: пауза бывает двух совершенно разных видов, и раньше мы
        // считали их одной.
        //
        // Своя пауза (человек нажал кнопку) приходит ПОСЛЕ того, как мы уже
        // выключили воспроизведение сами. А вот виджет, которому не дали трек
        // (закрытая или недоступная для встраивания загрузка — сплошь и рядом у
        // официальных релизов), встаёт САМ, при включённом у нас
        // воспроизведении. Мы послушно выключали плеер, и человек видел ровно
        // то, о чём говорил: «слушаешь — и резко пауза, дальше ничего».
        w.bind(SC.Widget.Events.PAUSE, () => {
          if (disposed) return
          if (!playingRef.current) { setPlaying(false); return }   // это наша пауза
          w.getPosition((ms: number) => {
            if (disposed) return
            const pos = (ms || 0) / 1000
            // Само решение — в чистой функции (broken.ts): живой закрытый трек
            // SoundCloud мне проверить нечем, а ошибка тут либо перескакивает
            // рабочие треки, либо оставляет плеер стоять.
            switch (pauseKind(playingRef.current, pos, scResumeRef.current)) {
              case 'ours': setPlaying(false); return
              case 'notStarted': void sourceStuckRef.current('SoundCloud не начал играть этот трек'); return
              case 'retry': scResumeRef.current++; w.play(); return
              case 'stuck': void sourceStuckRef.current(`SoundCloud остановил трек на ${Math.round(pos)} с`); return
            }
          })
        })
        w.bind(SC.Widget.Events.ERROR, () => {
          if (disposed) return
          void sourceStuckRef.current('SoundCloud не отдал этот трек (закрытый или запрещённый для встраивания)')
        })
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
            // v1.420.0: код отказа разбираем, а не считаем любой отказ поломкой
            // трека. 101 и 150 — «владелец запретил встраивание»: именно так
            // ведут себя официальные клипы, и раньше они попадали в общий
            // счётчик отказов, а свой такой трек на втором заходе удалялся из
            // общей Трекотеки. Рабочая песня пропадала у всех из-за запрета.
            onError: (e: any) => {
              if (disposed) return
              if (isEmbedDeniedCode(e?.data)) { void ytEmbedDeniedRef.current() ; return }
              trackFailedRef.current('YouTube не отдал это видео', curTrackIdRef.current)
            },
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
      // v1.413.0: ведущий присылает id трека, а не его номер.
      //
      // Номер — это место в списке, а список у слушателя может отличаться:
      // кто-то добавил трек, кто-то убрал, у кого-то ещё не доехало обновление.
      // Тогда номер указывал на другую песню, и «слушаем вместе» превращалось
      // в «слушаем разное». Номер принимаем как запасной вариант — ради тех,
      // у кого версия старее.
      if (typeof payload.id === 'string') {
        const i = tracks.findIndex(t => t.id === payload.id)
        if (i >= 0) goIdx(i)
      } else if (typeof payload.idx === 'number') goIdx(payload.idx)
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
      // v1.413.0: гостю, зашедшему посреди песни, ведущий досылает состояние.
      // Раньше оно уходило только при смене трека или паузе: человек входил
      // в лобби и сидел в тишине, пока ведущий чего-нибудь не нажмёт.
      if (together.host) {
        ch.send({ type: 'broadcast', event: 'state', payload: {
          id: tracksRef.current[idxRef.current]?.id, idx: idxRef.current,
          playing: playingRef.current, t: audioRef.current?.currentTime ?? 0,
        } })
      }
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
      togChan.current.send({ type: 'broadcast', event: 'state', payload: {
        // id — главное, номер оставлен для старых версий (v1.413.0).
        id: tracks[idx]?.id, idx, playing, t: audioRef.current?.currentTime ?? 0,
      } })
    }
  }, [idx, playing, together])

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? [])
    if (fs.length === 0 || !meId) return
    setUploading(true)
    try {
      let dupes = 0, коротких = 0
      const свежие: any[] = []
      for (const f of fs) {
        // v1.430.0: длину читаем ДО заливки. Иначе короткий обрезок сначала
        // уедет в хранилище, а потом получит отказ — и останется висеть там
        // навсегда, никому не видимый.
        const длина = await audioDuration(f)
        if (tooShortWhy(длина)) { коротких++; continue }
        const url = await uploadTo('attachments', meId, f)   // shared public URL
        const r = await addTrack({ url, name: f.name.replace(/\.[^.]+$/, ''), ownerId: meId, ownerName: me, kind: 'file' })
        if (r.data) свежие.push(r.data)
        // v1.373.0: у файлов проверки не было вовсе — один и тот же трек заливался
        // сколько угодно раз. Теперь отказ приходит из базы, и мы его показываем,
        // а не глотаем: человек должен понимать, почему добавилось не всё.
        if (isDuplicateTrack(r.error)) dupes++
        else if (r.error) throw new Error(r.error.message)
      }
      if (коротких > 0) {
        toastErr(коротких === 1
          ? `Трек короче ${MIN_TRACK_SEC} с не добавлен: в Трекотеку берём от ${MIN_TRACK_SEC} с`
          : `Не добавлено коротких треков: ${коротких} — в Трекотеку берём от ${MIN_TRACK_SEC} с`)
      }
      if (dupes > 0) {
        toastErr(dupes === fs.length
          ? (dupes === 1 ? 'Такой трек уже есть в трекотеке' : 'Все эти треки уже есть в трекотеке')
          : `Уже были в трекотеке: ${dupes}`)
      }
      appendAdded(свежие)
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
        const свежиеИз: any[] = []
        let added = 0, dupes = 0, короткие = 0
        for (const s of list) {
          const key = normalizeTrackUrl(s.url)
          if (have.has(key)) { dupes++; continue }
          // Короткие обрезки из плейлиста тоже не берём — правило одно на все пути.
          if (tooShortWhy(s.dur)) { короткие++; continue }
          have.add(key)
          setMeta(prev => ({ ...prev, [s.url]: { title: s.title, author: s.author, art: s.art, play: s.play } }))
          const r = await addTrack({ url: s.url, name: s.title, ownerId: meId, ownerName: me, kind: 'url', author: s.author, art: s.art, dur: s.dur, play: s.play })
          if (r.data) свежиеИз.push(r.data)
          added++
        }
        setScUrl('')
        appendAdded(свежиеИз)
        // v1.370.0: если SoundCloud отдал не весь плейлист — говорим, сколько
        // недостаёт. Раньше пропущенные исчезали молча, и человек видел «добавлено
        // 47» вместо 52, не зная, что чего-то не хватает.
        const lost = lastImportSkipped()
        if (короткие > 0) toastErr(`Пропущено коротких треков: ${короткие} — берём от ${MIN_TRACK_SEC} с`)
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
            const почему = tooShortWhy(m?.dur)
            if (почему) { toastErr(почему); setImporting(''); return }
            if (m) setMeta(prev => ({ ...prev, [url]: m }))
            const r = await addTrack({ url, name, ownerId: meId, ownerName: me, kind: 'url', author: m?.author, art: m?.art ?? null, play: m?.play ?? null })
            appendAdded([r.data])
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
        appendAdded([r.data])
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
    // v1.430.0: длина известна не у всех ссылок, и отказывать «на всякий случай»
    // нельзя — иначе в склад не попала бы половина нормальных треков. Проверяем
    // только когда длина правда известна.
    const почемуНет = tooShortWhy(m?.dur)
    if (почемуНет) { toastErr(почемуНет); return }
    if (m) setMeta(prev => ({ ...prev, [url]: m }))
    const добавлен = await addTrack({ url, name, ownerId: meId, ownerName: me, kind: 'url', author: m?.author, art: m?.art ?? null, play: m?.play ?? null })
    setScUrl('')
    appendAdded([добавлен.data])
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
    if (gone >= 0 && gone < idx) goIdx(Math.max(0, idxRef.current - 1))
    else if (gone === idx) goIdx(Math.min(idxRef.current, Math.max(0, rest.length - 1)))
    // Из очереди тоже убираем: ждать удалённого нечего.
    saveManual(manual.filter(x => x !== id))
  }

  /**
   * Трек не заиграл (v1.414.0).
   *
   * Первый отказ прощаем: так выглядит и оборванная сеть, и сервис, прилёгший
   * на минуту. Второй подряд — это уже про сам трек: очередь его обходит, а
   * если он твой, из общего склада он убирается сам. Чужой не трогаем: его и
   * база не даст удалить, и удалять чужое из-за своей сети неправильно.
   */
  /**
   * Сторож «лёг сервис, а не треки» (v1.435.0).
   *
   * Считает отказы по РАЗНЫМ трекам за полминуты. Набралось много — значит дело
   * не в песнях, и метить их нельзя: пометка «не встраивается» переживает
   * перезапуск, и один сбой сервиса испортил бы весь залитый плейлист навсегда.
   * Возвращает true, если решили, что виноват сервис (тогда зовущий обязан
   * остановиться и ничего не помечать).
   */
  const failsRef = useRef<FailMark[]>([])
  const downSaidRef = useRef(0)
  const sourceIsDown = (id: string): boolean => {
    const now = Date.now()
    failsRef.current = pushFail(failsRef.current, id, now)
    if (!sourceDown(failsRef.current, now)) return false
    setPlaying(false)
    // Говорим один раз в минуту: смысл в том, чтобы прекратить поток отказов, а
    // не добавить к нему ещё один.
    if (now - downSaidRef.current > 60_000) {
      downSaidRef.current = now
      toastErr('Сервис сейчас не отдаёт треки — подряд не заиграло несколько. Подожди немного и включи снова')
    }
    failsRef.current = []
    return true
  }

  function trackFailed(reason: string, forId?: string) {
    const t = cur
    if (!t) return
    // v1.428.0: отказ мог приехать от ПРЕДЫДУЩЕГО трека — <audio> сообщает об
    // ошибке с задержкой, а при быстром листании к этому моменту играет уже
    // другой. Раньше такой отказ записывался на новый трек: пролистал десяток
    // песен — и половина из них помечена сломанными, дальше очередь их обходит,
    // а на «дальше» в какой-то момент играть становится нечего. Ровно то, на что
    // жаловались: «листаешь — идёт ломано, а потом кнопка перестаёт работать».
    if (forId && forId !== t.id) return
    if (sourceIsDown(t.id)) return
    const fails = markFailed(t.id)
    if (fails < BROKEN_AFTER) { toastErr(reason + ' — пробую следующий'); next(); return }
    if (t.ownerId && t.ownerId === meId) {
      void removeTrackDb(t.id).then(() => {
        setTracks(ts => ts.filter(x => x.id !== t.id))
        toastErr(`«${meta[t.url]?.title || t.name}» не играет — убрал из Трекотеки`)
      })
    } else {
      toastErr(`«${meta[t.url]?.title || t.name}» не играет — пропускаю. Убрать может тот, кто его выложил`)
    }
    next()
  }

  trackFailedRef.current = trackFailed
  curTrackIdRef.current = cur?.id ?? ''

  /**
   * YouTube запретил встраивать это видео (v1.420.0).
   *
   * Это самая частая причина, по которой «официальные песни не работают»:
   * официальный клип на самом YouTube играет, а в чужом окне — нет, и владелец
   * канала выставил это нарочно. Поломкой трека это не является, поэтому:
   *
   *   • трек не удаляется НИКОГДА, даже свой, и в счётчик отказов не попадает;
   *   • сначала ищем ту же запись там, где её можно играть целиком (Audius,
   *     открытый каталог) — нашли, играем, и ссылка сохраняется в общий склад,
   *     то есть трек починен для всех и навсегда, а не только у меня;
   *   • не нашли — говорим прямо, чем дело, и обходим его в очереди: молчащий
   *     плеер человек считает сломанным приложением.
   */
  async function ytEmbedDenied() {
    const t = cur
    if (!t) return
    markNoEmbed(t.id)
    const title = meta[t.url]?.title || t.name
    const author = meta[t.url]?.author || t.author || ''
    setYtDenied(prev => (prev.includes(t.id) ? prev : [...prev, t.id]))
    // Копия могла быть найдена раньше — тогда искать нечего, плеер сам
    // переключится на неё (см. curYt: запрещённое видео с копией идёт через audio).
    if (meta[t.url]?.play || t.play) { toastOk(`«${title}»: официальный клип нельзя встроить — играю найденную копию`); return }
    toastErr(`«${title}»: YouTube запретил встраивать этот клип — ищу копию`)
    const found = await findPlayable(title, author)
    if (found) {
      setMeta(prev => ({ ...prev, [t.url]: {
        title: prev[t.url]?.title || title,
        author: prev[t.url]?.author || author || found.author,
        art: prev[t.url]?.art || found.art,
        play: found.play,
      } }))
      // В общий склад: у остальных этот трек тоже перестанет молчать.
      updateTrackMeta(t.id, { play: found.play, art: t.art ?? found.art, author: t.author || found.author })
      toastOk(`Нашёл копию «${found.title}» — играю целиком`)
      return
    }
    toastErr(`«${title}» можно слушать только на YouTube — копии в открытых каталогах нет. Пропускаю`)
    next()
  }
  const ytEmbedDeniedRef = useRef(ytEmbedDenied)
  ytEmbedDeniedRef.current = ytEmbedDenied

  /**
   * Трек встал: сервис отказался его отдавать или просто молчит (v1.421.0).
   *
   * Дорога та же, что у запрещённых клипов YouTube, и это главное: раньше у
   * SoundCloud её не было вовсе. Отказ виджета только показывал сообщение — ни
   * обхода в очереди, ни поиска копии, ни счётчика отказов. Плеер оставался
   * стоять на этом треке, и со стороны это выглядело именно так: «слушаешь — и
   * резко пауза, а дальше ничего».
   *
   * Порядок: ищем ту же запись там, где её можно играть целиком; нашли — играем
   * копию (и сохраняем ссылку в общий склад, то есть чиним трек для всех); не
   * нашли — обходим его, как любой неигравший трек.
   */
  async function sourceStuck(reason: string) {
    const t = cur
    if (!t || stuckBusyRef.current) return
    stuckBusyRef.current = true
    try {
      const title = meta[t.url]?.title || t.name
      const author = meta[t.url]?.author || t.author || ''
      const copy = (() => {
        const p = meta[t.url]?.play || t.play
        return p && !isSoundcloudUrl(p) && !isYouTubeUrl(p) ? p : null
      })()
      // Копия уже есть и всё равно встало — значит, дело не в запрете сервиса.
      if (copy) { trackFailed(reason); return }
      // v1.435.0: если подряд не заиграло много РАЗНЫХ треков — это сервис, и
      // помечать их «не встраивается» нельзя: пометка вечная (см. broken.ts).
      if (sourceIsDown(t.id)) return
      markNoEmbed(t.id)
      setYtDenied(prev => (prev.includes(t.id) ? prev : [...prev, t.id]))
      toastErr(`«${title}»: ${reason} — ищу копию`)
      const found = await findPlayable(title, author)
      if (curIdRef.current !== t.id) return   // трек уже сменили — не лезем
      if (found) {
        setMeta(prev => ({ ...prev, [t.url]: {
          title: prev[t.url]?.title || title,
          author: prev[t.url]?.author || author || found.author,
          art: prev[t.url]?.art || found.art,
          play: found.play,
        } }))
        updateTrackMeta(t.id, { play: found.play, art: t.art ?? found.art, author: t.author || found.author })
        toastOk(`Нашёл копию «${found.title}» — играю целиком`)
        setPlaying(true)
        return
      }
      // Копии нет — обходим. Свой трек при этом НЕ удаляем: он цел, его просто
      // не отдают наружу (см. markNoEmbed в broken.ts).
      toastErr(`«${title}» можно слушать только на самом сервисе — пропускаю`)
      next()
    } finally {
      stuckBusyRef.current = false
    }
  }
  const stuckBusyRef = useRef(false)

  /**
   * Играбелен ли трек вообще (v1.421.0).
   *
   * Два разных случая, оба означают «не ставь его в очередь»:
   *   • сломан — два отказа подряд (broken.ts);
   *   • сервис отказался отдавать, и копии не нашлось.
   *
   * Второе раньше не учитывалось нигде: закрытый трек SoundCloud оставался в
   * очереди, и плеер спотыкался о него каждый круг — пятнадцать секунд тишины,
   * сообщение, обход, и снова то же самое на следующем круге.
   */
  const copyOf = (t: Track): string | null => {
    const p = meta[t.url]?.play || t.play
    return p && !isSoundcloudUrl(p) && !isYouTubeUrl(p) ? p : null
  }
  const unplayable = (t: Track | undefined): boolean => {
    if (!t) return false
    if (isBroken(t.id)) return true
    if (isNoEmbed(t.id) && !copyOf(t)) return true
    // v1.428.0: трек со стримингового сервиса, для которого копии не нашлось.
    //
    // Играть его нечем — сервис не отдаёт свои записи наружу, и приложение
    // честно показывает карточку «слушать там». Но в ОЧЕРЕДИ он до сих пор
    // оставался как обычный: волна ставила его следующим, плеер упирался в
    // карточку и замолкал НАСОВСЕМ — ни следующего трека, ни объяснения. Именно
    // это и выглядело как «включая такие песни, у тебя всё ломается».
    if (isStreamingUrl(t.url) && !copyOf(t)) return true
    return false
  }
  const sourceStuckRef = useRef(sourceStuck)
  sourceStuckRef.current = sourceStuck

  /**
   * Играющий трек нечем играть (v1.428.0).
   *
   * Человек мог выбрать его руками из склада, или он лежал в плейлисте, или
   * копия перестала находиться. Раньше плеер в этом месте просто замолкал с
   * карточкой на экране: включённое воспроизведение оставалось включённым, а
   * звука не было — и следующий трек не наступал никогда.
   *
   * Теперь: если играем и играть нечем — идём дальше, сказав словами. Если
   * играть нечего вообще (весь склад такой), останавливаемся честно.
   */
  useEffect(() => {
    if (!playing || !cur || guest) return
    if (!curStreamOnly) return
    const other = tracks.some(t => t.id !== cur.id && !unplayable(t))
    const name = meta[cur.url]?.title || cur.name
    if (!other) {
      setPlaying(false)
      toastErr(`«${name}» можно слушать только в ${curSvc ? SERVICE_NAME[curSvc] : 'сервисе'} — играть больше нечего`)
      return
    }
    const t = window.setTimeout(() => {
      toastErr(`«${name}» слушается только в ${curSvc ? SERVICE_NAME[curSvc] : 'сервисе'} — пропускаю`)
      nextRef.current()
    }, 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cur?.id, curStreamOnly, guest])

  /**
   * Сторож молчания (v1.421.0).
   *
   * Самый вредный случай — не отказ, а тишина: виджет чужого сервиса ничего не
   * сообщает, позиция не двигается, а приложение считает, что играет. Человек
   * ждёт и решает, что плеер сломался. Двигается позиция — всё в порядке; стоит
   * дольше пятнадцати секунд при включённом воспроизведении — трек не играет, и
   * мы разбираемся с ним как с любым неигравшим.
   */
  const moveRef = useRef({ at: Date.now(), t: -1 })
  useEffect(() => {
    if (moveRef.current.t !== curT) moveRef.current = { at: Date.now(), t: curT }
  }, [curT])
  useEffect(() => { moveRef.current = { at: Date.now(), t: -1 } }, [cur?.id])
  useEffect(() => {
    // В лобби «слушаем вместе» гость ничего не переключает сам: очередь ведёт
    // ведущий, и обход трека у гостя развалил бы совместное слушание.
    if (!playing || !cur || curStreamOnly || guest) return
    const id = window.setInterval(() => {
      if (!silenceStuck(moveRef.current.at, Date.now(), playingRef.current)) return
      moveRef.current = { at: Date.now(), t: -1 }
      void sourceStuckRef.current(`трек не играет уже ${Math.round(SILENCE_MS / 1000)} секунд`)
    }, 3000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cur?.id, curStreamOnly, guest])

  // v1.417.0: пока плеер открыт, плагины с разрешением music могут делать то же,
  // что человек кнопками. Мост держим в ссылке на свежие значения: он живёт
  // дольше одного рендера, а обращаются к нему в произвольный момент.
  useEffect(() => {
    setMusicBridge({
      now: () => {
        const t = tracksRef.current[idxRef.current]
        if (!t) return null
        return {
          id: t.id, title: meta[t.url]?.title || t.name, author: meta[t.url]?.author || t.author || '',
          playing: playingRef.current, at: curTRef.current, duration: dur || t.dur || 0,
        }
      },
      library: () => tracksRef.current.map(t => ({
        id: t.id, title: meta[t.url]?.title || t.name,
        author: meta[t.url]?.author || t.author || '', plays: t.plays ?? 0,
      })),
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      next: () => nextRef.current(),
      prev: () => prevRef.current(),
      queue: (trackId: string) => {
        if (!tracksRef.current.some(t => t.id === trackId)) return false
        queueNext(trackId)
        return true
      },
      add: async (url: string) => {
        // Тем же путём, что и поле «вставь ссылку»: проверки, разбор плейлиста
        // и защита от повторов там уже есть, и второй такой путь развёл бы их.
        if (!/^https?:\/\//i.test(url)) return 'Нужна полная ссылка (https://…)'
        setScUrl(url)
        await new Promise(r => setTimeout(r, 0))
        await addSoundcloud()
        return null
      },
    })
    return () => setMusicBridge(null)
  })

  // v1.419.0: событие для плагинов — сменился трек, нажали паузу, продолжили.
  //
  // Раньше плагин мог только спросить music.now() и потому опрашивал плеер по
  // таймеру: это единственный способ, каким плагин узнавал хоть что-то, и он
  // же самый плохой — лишняя работа каждую секунду ради события раз в три
  // минуты. Шлём отсюда, из плеера: он один знает, что действительно поменялось.
  const lastMusicRef = useRef('')
  useEffect(() => {
    const t = tracks[idx]
    const sig = t ? `${t.id}:${playing}` : ''
    if (sig === lastMusicRef.current) return
    lastMusicRef.current = sig
    if (!t) return
    emitPluginEvent('music', {
      id: t.id, title: meta[t.url]?.title || t.name,
      author: meta[t.url]?.author || t.author || '', playing,
    })
  }, [tracks, idx, playing, meta])

  /**
   * Перемотать на секунду t — каким бы источником трек ни играл (v1.420.0).
   *
   * Раньше это умела только полоса перемотки, прямо у себя в разметке, тремя
   * ветками подряд. Строка караоке умела перемотать один обычный audio — то
   * есть щелчок по строке на треке с YouTube или SoundCloud не делал ничего, и
   * понять почему было нельзя. Одно действие — одно место.
   */
  const seekTo = (t: number) => {
    const v = Math.max(0, t)
    if (curSc) { widgetRef.current?.seekTo(v * 1000); setCurT(v); return }
    if (curYt) { try { ytRef.current?.seekTo(v, true) } catch {}; setCurT(v); return }
    const a = audioRef.current
    if (a) { a.currentTime = v; setCurT(v) }
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
  // v1.414.0: сломанные треки очередь обходит. Иначе плеер честно переключался
  // бы на битую ссылку, спотыкался и переключался снова — с виду это зависание.
  // v1.433.0: обход и остановки уехали в resolveNext, потому что их обязан знать
  // и показ тоже. Здесь остаётся только исполнение.
  const nextInput = () => {
    // v1.464.0: было tracks.some внутри find — то есть перебор склада на каждый
    // элемент ручной очереди, и всё это на каждую перерисовку.
    const first = manualLive.find(id => byId.has(id))
    return {
      first,
      arg: {
        // v1.443.0: позиция берётся из ссылки, а не из состояния — иначе два
        // быстрых нажатия считают от одного и того же места (см. goIdx).
        idx: idxRef.current, count: tracks.length, repeat, shuffle,
        manualIdx: first ? (byId.get(first) ?? -1) : -1,
        unplayable: (n: number) => unplayable(tracks[n]),
      },
    }
  }
  const STOP_WHY: Record<StopWhy, string> = {
    end: '',
    none: 'Больше нет треков, которые можно играть',
    'repeat-one': 'Этот трек играть нечем — повторять нечего',
  }
  const next = () => {
    // v1.440.0: если человек возвращался назад, «дальше» ведёт по той же
    // истории вперёд, а не выдумывает новый трек. Новый подбор начинается
    // только когда история кончилась.
    if (repeat !== 'one' && goHist('forward')) return
    const { first, arg } = nextInput()
    const act = resolveNext({ ...arg, personalIdx: personalIdxRef.current })
    if (first && act.kind !== 'restart') saveManual(manual.filter(x => x !== first))
    if (act.kind === 'stop') {
      setPlaying(false)
      if (STOP_WHY[act.why]) toastErr(STOP_WHY[act.why])
      return
    }
    if (act.kind === 'restart') { restartCurrent(); return }
    goIdx(act.index)
  }
  // v1.407.0: «назад» возвращает к тому, что играло, а не к предыдущему номеру
  // склада. При перемешивании это была прямая поломка: человек слушал случайный
  // порядок, жал «назад» — и попадал не туда, откуда пришёл, а к соседу по
  // списку, которого не слышал вовсе. То же самое было и после «поставить
  // следующим», и после выбора трека из Трекотеки.
  //
  // Помним последние тридцать: этого хватает, чтобы отмотать сколько угодно
  // назад в пределах одного прослушивания, и не даёт списку расти вечно.
  // v1.411.0: история — в состоянии, а не в ссылке. По ней рисуется строка
  // «Прошлый», и пока она лежала в ссылке, панель не перерисовывалась: кнопка
  // «назад» уводила к одному треку, а в очереди значился другой. Ровно та же
  // болезнь, что уже была с «дальше» (v1.398.0) — показ и действие разошлись.
  // v1.440.0: история со ходом ВПЕРЁД (см. music/history.ts).
  //
  // Раньше «назад» разбирало стопку: трек снимался насовсем, и вернуться вперёд
  // к тому, что только что слушал, было нечем — очередь придумывала следующий
  // заново. Теперь это список с указателем, как история страниц: назад и вперёд
  // ходят по одному и тому же пути.
  const [hist, setHist] = useState<Hist>(emptyHist)
  const histRef = useRef(hist); histRef.current = hist
  const fromHistRef = useRef(false)
  // v1.464.0: карта «id трека → его номер». Раньше её здесь не было, и всё, что
  // ниже, искало трек ПЕРЕБОРОМ всего склада.
  //
  // На тринадцати тысячах это и есть та беда, которую владелец принёс как
  // «кнопки через раз нажимаются»: строки «Прошлый» и «Дальше» считаются на
  // КАЖДУЮ перерисовку, а перерисовка идёт на каждый тик полосы времени —
  // несколько раз в секунду. Каждый такой пересчёт делал несколько проходов по
  // всем тринадцати тысячам, и главный поток просто не успевал заметить нажатие.
  const byId = useMemo(() => {
    const m = new Map<string, number>()
    tracks.forEach((t, i) => m.set(t.id, i))
    return m
  }, [tracks])
  const trackById = (id: string) => { const i = byId.get(id); return i == null ? null : tracks[i] ?? null }
  const alive = (id: string) => byId.has(id)
  useEffect(() => {
    const id = cur?.id
    if (!id) return
    if (fromHistRef.current) { fromHistRef.current = false; return }   // шли по истории — указатель уже сдвинут
    setHist(h => pushPlayed(h, id))
  }, [cur?.id])

  const goHist = (step: 'back' | 'forward'): boolean => {
    const r = step === 'back' ? histBack(histRef.current, alive) : histForward(histRef.current, alive)
    if (!r) return false
    // Указатель истории тоже двигаем сразу: без этого второе быстрое нажатие
    // «назад» шагнуло бы из той же точки и вернуло тот же трек.
    histRef.current = r.hist
    setHist(r.hist)
    fromHistRef.current = true
    goIdx(tracks.findIndex(t => t.id === r.target))
    return true
  }

  const prev = () => {
    if (goHist('back')) return
    // Истории ещё нет (первый трек за сеанс) — прежнее поведение: шаг по складу.
    goIdx((idxRef.current - 1 + tracks.length) % Math.max(tracks.length, 1))
  }
  // v1.371.0: системные кнопки («предыдущий» на гарнитуре) вешаются один раз, и
  // без ссылки обработчик держал бы список таким, каким он был на первом рендере
  // — то есть пустым, и кнопка всегда возвращала бы к первому треку.
  prevRef.current = prev
  nextRef.current = next

  /**
   * Добавить трек в плейлист (v1.428.0).
   *
   * Раньше это было одно окошко «введите название плейлиста»: чтобы положить
   * трек в уже существующий, надо было вспомнить и набрать его название
   * посимвольно — ошибся буквой, и завёлся второй плейлист с почти тем же
   * именем. Теперь список открывается сам (см. plPick ниже), а «Новый плейлист»
   * — один из пунктов.
   */
  const [plPick, setPlPick] = useState<string | null>(null)   // id трека, который кладём
  useBackClose(!!plPick, () => setPlPick(null))
  function putInPlaylist(plId: string, trackId: string) {
    const p = playlists.find(x => x.id === plId)
    const r = addTrackTo(playlists, plId, trackId)
    // v1.441.0: раньше при повторе и при переполнении не происходило ничего и не
    // говорилось ничего — человек нажимал снова и снова. Теперь причина видна.
    if (!r.ok) { toastErr(addFailText(r.why!, p?.name ?? 'плейлист')); return }
    setPlaylists(r.list); savePlaylists(r.list)
    toastOk(`Добавлено в «${p?.name ?? 'плейлист'}»`)
  }
  /**
   * Создание плейлиста (v1.441.0 — своим окном).
   *
   * Было: системный запрос имени одной строкой. Ни обложки, ни понимания,
   * сколько треков туда поедет, ни возможности передумать — и это единственный
   * шаг, на котором плейлист вообще создаётся.
   */
  const [plNew, setPlNew] = useState<{ trackId?: string } | null>(null)
  const [plName, setPlName] = useState('')
  const [plCover, setPlCover] = useState<string | null>(null)
  const [plBusy, setPlBusy] = useState(false)
  const plCoverRef = useRef<HTMLInputElement>(null)
  function newPlaylistWith(trackId?: string) { setPlName(''); setPlCover(null); setPlNew({ trackId }) }
  async function createPlNow() {
    const name = plName.trim()
    if (!name) { toastErr('Без названия плейлист не создать'); return }
    const n = createPlaylist(playlists, name, plNew?.trackId, plCover)
    setPlaylists(n); savePlaylists(n)
    setPlNew(null)
    toastOk(`Плейлист «${name}» создан`)
  }
  // Для какого уже существующего плейлиста выбираем обложку. null — значит идёт
  // создание нового, и картинка ложится в окно создания.
  const [plCoverFor, setPlCoverFor] = useState<string | null>(null)
  async function pickPlCover(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !meId) return
    setPlBusy(true)
    try {
      const url = await uploadTo('avatars', meId, f)
      if (plCoverFor) {
        const n = setPlaylistCover(playlists, plCoverFor, url)
        setPlaylists(n); savePlaylists(n); setPlCoverFor(null)
        toastOk('Обложка сохранена')
      } else setPlCover(url)
    }
    catch (err: any) { toastErr(err?.message ?? String(err)) }
    finally { setPlBusy(false) }
  }

  /**
   * Включить плейлист целиком (v1.428.0).
   *
   * Через ту же ручную очередь, что и «поставить следующим»: она уже проверена и
   * уже имеет приоритет над волной (см. nextTrack). Свой второй механизм
   * очереди развёл бы показ с исполнением — на этом в плеере обжигались дважды.
   */
  function playPlaylist(p: Playlist) {
    const list = playlistTracks(p, tracks)
    if (list.length === 0) { toastErr('В плейлисте нет треков, которые есть в Трекотеке'); return }
    const [first, ...rest] = list
    saveManual(rest.map(t => t.id))
    const i = tracks.findIndex(t => t.id === first.id)
    if (i >= 0) { playAt(i); setPlaying(true) }
    setShowLib(false)
    toastOk(`Играет плейлист «${p.name}» — ${list.length} трек.`)
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
  // v1.432.0: и в ручной очереди тоже. Плейлист мог содержать трек, который
  // сервис не отдаёт наружу: очередь показывала «дальше — вот он», плеер до него
  // доходил и упирался.
  // v1.464.0: и здесь был перебор всего склада на каждый элемент очереди, на
  // каждой перерисовке. Ищем по карте.
  const manualLive = manual.filter(id => {
    const t = trackById(id)
    return !!t && !unplayable(t)
  })

  // v1.377.0: сколько раз я слушал каждый трек — по этому и строится очередь.
  const [myPlays, setMyPlays] = useState<Record<string, number>>({})
  useEffect(() => { myPlayCounts().then(setMyPlays) }, [])

  /**
   * Прослушивание засчитывается только после порога в CREDIT_SEC (v1.426.0,
   * с v1.435.0 порог — пятьдесят секунд).
   *
   * Что было. Плюс один в тот же миг, когда трек начинал играть. То есть число
   * говорило «сколько раз на это нажали», а не «сколько это слушали»: пролистал
   * двадцать треков по секунде — двадцать прослушиваний, и склад «сначала то,
   * что слушают чаще всего» выкладывался по случайным нажатиям.
   *
   * Теперь как у стриминговых сервисов: полсотни секунд, а короткая запись —
   * целиком. Время НАКАПЛИВАЕТСЯ маленькими шагами (см. playCredit.ts), поэтому
   * перемотка до тридцатой секунды ничего не даёт: прыжок шагом не считается.
   */
  const countedRef = useRef<string>('')
  const listenRef = useRef<Listened>(freshListened())
  // Когда каждый трек слушался в последний раз — на этом устройстве.
  const LASTAT_KEY = 'ponoi_mus_lastat_v1'
  const [lastAt, setLastAt] = useState<Record<string, number>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LASTAT_KEY) || '{}')
      return v && typeof v === 'object' ? v : {}
    } catch { return {} }
  })
  useEffect(() => {
    listenRef.current = freshListened(curT)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id])
  useEffect(() => {
    if (!cur || !playing) return
    if (countedRef.current === cur.id) return
    listenRef.current = advance(listenRef.current, curT)
    if (!credited(listenRef.current, dur || cur.dur)) return
    countedRef.current = cur.id
    void recordPlay(cur.id)
    setMyPlays(p => ({ ...p, [cur.id]: (p[cur.id] ?? 0) + 1 }))
    // v1.435.0: запоминаем и КОГДА это было. По давности волна теперь и
    // выбирает — вместо прежнего «сколько раз слушал» (см. personalQueue).
    // Хранится на устройстве: отдельной колонки в базе под это нет, а заводить
    // её значит рассказывать серверу, что и когда человек слушал.
    setLastAt(m => {
      const next = { ...m, [cur.id]: Date.now() }
      try { localStorage.setItem(LASTAT_KEY, JSON.stringify(next)) } catch { /* переполнено */ }
      return next
    })
    setTracks(ts => ts.map(t => (t.id === cur.id ? { ...t, plays: (t.plays ?? 0) + 1 } : t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curT, playing, cur?.id, dur])

  // v1.399.0: что играло только что — чтобы очередь не гоняла одно и то же по
  // кругу. Держим короткий хвост: рекомендация смотрит на свежесть, а не на всю
  // историю прослушиваний.
  // v1.424.0: хвост стал длиннее и переживает закрытие плеера.
  //
  // Восемь треков не хватало запрету повтора: окно у волны — до двадцати, а
  // истории было восемь, и дальше повтор снова считался «свежим». А ещё она
  // жила только в памяти: закрыл плеер, открыл снова — и волна начинала с тех
  // же песен, которые только что играли.
  const RECENT_KEY = 'ponoi_mus_recent_v1'
  const recentRef = useRef<string[]>((() => {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
      return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 80) : []
    } catch { return [] }
  })())
  const [recentAt, setRecentAt] = useState(0)
  // v1.440.0: кому отправляем трек. null — окно закрыто.
  const [shareFor, setShareFor] = useState<Track | null>(null)
  const [shareList, setShareList] = useState<{ id: string; username: string; avatar_url: string | null }[]>([])
  const [shareBusy, setShareBusy] = useState('')
  useEffect(() => {
    if (!shareFor) return
    let ok = true
    ;(async () => {
      // Берём тех, с кем уже есть переписка: отправить песню человеку, которому
      // ты никогда не писал, — не то, ради чего эта кнопка нужна.
      const { data: fr } = await supabase.from('friend_requests').select('from_user, to_user')
        .eq('status', 'accepted').or('from_user.eq.' + meId + ',to_user.eq.' + meId)
      const ids = [...new Set(((fr ?? []) as any[]).map(r => (r.from_user === meId ? r.to_user : r.from_user)))]
      if (!ids.length) { if (ok) setShareList([]); return }
      const { data } = await supabase.from('profiles').select('id, username, avatar_url').in('id', ids).limit(100)
      if (ok) setShareList(((data ?? []) as any[]).sort((a, b) => String(a.username).localeCompare(String(b.username), 'ru')))
    })()
    return () => { ok = false }
  }, [shareFor, meId])
  useEffect(() => {
    if (!cur) return
    // v1.440.0: помним восемьдесят вместо сорока. На сороковом треке хвост
    // кончался, запрет повтора переставал работать по всей сессии, и волна
    // сваливалась к глобально популярному — ровно то, на что жаловались.
    recentRef.current = [cur.id, ...recentRef.current.filter(x => x !== cur.id)].slice(0, 80)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentRef.current)) } catch { /* переполнено */ }
    // v1.434.0: список «только что игравшего» живёт в ссылке, а волна с этой
    // версии считается не на каждой отрисовке, а по списку зависимостей — из
    // ссылки она изменения не увидит. Поэтому о нём сообщается отдельно: без
    // этого волна осталась бы с тем списком, каким он был до смены трека.
    setRecentAt(Date.now())
  }, [cur?.id])

  // v1.398.0: что предлагает личная очередь.
  // v1.399.0: это уже не «что чаще слушал», а подбор по нескольким признакам —
  // тот же исполнитель, похожее название, свои и общие прослушивания, минус то,
  // что играло только что. Название и автор берутся из метаданных: у трека по
  // ссылке в самом поле name лежит адрес, а не заголовок, и сходство по нему не
  // нашлось бы никогда.
  // v1.434.0: считается ТОЛЬКО когда меняется то, из чего считается.
  //
  // Раньше подбор шёл на каждой отрисовке плеера, а плеер перерисовывается по
  // два-четыре раза в секунду — от одного лишь бега полосы времени. Замер на
  // складе в 2000 треков: 6 мс, на 5000 — 15 мс, и это только волна. То есть
  // при играющей музыке приложение отдавало заметную часть каждой секунды
  // пересчёту одного и того же ответа. Именно так и выглядят «лаги»: ничего не
  // виснет, но всё чуть-чуть не поспевает.
  //
  // Поиск по id внутри skip был вторым таким местом: перебор всего склада на
  // каждый рассматриваемый трек. Теперь номера берутся из карты.

  // Порядок и поиск по складу — тоже не на каждый тик полосы времени, а только
  // когда меняется склад, метаданные или строка поиска.
  // v1.462.0: САМАЯ ДОРОГАЯ вещь во всём плеере — этот порядок. На складе в
  // тринадцать тысяч он строит карту из тринадцати тысяч и сортирует их же.
  //
  // А зависел он от meta — то есть пересчитывался НА КАЖДУЮ подгруженную
  // обложку, десятки раз в минуту, пока идёт добор данных. Отсюда и «лагает
  // всё»: приложение полминуты подряд занято сортировкой одного и того же.
  //
  // Порядку метаданные не нужны вовсе: он считается по числу прослушиваний.
  // Метаданные нужны только ПОИСКУ — и только когда в поиске что-то набрано.
  const libOrdered = useMemo(() => libraryOrder(tracks), [tracks])
  const libAll = useMemo(() => {
    const q = libQ.trim()
    const ordered = libOrdered
    if (!q) return ordered
    // v1.442.0: поиск прощает опечатки, другую раскладку и «ё» (см. fuzzy.ts).
    // Раньше сравнение шло через includes: одна лишняя буква — и трек «не
    // найден», хотя лежит прямо тут. На восьми тысячах песен это читалось как
    // «поиск не работает»: человек не знает, что ошибся, он видит пустоту.
    // Порядок — по близости к запросу, иначе точное совпадение тонуло бы среди
    // найденного через две опечатки.
    const scored: { t: typeof ordered[number]; s: number }[] = []
    for (const t of ordered) {
      const sc = trackScore(q, t, meta[t.url]?.title || t.name, meta[t.url]?.author || t.author)
      if (sc > 0) scored.push({ t, s: sc })
    }
    scored.sort((a, b) => b.s - a.s)
    return scored.map(x => x.t)
    // meta здесь остаётся: без него поиск не видит настоящих названий. Но
    // пересчёт теперь бьёт только по НАЙДЕННОМУ, а не по всему складу, и только
    // пока в поиске что-то набрано.
  }, [libOrdered, meta, libQ])

  // v1.445.0: что сейчас найдено и что показано на экране склада — для очереди
  // подгрузки (music/metaPlan.ts). Через ссылки, а не через зависимости эффекта:
  // эффект не должен перезапускаться на каждую букву в поиске, ему достаточно
  // видеть свежее значение в момент, когда он и так сработал.
  //
  // Через useMemo, а не прямо в теле: плеер перерисовывается на каждый тик
  // полосы времени, то есть раз в секунду, а найденное по широкому запросу — это
  // тысячи строк. Первая версия этой правки собирала оба списка заново при
  // каждой перерисовке — ровно та потеря скорости, которую в этом файле уже
  // чинили (см. v1.436.0 про recommend).
  const libFound = useMemo(
    () => (libQ.trim() ? libAll.map(t => t.url) : []),
    [libAll, libQ],
  )
  const libShownUrls = useMemo(() => libAll.slice(0, libShown).map(t => t.url), [libAll, libShown])
  const libFoundRef = useRef<string[]>([])
  libFoundRef.current = libFound
  const libShownRef = useRef<string[]>([])
  libShownRef.current = libShownUrls

  // Подсказка «возможно, вы имели в виду» — только когда не нашлось ничего.
  const libHint = useMemo(() => {
    if (!libQ.trim() || libAll.length > 0) return ''
    const names = tracks.slice(0, 2000).map(t => meta[t.url]?.title || t.name || '')
    return suggestQuery(libQ, names)[0] ?? ''
  }, [libQ, libAll.length, tracks, meta])
  // v1.464.0: названия для подборки берутся через ссылку, а пересчёт идёт по
  // редкому тику.
  //
  // Названия догружаются по одному, и каждое такое обновление раньше заставляло
  // пересчитывать подборку заново — по всему складу. На тринадцати тысячах это
  // сотни полных проходов подряд, между которыми окно не успевало ни
  // перерисоваться, ни принять нажатие.
  const metaRef = useRef(meta)
  metaRef.current = meta
  //
  // Тик именно ставится один раз и обязательно срабатывает. Если бы он
  // сбрасывался на каждом обновлении, то при непрерывной подгрузке названий он
  // не наступил бы НИКОГДА — и подборка застыла бы на самом первом состоянии.
  const [recoTick, setRecoTick] = useState(0)
  const recoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (recoTimer.current) return
    recoTimer.current = setTimeout(() => {
      recoTimer.current = null
      setRecoTick(n => n + 1)
    }, 1500)
  }, [meta])
  useEffect(() => () => { if (recoTimer.current) clearTimeout(recoTimer.current) }, [])
  const reco = useMemo(() => {
    if (!cur || tracks.length < 2) return null
    const m = metaRef.current
    const enriched = tracks.map(t => ({
      ...t,
      name: m[t.url]?.title || t.name,
      author: m[t.url]?.author || t.author,
    }))
    // v1.432.0: волна не предлагает то, что играть нечем — иначе очередь
    // показывала одно, а плеер играл другое (он такие треки обходит сам).
    return recommend({
      tracks: enriched, idx, plays: myPlays, recent: recentRef.current,
      lastAt, now: Date.now(),
      skip: t => unplayable(tracks[byId.get(t.id) ?? -1]),
    })[0] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, byId, idx, myPlays, lastAt, recoTick, cur?.id, ytDenied, recentAt])
  const personalIdx = reco ? byId.get(reco.track.id) ?? -1 : -1
  // next() живёт в замыкании обработчиков (гарнитура, конец трека), поэтому
  // берёт значение через ссылку — иначе там останется номер с первого рендера.
  const personalIdxRef = useRef(-1)
  personalIdxRef.current = personalIdx

  // v1.398.0: соседи текущего трека для очереди.
  //
  // «Прошлый» — ровно то, что сделает кнопка «предыдущий» (шаг назад по списку).
  // «Дальше» — ответ той же nextTrack, что исполняет кнопка «следующий»: иначе
  // очередь показывала бы одно, а играло бы другое. При перемешивании честно
  // говорим, что трек будет случайным, а не выдумываем конкретный.
  // v1.411.0: то, куда вернёт «назад», — считается той же функцией, что и сам
  // возврат. Раньше здесь стоял «предыдущий номер по списку», и при
  // перемешивании очередь показывала одно, а кнопка играла другое.
  const qPrev = (() => {
    const r = histBack(hist, alive)
    if (r) return trackById(r.target)
    return tracks.length > 1 ? tracks[(idx - 1 + tracks.length) % tracks.length] : null
  })()
  // v1.433.0: строка «Дальше» считается ТОЙ ЖЕ resolveNext, что и кнопка. До
  // этого она звала голую nextTrack, не знавшую про обход неиграбельных: очередь
  // называла сломанный трек, а плеер перешагивал через него на следующий — и
  // «Дальше — этот же» стояло даже там, где плеер на самом деле остановится.
  const qNext = (() => {
    if (!cur) return { label: 'Дальше', t: null as typeof cur | null }
    // v1.440.0: если человек возвращался назад, «дальше» ведёт по истории — и
    // строка обязана говорить ровно это, иначе показ снова разойдётся с
    // действием (см. resolveNext и всю историю этой болезни).
    if (repeat !== 'one') {
      const f = histForward(hist, alive)
      if (f) return { label: 'Дальше — по истории', t: trackById(f.target) }
    }
    const { arg } = nextInput()
    const act = resolveNext({ ...arg, personalIdx })
    if (act.kind === 'stop') {
      return { label: act.why === 'end' ? 'Дальше ничего' : STOP_WHY[act.why], t: null as typeof cur | null }
    }
    // Перемешивание выбирает случайный номер — называть конкретный трек нельзя,
    // но сказать, что дальше что-то будет, уже можно честно.
    if (shuffle) return { label: 'Дальше — случайный', t: null as typeof cur | null }
    if (act.kind === 'restart') return { label: 'Дальше — этот же', t: cur }
    const label = arg.manualIdx >= 0 && act.index === arg.manualIdx ? 'Дальше — поставлен вручную'
      : act.index === personalIdx && reco ? 'Дальше — ' + WHY_LABEL[reco.why]
      : 'Дальше'
    return { label, t: tracks[act.index] ?? null }
  })()
  // Подгрузка метаданных тянет вперёд именно то, что заиграет (см. выше).
  qNextUrlRef.current = qNext.t?.url

  /** Поставить трек следующим. Уже стоящий — переставляем, а не задваиваем. */
  function queueNext(id: string) {
    saveManual([id, ...manual.filter(x => x !== id)])
    toastOk('Заиграет следующим')
  }
  /** Перейти к треку и снять его с ручной очереди: он уже играет, ждать нечего. */
  function playAt(i: number) {
    const t = tracks[i]
    if (t && manual.includes(t.id)) saveManual(manual.filter(x => x !== t.id))
    goIdx(i)
  }

  return (<>
    <main className={'mus2' + (bg.type !== 'none' && bgUrl ? ' hasbg' : '') + (acc ? ' tinted' : '') + (full ? ' full' : '') + (visible ? '' : ' mus2-hidden')} style={musStyle}>
      {/* v1.460.0: живой фон — узор из цвета обложки, который медленно движется.
          Показывается, когда своей картинки-фона нет: поверх неё это была бы
          каша. Один и тот же трек даёт один и тот же рисунок (см. liveBg.ts). */}
      {cur && !(bg.type !== 'none' && bgUrl) && <LiveBg trackKey={cur.url}
        accent={acc ? '#' + [acc.r, acc.g, acc.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : null} />}
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
              {/* v1.398.0: без числа треков. Это кнопка «открыть склад», а
                  число рядом с ней ничего не решало и только шумело. */}
              <Icon name="music" size={15} /> Трекотека
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
              ОЧЕРЕДЬ
              <button className="mus2-filebtn" title={guest ? noGuest : 'Добавить файлы'} disabled={guest} onClick={() => fileRef.current?.click()}>{uploading ? '…' : <Icon name="plus" size={16} />}</button>
            </div>
            <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={addFiles} />

            {/* v1.398.0: очередь — это три строки: что было, что играет, что дальше.
                Раньше здесь лежала лента из восьми ближайших с числами и плашкой
                «+N»: смотреть в неё было незачем, а «дальше» она показывала не то,
                что заиграет на самом деле — своё «дальше» считала она, а кнопка
                «следующий» своё. Теперь строка «дальше» считается той же функцией,
                что и переключение (nextTrack), поэтому показанное и есть будущее. */}
            {!cur
              ? <div className="mus2-empty">{tracks.length === 0
                  ? 'Пусто. Вставь ссылку — Spotify, YouTube, SoundCloud или прямой .mp3.'
                  : 'Ничего не играет. Открой трекотеку и выбери трек.'}</div>
              : <div className="mus2-q3">
                  {[
                    // v1.411.0: «дальше» нажимается и при перемешивании, когда
                    // трек заранее не известен — его выбирает случай в момент
                    // переключения. Раньше строка в этом случае была мёртвой:
                    // назван «случайный», а нажать нельзя.
                    { role: 'prev' as const, label: 'Прошлый', t: qPrev, onClick: prev, live: !!qPrev },
                    { role: 'now' as const, label: 'Сейчас играет', t: cur, onClick: () => setPlaying(p => !p), live: true },
                    { role: 'next' as const, label: qNext.label, t: qNext.t, onClick: next, live: tracks.length > 1 || repeat !== 'off' },
                  ].map(row => (
                    <div key={row.role} className={'mus2-q3-row ' + row.role + (row.live ? '' : ' none')}
                      onClick={() => { if (!row.live) return; if (guest && row.role !== 'now') { toastErr(noGuest); return } row.onClick() }}
                      title={row.t ? (meta[row.t.url]?.title || row.t.name) : undefined}>
                      <div className="mus2-q3-art">
                        {row.t && (meta[row.t.url]?.art || row.t.art)
                          ? <img src={(meta[row.t.url]?.art || row.t.art) as string} alt="" loading="lazy" />
                          : <Icon name="music" size={row.role === 'now' ? 20 : 16} />}
                      </div>
                      <div className="mus2-q3-tx">
                        <div className="mus2-q3-lbl">{row.label}</div>
                        <div className="mus2-q3-t notr" translate="no">
                          {row.t ? (meta[row.t.url]?.title || row.t.name)
                            : row.role === 'next' && shuffle ? 'Выберется случайно'
                            : row.role === 'prev' ? 'Отсюда начали'
                            : '—'}
                        </div>
                      </div>
                    </div>
                  ))}
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
                    return <div key={tid} className="mus2-pl-t" onClick={() => { goIdx(byId.get(t.id) ?? 0); setPlaying(true) }}>{t.name}</div> })}
                </div>
              ))}
            </div>
          </>}
        </aside>

        <section className={'mus2-now' + (lyrMode === 'karaoke' ? ' karaoke' : '')}>
          {showLeft && <img className="mus-gif l" src={gif.url} alt="" />}
          <div className="mus2-artwrap">
            {/* v1.394.0: текст фоном — за обложкой, приглушённо. Строки не
                перехватывают мышь: под ними живая обложка и кнопки.
                v1.398.0: блок лежит внутри обложки, а не в секции. Снаружи его
                серединой была середина всей секции, а у обложки — своя: ниже
                неё ещё название, подпись и строка о поиске текста. Из-за этого
                поющаяся строка стояла ниже центра обложки, и это было видно. */}
            {lyrMode === 'back' && lyr && <div className="mus2-lyrback" aria-hidden="true">
              <div className="mus2-lyrback-in"
                style={{ transform: `translateY(calc(-1.05em - ${Math.max(lyrActive, 0) * 2.1}em))` }}>
                {lyr.lines.map((l, i) => (
                  <div key={i} className={'mus2-lyrback-l' + (i === lyrActive ? ' on' : '')}>{l.text || '\u00a0'}</div>
                ))}
              </div>
            </div>}
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
          {lyrMode === 'karaoke' && lyr && <div className="mus2-karaokewrap">
            <div className="mus2-karaoke" ref={kBoxRef}
              onWheel={lyrTouched} onTouchMove={lyrTouched} onPointerDown={lyrTouched}>
              <div className="mus2-karaoke-in">
                {lyr.lines.map((l, i) => (
                  <div key={i} ref={el => { if (el) kLineRefs.current.set(i, el); else kLineRefs.current.delete(i) }}
                    className={'mus2-kline' + (i === lyrActive ? ' on' : lyrActive >= 0 && i < lyrActive ? ' past' : '')
                      + (l.t === null ? ' plain' : '')}
                    onClick={() => {
                      if (l.t === null) return
                      // Обратный пересчёт: в строке время оригинала, а перемотка идёт
                      // по времени играющей записи и через тот источник, который
                      // сейчас звучит: раньше здесь стоял только audio, и в караоке
                      // на YouTube или SoundCloud щелчок по строке не делал ничего.
                      seekTo(Math.max(0, (l.t - lyrShift) / (lyrK || 1)))
                    }}
                    title={l.t !== null ? 'Перейти к строке' : undefined}>{l.text || ' '}</div>
                ))}
              </div>
            </div>
            {/* Пролистал руками — кнопка возвращает к поющейся строке. Без неё
                человек оставался в пролистанном тексте и решал, что подсветка отстала. */}
            {lyrHeld && lyrActive >= 0 && (
              <button className="mus2-kback" onClick={() => { lyrTouchRef.current = 0; setLyrHeld(false); centerLyrLine(lyrActive) }}>
                <Icon name="chevron-down" size={14} /> К этой строке
              </button>
            )}
          </div>}
          <div className="mus2-nowt">{cur ? (curMeta?.title || cur.name) : 'Ничего не играет'}</div>
          {/* v1.417.0: уголок плагинов под обложкой. */}
          <PluginPanels slot="player" />
          <div className="mus2-nowsub">{cur ? (curSc ? (curMeta?.author || cur.author || 'Трекотека') : curYt ? (curMeta?.author ? curMeta.author + ' · YouTube' : 'YouTube') : cur.kind === 'url' ? (curMeta?.author || cur.author || 'по ссылке') : 'файл · ' + cur.owner) : 'Добавь трек, чтобы начать'}
            {/* v1.424.0: сколько раз этот трек слушали все — как на странице
                трека в SoundCloud. В складе число было, а у играющего трека нет,
                хотя именно на него человек и смотрит. */}
            {cur && <span className="mus2-nowplays" title={'Прослушиваний: ' + (cur.plays ?? 0)}>
              <Icon name="play" size={11} /> {fmtPlays(cur.plays ?? 0)}
            </span>}
          </div>
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
            onChange={e => seekTo(+e.target.value)} disabled={!cur || guest} title={guest ? noGuest : undefined} />
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
            <button className="mus2-inpl" onClick={() => cur && setPlPick(cur.id)} disabled={!cur}><Icon name="plus" size={15} /> В плейлист</button>
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
      {cardMenu && (() => {
        const t = tracks.find(x => x.id === cardMenu.id)
        if (!t) return null
        const mine = !!meId && t.ownerId === meId
        const close = () => setCardMenu(null)
        return <Portal>
          <div className="ctxmenu-overlay" onClick={close} onContextMenu={e => { e.preventDefault(); close() }} />
          <div className="ctxmenu mus2-cardmenu" style={{ left: Math.min(cardMenu.x, window.innerWidth - 230), top: Math.min(cardMenu.y, window.innerHeight - 220) }}>
            <div className="ctxmenu-title notr" translate="no">{cardMenu.title}</div>
            <div className="ctxmenu-item" onClick={() => { const i = tracks.findIndex(x => x.id === t.id); playAt(i); setPlaying(true); setShowLib(false); close() }}>
              <Icon name="play" size={15} /> Играть сейчас
            </div>
            <div className="ctxmenu-item" onClick={() => { queueNext(t.id); close() }}>
              <Icon name="plus" size={15} /> Поставить следующим
            </div>
            <div className="ctxmenu-item" onClick={() => { setPlPick(t.id); close() }}>
              <Icon name="plus" size={15} /> Добавить в плейлист
            </div>
            <div className="ctxmenu-item" onClick={() => { void copyText(t.url, 'Ссылка скопирована'); close() }}>
              <Icon name="link" size={15} /> Скопировать ссылку
            </div>
            {/* v1.440.0: отдать песню другу прямо отсюда. Раньше для этого надо
                было скопировать голую ссылку, открыть переписку и вставить — и
                собеседник получал адрес без единого слова о том, что это. */}
            <div className="ctxmenu-item" onClick={() => { setShareFor(t); close() }}>
              <Icon name="forward" size={15} /> Отправить другу
            </div>
            {unplayable(t) && <div className="ctxmenu-item" onClick={() => {
              forgetBroken(t.id); forgetNoEmbed(t.id); setYtDenied(prev => prev.filter(x => x !== t.id)); toastOk('Попробую этот трек снова'); close()
            }}><Icon name="rotate" size={15} /> Попробовать снова</div>}
            {mine
              ? <div className="ctxmenu-item danger" onClick={() => { void removeTrack(t.id, cardMenu.title); close() }}>
                  <Icon name="trash" size={15} /> Убрать из Трекотеки
                </div>
              : <div className="ctxmenu-note">Убрать может только тот, кто выложил трек</div>}
          </div>
        </Portal>
      })()}

      {/* v1.428.0: выбор плейлиста. Раньше это было окошко «введите название»:
          чтобы положить трек в существующий плейлист, надо было вспомнить и
          набрать его имя посимвольно — ошибся буквой, и завёлся второй почти с
          тем же названием. */}
      {plPick && <Portal>
        <div className="ctxmenu-overlay" onClick={() => setPlPick(null)} />
        <div className="ctxmenu mus2-plpick">
          <div className="ctxmenu-title">В какой плейлист</div>
          {playlists.length === 0 && <div className="ctxmenu-note">Плейлистов пока нет — заведи первый.</div>}
          {playlistsOrder(playlists).map(p => (
            <div key={p.id} className="ctxmenu-item" onClick={() => { putInPlaylist(p.id, plPick); setPlPick(null) }}>
              <Icon name="list" size={15} /> {p.name}
              <span className="mus2-plcount">{playlistSize(p, tracks)}</span>
            </div>
          ))}
          <div className="ctxmenu-item" onClick={() => { const id = plPick; setPlPick(null); void newPlaylistWith(id) }}>
            <Icon name="plus" size={15} /> Новый плейлист
          </div>
        </div>
      </Portal>}

      {plNew && <Portal>
        <div className="mus2-share-ov" onClick={() => setPlNew(null)}>
          <div className="mus2-share mus2-plnew" onClick={e => e.stopPropagation()}>
            <div className="mus2-share-h"><b>Новый плейлист</b></div>
            <div className="mus2-plnew-body">
              {/* Обложка своя — необязательная: без неё плитка соберётся из
                  обложек треков, как и раньше. */}
              <button className="mus2-plnew-cover" onClick={() => plCoverRef.current?.click()}
                title="Выбрать обложку плейлиста" disabled={plBusy}>
                {plCover ? <img src={plCover} alt="" /> : <span><Icon name="image" size={22} />{plBusy ? 'Загружаю…' : 'Обложка'}</span>}
              </button>
              <input ref={plCoverRef} type="file" accept="image/*" hidden onChange={pickPlCover} />
              <div className="mus2-plnew-right">
                <input className="mus2-in" autoFocus placeholder="Название" maxLength={PL_NAME_MAX}
                  value={plName} onChange={e => setPlName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void createPlNow() }} />
                <div className="mus2-plnew-hint">
                  {plNew.trackId ? 'Трек попадёт в него сразу' : 'Треки добавишь из меню карточки'} · до {PL_TRACKS_MAX} треков
                </div>
              </div>
            </div>
            <div className="mus2-plnew-foot">
              {plCover && <button className="mus2-plnew-clear" onClick={() => setPlCover(null)}>Убрать обложку</button>}
              <button className="mus2-plnew-cancel" onClick={() => setPlNew(null)}>Отмена</button>
              <button className="mus2-plnew-ok" disabled={!plName.trim() || plBusy} onClick={() => void createPlNow()}>Создать</button>
            </div>
          </div>
        </div>
      </Portal>}

      {shareFor && <Portal>
        <div className="mus2-share-ov" onClick={() => setShareFor(null)}>
          <div className="mus2-share" onClick={e => e.stopPropagation()}>
            <div className="mus2-share-h">
              <b>Отправить другу</b>
              <span className="notr" translate="no">{meta[shareFor.url]?.title || shareFor.name}</span>
            </div>
            <div className="mus2-share-list">
              {shareList.length === 0 && <div className="mus2-empty">Нет друзей, которым можно отправить</div>}
              {shareList.map(f => (
                <button key={f.id} className="mus2-share-item" disabled={!!shareBusy}
                  onClick={async () => {
                    setShareBusy(f.id)
                    try {
                      await sendTrackToFriend(meId, me, f.id, {
                        title: meta[shareFor.url]?.title || shareFor.name,
                        author: meta[shareFor.url]?.author || shareFor.author,
                        url: shareFor.url,
                      })
                      toastOk('Отправлено — ' + f.username)
                      setShareFor(null)
                    } catch (e: any) { toastErr(e?.message ?? String(e)) }
                    finally { setShareBusy('') }
                  }}>
                  <Avatar name={f.username} url={f.avatar_url} size={28} />
                  <span>{f.username}</span>
                  {shareBusy === f.id && <span className="mut">отправляю…</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Portal>}

      {showLib && <Portal><div className="mus2-lib" onClick={() => setShowLib(false)}>
        <div className="mus2-lib-inner" onClick={e => e.stopPropagation()}>
          <header className="mus2-lib-head">
            <b>Ponoi Music · Трекотека</b>
            {/* v1.462.0: сколько всего треков — СРАЗУ, а не по мере загрузки.
                Раньше здесь ничего не было, и человек смотрел, как список
                бесконечно растёт, не понимая, сколько его ждёт и кончится ли
                это вообще. Число берётся из базы одним запросом, независимо от
                того, сколько строк уже приехало. */}
            <span className="mus2-lib-count">
              {libTotal != null
                ? libTotal.toLocaleString('ru') + (tracks.length < libTotal ? ' · загружено ' + tracks.length.toLocaleString('ru') : '')
                : (tracks.length ? tracks.length.toLocaleString('ru') : '…')}
            </span>
            {/* v1.428.0: у склада появился второй отдел — плейлисты. Раньше они
                жили одной строкой в узкой панели плеера: ни открыть, ни включить
                целиком, ни переименовать.
                v1.435.0: отделы стоят слева, сразу за названием — это выбор
                РАЗДЕЛА, а не действие, и место ему в начале строки, а не в
                дальнем углу. Кнопка закрытия ушла в правый верхний угол, где её
                и ищут: раньше она стояла посреди шапки. */}
            <div className="mus2-libtabs">
              <button className={'mus2-tab' + (libTab === 'tracks' ? ' on' : '')}
                onClick={() => { setLibTab('tracks'); setOpenPl(null) }}>Треки</button>
              <button className={'mus2-tab' + (libTab === 'playlists' ? ' on' : '')}
                onClick={() => setLibTab('playlists')}>Плейлисты{playlists.length > 0 ? ' · ' + playlists.length : ''}</button>
            </div>
            <input className="mus2-in" placeholder="Поиск по названию или исполнителю…" value={libQ} onChange={e => setLibQ(e.target.value)} />
            <button className="mus2-lib-x" title="Закрыть Трекотеку" onClick={() => setShowLib(false)}><Icon name="close" size={16} /></button>
          </header>
          {/* v1.371.0: сетка карточек вместо строчек, как на главной Spotify.
              Кто выложил трек — убрано: в списке из сотни записей это ничего не
              говорит и только занимает место, а обложка узнаётся мгновенно. */}
          <div className="mus2-lib-body">
            {/* v1.417.0: уголок плагинов над списком треков. */}
            <PluginPanels slot="library" />
            {libTab === 'playlists' ? <>
              {/* ── Отдел плейлистов ─────────────────────────────────────── */}
              {(() => {
                const pl = openPl ? playlists.find(p => p.id === openPl) : null
                if (pl) {
                  const list = playlistTracks(pl, tracks)
                  return <>
                    <div className="mus2-plhead">
                      <button className="mus2-plback" onClick={() => setOpenPl(null)}><Icon name="chevron-left" size={16} /> Плейлисты</button>
                      <div className="mus2-pltitle notr" translate="no">{pl.name}</div>
                      <div className="mus2-lib-count">{list.length} трек.</div>
                      <div className="mus2-plbtns">
                        <button className="pqs2-btn" disabled={list.length === 0} onClick={() => playPlaylist(pl)}>
                          <Icon name="play" size={15} /> Играть
                        </button>
                        <button className="pqs2-btn ghost" onClick={async () => {
                          const nm = (await promptUi('Новое название', { initial: pl.name, okText: 'Сохранить' }))?.trim()
                          if (!nm) return
                          const n = renamePlaylist(playlists, pl.id, nm); setPlaylists(n); savePlaylists(n)
                        }}><Icon name="edit" size={15} /> Переименовать</button>
                        <button className="pqs2-btn ghost danger" onClick={async () => {
                          if (!await confirmUi(`Удалить плейлист «${pl.name}»?`, { okText: 'Удалить', danger: true })) return
                          const n = removePlaylist(playlists, pl.id); setPlaylists(n); savePlaylists(n); setOpenPl(null)
                        }}><Icon name="trash" size={15} /> Удалить</button>
                      </div>
                    </div>
                    {list.length === 0
                      ? <div className="mus2-empty center">Плейлист пуст. Добавь треки из отдела «Треки» — долгое нажатие или правый щелчок по карточке.</div>
                      : <div className="mus2-pllist">
                          {list.map((t, n) => (
                            <div key={t.id} className={'mus2-plrow' + (cur?.id === t.id ? ' on' : '')}
                              onClick={() => { const i = tracks.findIndex(x => x.id === t.id); playAt(i); setPlaying(true); setShowLib(false) }}>
                              <span className="mus2-plnum">{n + 1}</span>
                              <span className="mus2-lib-art">
                                {(meta[t.url]?.art || t.art) ? <img src={(meta[t.url]?.art || t.art)!} alt="" loading="lazy" /> : <Icon name="music" size={18} />}
                              </span>
                              <span className="mus2-lib-meta">
                                <span className="mus2-lib-t notr" translate="no">{meta[t.url]?.title || t.name}</span>
                                <span className="mus2-lib-a notr" translate="no">{meta[t.url]?.author || t.author || ''}</span>
                              </span>
                              {t.dur ? <span className="mus2-lib-d">{fmt(t.dur)}</span> : null}
                              {/* Порядок треков — то, ради чего плейлист и нужен. */}
                              <button className="mus2-plmove" title="Выше" onClick={e => {
                                e.stopPropagation()
                                const n2 = movePlaylistTrack(playlists, pl.id, t.id, -1); setPlaylists(n2); savePlaylists(n2)
                              }}><Icon name="chevron-up" size={14} /></button>
                              <button className="mus2-plmove" title="Ниже" onClick={e => {
                                e.stopPropagation()
                                const n2 = movePlaylistTrack(playlists, pl.id, t.id, 1); setPlaylists(n2); savePlaylists(n2)
                              }}><Icon name="chevron-down" size={14} /></button>
                              <button className="mus2-plmove danger" title="Убрать из плейлиста" onClick={e => {
                                e.stopPropagation()
                                const n2 = removeFromPlaylist(playlists, pl.id, t.id); setPlaylists(n2); savePlaylists(n2)
                              }}><Icon name="close" size={14} /></button>
                            </div>
                          ))}
                        </div>}
                  </>
                }
                return <>
                  <div className="mus2-plbtns" style={{ marginBottom: 12 }}>
                    {/* v1.441.0: обложку можно поменять и потом, а не только при
                        создании — иначе она была бы решением на один раз. */}
                    <button className="pqs2-btn" onClick={() => { setPlCoverFor(pl!.id); plCoverRef.current?.click() }}>
                      <Icon name="image" size={15} /> {pl!.cover ? 'Сменить обложку' : 'Обложка'}
                    </button>
                    {pl!.cover && <button className="pqs2-btn" onClick={() => {
                      const n = setPlaylistCover(playlists, pl!.id, null)
                      setPlaylists(n); savePlaylists(n); toastOk('Обложка убрана')
                    }}><Icon name="close" size={15} /> Убрать обложку</button>}
                    <button className="pqs2-btn" onClick={() => void newPlaylistWith()}><Icon name="plus" size={15} /> Новый плейлист</button>
                  </div>
                  {playlists.length === 0
                    ? <div className="mus2-empty center">Плейлистов пока нет. Заведи первый — и складывай в него треки долгим нажатием по карточке.</div>
                    : <div className="mus2-grid">
                        {playlistsOrder(playlists).map(p => {
                          const list = playlistTracks(p, tracks)
                          const arts = list.map(t => meta[t.url]?.art || t.art).filter(Boolean).slice(0, 4) as string[]
                          return (
                            <div key={p.id} className="mus2-card" onClick={() => setOpenPl(p.id)}
                              title={p.name + ' — ' + list.length + ' трек.'}>
                              {/* Обложка плейлиста — плитка из обложек его треков, как в Spotify. */}
                              {/* v1.441.0: своя обложка, если её поставили; иначе — плитка
                                  из обложек треков, как и было. */}
                              <div className={'mus2-card-art mus2-plart n' + (p.cover ? 1 : Math.min(arts.length, 4))}>
                                {p.cover
                                  ? <img src={p.cover} alt="" loading="lazy" />
                                  : arts.length === 0
                                  ? <Icon name="music" size={34} />
                                  : arts.map((a, i) => <img key={i} src={a} alt="" loading="lazy" />)}
                                <span className="mus2-card-d">{list.length} трек.</span>
                              </div>
                              <div className="mus2-card-t notr" translate="no">{p.name}</div>
                              <div className="mus2-card-a">
                                {list.length === 0 ? 'пусто' : (meta[list[0].url]?.title || list[0].name)}
                              </div>
                            </div>
                          )
                        })}
                      </div>}
                </>
              })()}
            </> : <>
            {tracks.length > 1 && !libQ.trim() && (
              <div className="mus2-lib-row">
                <div className="mus2-lib-note">Сначала — то, что слушают чаще всего</div>
              </div>
            )}
            {(() => {
              const all = libAll   // v1.434.0: посчитано выше и только при нужде
              if (tracks.length === 0) {
                return <div className="mus2-empty center">Трекотека пуста. Добавь трек — его увидят все.</div>
              }
              const shown = all.slice(0, libShown)
              if (all.length === 0) {
                // v1.441.0: пустой поиск больше не тупик. Раньше строка «ничего
                // не нашлось» была концом разговора, хотя ровно в этот момент
                // человек и хочет добавить свою песню — а кнопка добавления
                // живёт наверху и в этот момент не на виду.
                return <div className="mus2-empty center mus2-noresult">
                  <div className="mus2-noresult-t">Ничего не нашлось по запросу «{libQ.trim()}»</div>
                  {libHint
                    ? <div className="mus2-noresult-s">
                        Возможно, имелось в виду{' '}
                        <button className="mus2-noresult-hint" onClick={() => setLibQ(libHint)}>{libHint}</button>
                      </div>
                    : <div className="mus2-noresult-s">Этой песни ещё нет в Трекотеке. Загрузи свой файл — он появится у всех.</div>}
                  <button className="mus2-noresult-b" onClick={() => fileRef.current?.click()}>
                    <Icon name="paperclip" size={15} /> Загрузить свой файл
                  </button>
                  <button className="mus2-noresult-l" onClick={() => setLibQ('')}>Показать всю Трекотеку</button>
                </div>
              }
              return <>
                <div className="mus2-lib-count">{all.length === tracks.length
                  ? `Треков: ${tracks.length}`
                  : `Найдено: ${all.length} из ${tracks.length}`}</div>
                <div className="mus2-grid">
                  {shown.map(t => {
                    // v1.434.0: номер из карты. Перебор всего склада на КАЖДУЮ
                    // карточку — это на пяти тысячах треков полмиллиона сравнений
                    // за одну отрисовку, а отрисовок две-четыре в секунду.
                    const i = byId.get(t.id) ?? -1
                    const art = meta[t.url]?.art || t.art
                    const author = meta[t.url]?.author || t.author
                    const title = meta[t.url]?.title || t.name
                    const on = i === idx
                    return (
                      <div key={t.id} className={'mus2-card' + (on ? ' on' : '') + (isBroken(t.id) ? ' broken' : '')}
                        title={title + (author ? ' — ' + author : '')}
                        onClick={() => { if (guest) { toastErr(noGuest); return } playAt(i); setPlaying(true); setShowLib(false) }}
                        onContextMenu={e => { e.preventDefault(); if (!guest) setCardMenu({ id: t.id, title, x: e.clientX, y: e.clientY }) }}
                        // Долгое нажатие — то же меню: на телефоне правого щелчка нет.
                        // v1.433.0: отсчёт общий (lib/longPress.ts). Здесь он снимал
                        // слушателей через e.currentTarget, который у React после выхода
                        // из обработчика равен null: они не снимались вовсе, и каждое
                        // касание карточки оставляло на ней три вечных слушателя.
                        onPointerDown={e => { if (!guest) startLongPress(e, at => setCardMenu({ id: t.id, title, ...at })) }}>
                        <div className="mus2-card-art">
                          {art ? <img src={art} alt="" loading="lazy" /> : <Icon name="music" size={34} />}
                          {/* v1.426.0: карточка чистая.
                              Раньше при наведении на неё вылезали три кнопки:
                              «играть» (хотя щелчок по карточке и так играет),
                              «поставить следующим» и «убрать из Трекотеки» — и
                              последняя показывалась ВСЕМ, даже у чужого трека,
                              который база всё равно не даст удалить: кнопка,
                              которая гарантированно откажет, хуже отсутствующей.
                              Осталась одна, и только у своего трека. Всё
                              остальное — правым щелчком или долгим нажатием (см.
                              меню карточки ниже): функции никуда не делись. */}
                          {!guest && t.ownerId === meId && <button className="mus2-card-del" title="Убрать из Трекотеки"
                            onClick={e => { e.stopPropagation(); void removeTrack(t.id, title) }}>
                            <Icon name="trash" size={14} />
                          </button>}
                          {t.dur ? <span className="mus2-card-d">{fmt(t.dur)}</span> : null}
                          {/* v1.406.0: сколько раз слушали — на самой обложке. Раньше
                              число стояло мелким шрифтом в строке автора, разглядеть
                              его было почти нельзя, а теперь по нему выложен весь склад. */}
                          {/* v1.414.0: трек, который не заиграл дважды подряд, помечен —
                              он и в очереди обходится, и притворяться рабочим не должен. */}
                          {isBroken(t.id) && <span className="mus2-card-bad" title="Не играет — плеер пробовал дважды">не играет</span>}
                          {/* v1.421.0: попробовать снова. Пометка «не играет»
                              ставилась навсегда, и снять её было нечем вообще
                              нигде: трек, отказавший из-за минутного сбоя сети
                              или региона, оставался обойдённым до конца времён.
                              Функции для этого лежали в broken.ts с самого
                              начала и не были подключены ни к одной кнопке. */}
                          {unplayable(t) && <button className="mus2-card-retry" title="Попробовать этот трек снова"
                            onClick={e => { e.stopPropagation(); forgetBroken(t.id); forgetNoEmbed(t.id); setYtDenied(prev => prev.filter(x => x !== t.id)); toastOk('Попробую этот трек снова') }}>
                            <Icon name="rotate" size={13} />
                          </button>}
                          {/* v1.420.0: запрет на встраивание — это НЕ поломка трека, и
                              помечать его как «не играет» было бы неправдой: на самом
                              YouTube он играет прекрасно. Пометка отдельная и мягче. */}
                          {!isBroken(t.id) && isNoEmbed(t.id) && !copyOf(t) &&
                            null}
                          {/* v1.424.0: число стоит на КАЖДОМ треке, как в SoundCloud.
                              Раньше оно появлялось только у тех, кого человек уже
                              слушал сам: у остальных было пусто — и не потому, что
                              их не слушали, а потому что общее число не читалось из
                              базы вовсе (см. rowToTrack). */}
                          <span className="mus2-card-pl" title={'Прослушиваний: ' + (t.plays ?? 0)}>
                            <Icon name="play" size={11} />{fmtPlays(t.plays ?? 0)}
                          </span>
                        </div>
                        <div className="mus2-card-t notr" translate="no">{title}</div>
                        <div className="mus2-card-a">
                          <span className="notr" translate="no">{author || ''}</span>
                          {!author ? '\u00a0' : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* v1.416.0: конец списка. Доехали до него — Трекотека сама
                    добавляет следующую порцию, поэтому листать можно без конца
                    и без кнопок. Метка нужна и когда всё уже показано: тогда
                    она просто ничего не делает. */}
                {all.length > shown.length && <div ref={libEndRef} className="mus2-lib-end">Загружаю ещё…</div>}
              </>
            })()}
            </>}
          </div>
        </div>
      </div></Portal>}

      {curYt && ytId && <iframe key={ytId} ref={ytFrameRef} className="mus2-ytframe" title="YouTube" allow="autoplay; encrypted-media"
        src={'https://www.youtube.com/embed/' + ytId + '?enablejsapi=1&playsinline=1&controls=0&rel=0'} />}
      <audio ref={audioRef} src={audioSrc}
        onEnded={next}
        // v1.414.0: раньше отказ <audio> не обрабатывался вовсе — плеер молча
        // замолкал на битой ссылке, и это выглядело как «сломался плеер».
        onError={() => trackFailed('Трек не открылся', cur?.id)}
        onPlaying={() => { if (cur) markOk(cur.id) }}
        onTimeUpdate={e => setCurT((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => {
          const a = e.target as HTMLAudioElement
          setDur(a.duration)
          // v1.460.0: место из прошлого сеанса применяем ровно здесь — раньше
          // источник его молча проглатывал, потому что ещё не знал длины.
          const хочем = seekWanted.current
          if (хочем != null && хочем > 0 && хочем < (a.duration || Infinity)) {
            a.currentTime = хочем
            setCurT(хочем)
          }
          seekWanted.current = null
        }} />
      {settings && <MusicSettings onClose={() => setSettings(false)} onChange={refreshCfg} dsp={dsp} onDsp={saveDsp} />}
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
            {/* v1.404.0: ручная поправка. Даже верно подобранный текст у одной
                записи идёт раньше, у другой позже — вступление длиннее, нарезка
                другая. Угадать это нельзя, поэтому сдвиг задаёт человек, и он
                помнится для каждого трека отдельно. */}
            <div className="lyr-shift">
              <span>Сдвиг текста</span>
              <button className="pqs2-btn ghost" onClick={() => nudgeLyrics(-0.5)} title="Текст спешит — задержать">−0,5 с</button>
              <b className="notr" translate="no">{lyrShift > 0 ? '+' : ''}{lyrShift.toFixed(1)} с</b>
              <button className="pqs2-btn ghost" onClick={() => nudgeLyrics(0.5)} title="Текст опаздывает — поторопить">+0,5 с</button>
              {lyrShift !== 0 && <button className="pqs2-btn ghost" onClick={() => nudgeLyrics(-lyrShift)}>Сбросить</button>}
              {lyrK !== 1 && <span className="lyr-shift-note">Текст подогнан под скорость записи (×{lyrK.toFixed(2)})</span>}
            </div>
            {/* v1.420.0: внутренний ИИ. Слушает сам звук трека и расставляет
                метки времени: если слова уже вписаны — только время (слова
                остаются правильными), если нет — и слова тоже, с честной
                подписью, что они распознаны на слух. */}
            <div className="lyr-ai">
              <div className="lyr-ai-h"><Icon name="zap" size={14} /> Распознать на слух</div>
              <div className="lyr-ai-d">
                {aiWhy
                  ? aiWhy
                  : lyrEdit.trim()
                    ? 'Слова в поле выше останутся как есть — ИИ послушает трек и расставит им метки времени. Так караоке получается у песни, которой нет ни в одном каталоге.'
                    : 'ИИ послушает трек и напишет текст сам. Слова могут быть с ошибками — модель обучена на речи, а не на пении; поправить их можно тут же.'}
              </div>
              {!aiWhy && <div className="lyr-ai-d">
                При первом запуске скачивается модель распознавания (около 40 МБ, дальше берётся из кэша) — нужен интернет.
              </div>}
              {aiRun
                ? <div className="lyr-ai-run">
                    <div className="lyr-ai-bar"><i style={{ width: aiRun.percent + '%' }} /></div>
                    <span>{aiRun.note} · {aiRun.percent}%</span>
                  </div>
                : <button className="pqs2-btn" disabled={!!aiWhy || lyrBusy} onClick={() => { void recognizeLyricsNow() }}>
                    <Icon name="zap" size={15} /> {lyrEdit.trim() ? 'Расставить метки времени' : 'Распознать текст'}
                  </button>}
            </div>
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
      /* v1.425.0: на телефоне плашка не таскается.
         Летающая пилюля, которую надо ловить пальцем, на маленьком экране только
         мешает: она закрывает то, что под ней, и уезжает под палец при прокрутке.
         Место у неё одно и правильное — строкой внизу, над панелью с аватаркой,
         как во всех музыкальных приложениях. Перетаскивание остаётся на
         компьютере, где мышь и большой экран. */
      <div ref={IS_MOBILE ? undefined : miniDrag.ref} className={'mus-mini' + (miniDrag.dragging ? ' dragging' : '')}
        style={IS_MOBILE ? musStyle : { ...musStyle, ...miniDrag.style }}
        onPointerDown={IS_MOBILE ? undefined : miniDrag.onPointerDown}>
        <div className={'mus-mini-art' + (playing ? ' spin' : '')}
          onClick={() => { if (IS_MOBILE || !miniDrag.wasDrag()) onClose() }}
          title={IS_MOBILE ? 'Открыть плеер' : 'Открыть плеер · тяни, чтобы переставить'}>
          {/* v1.386.0: без запрета перетаскивания браузер тащил саму картинку —
              вместо плашки за курсором ехала копия обложки, и переставить её
              было почти невозможно. */}
          {curArt ? <img src={curArt} alt="" draggable={false} onDragStart={e => e.preventDefault()} /> : <Icon name="music" size={18} />}
        </div>
        <div className="mus-mini-meta" onClick={() => { if (IS_MOBILE || !miniDrag.wasDrag()) onClose() }} title="Открыть плеер">
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