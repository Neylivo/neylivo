import type { Room, LocalTrackPublication } from 'livekit-client'
import { supabase } from './supabase'
import { getSettings } from './settings'
import { setActiveChain, setVoiceApplier, savedVoiceEffect, type VoiceEffect } from './voiceFx'
import { VoiceChain } from './voiceFxChain'
import { RoomEvent, Track, verifyLivekitConstants } from './livekitConst'

// v1.288.0: livekit-client грузится ТОЛЬКО при входе в звонок.
//
// Раньше он был обычным статическим импортом и весил 6.6 МБ из 7.6 МБ всего JS
// приложения — то есть 87% веса первой загрузки приходилось на библиотеку,
// которая большинству людей в этот заход вообще не понадобится. Теперь всё, что
// от неё нужно до звонка (имена событий), лежит в livekitConst.ts, а сама
// библиотека подтягивается здесь, при первом joinRoom.
let lkPromise: Promise<typeof import('livekit-client')> | null = null
function loadLivekit() {
  if (!lkPromise) {
    lkPromise = import('livekit-client').then(lk => {
      // Сверяем наши константы с настоящими ровно один раз — если обновление
      // библиотеки переименовало событие, узнаем сразу, а не по жалобам на
      // «звонок подключился, но никого не видно».
      verifyLivekitConstants(lk)
      return lk
    })
  }
  return lkPromise
}

/**
 * v1.290.0: тихо подготовить всё для звонка, пока человек просто читает чат.
 *
 * Первый за сессию звонок тянет саму библиотеку (532 КБ) и, при публикации
 * микрофона, Krisp (6 МБ wasm) — то есть пауза случалась ровно в тот момент, когда
 * человек торопится ответить. Здесь мы качаем это заранее и в фоне.
 *
 * Не делаем этого, если браузер сообщает про экономию трафика или медленное
 * соединение: тащить 6.5 МБ на мобильном интернете ради возможного звонка — плохой
 * обмен, а joinRoom и так справится сам, просто чуть дольше.
 */
export function preloadCallStack(): void {
  const c = (navigator as any).connection
  if (c?.saveData) return
  if (typeof c?.effectiveType === 'string' && /(^|-)2g$/.test(c.effectiveType)) return
  void loadLivekit()
    // Krisp — вторым шагом и молча: он необязателен (без него остаётся браузерный
    // шумодав), поэтому его неудача не должна выглядеть как ошибка приложения.
    .then(() => import('@livekit/krisp-noise-filter'))
    .catch(() => { /* нет сети или пакет недоступен — подгрузится при самом звонке */ })
}

// v1.71.0: AI-шумоподавление Krisp — то же, что использует Discord: отсекает
// клавиатуру, вентиляторы, улицу и прочий фон, оставляя только голос.
// Вешается на локальную дорожку микрофона при её публикации; если Krisp
// недоступен (старый браузер / self-hosted LiveKit / пакет не установился при
// сборке) — тихо остаёмся на браузерном noiseSuppression, звонок работает как раньше.
// v1.150.0: импорт сделан динамическим — раньше это был статический import,
// и когда пакет однажды не резолвился (см. build_environment_issue), падал
// не только Krisp, а ВЕСЬ этот файл и, соответственно, все звонки целиком.
/**
 * Что с шумоподавлением на самом деле (v1.409.0).
 *
 * Раньше узнать это было нельзя никак: Krisp либо подключался, либо молча не
 * подключался, и человек оставался с вопросом «а шум-то давится?». Теперь
 * состояние видно в самом звонке, а «выключено» — это выбор человека, а не
 * тихий отказ.
 *
 *   'ai'      — работает Krisp, тот же, что в Discord;
 *   'browser' — только браузерный шумодав (Krisp не поддержан или не загрузился);
 *   'off'     — человек сам выключил ИИ-шумодав в настройках.
 */
export type NoiseMode = 'ai' | 'browser' | 'off'
let noiseMode: NoiseMode = 'browser'
const noiseListeners = new Set<() => void>()
export function noiseSuppression(): NoiseMode { return noiseMode }
export function subscribeNoise(fn: () => void): () => void {
  noiseListeners.add(fn)
  return () => { noiseListeners.delete(fn) }
}
function setNoise(m: NoiseMode) {
  if (noiseMode === m) return
  noiseMode = m
  noiseListeners.forEach(f => { try { f() } catch {} })
}

function attachKrisp(room: Room, lk: typeof import('livekit-client')) {
  room.on(RoomEvent.LocalTrackPublished, async (pub: LocalTrackPublication) => {
    if (pub.source !== Track.Source.Microphone) return
    const track = pub.track
    // Класс берём из уже загруженного модуля: статического импорта больше нет.
    if (!(track instanceof lk.LocalAudioTrack)) return
    if (!getSettings().krisp) { setNoise('off'); return }
    try {
      const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import('@livekit/krisp-noise-filter')
      if (!isKrispNoiseFilterSupported()) { setNoise('browser'); return }
      await track.setProcessor(KrispNoiseFilter())
      setNoise('ai')
    } catch {
      // Пакет недоступен или процессор не завёлся — остаёмся на браузерном.
      setNoise('browser')
    }
  })
}

// v1.152.0: короткий кэш токена — LiveKit-токен живёт часы на сервере, но раньше
// joinRoom() ходил за новым при КАЖДОМ входе, даже если человек просто быстро
// переключился между голосовыми каналами/перезашёл в тот же звонок. 4 минуты
// кэша не портят безопасность (токен и так столько живёт), но убирают лишний
// сетевой round-trip до Edge Function на самых частых повторных входах.
const tokenCache = new Map<string, { token: string; url: string; at: number }>()
const TOKEN_TTL = 4 * 60_000
async function getToken(roomName: string, identity: string, name: string): Promise<{ token: string; url: string }> {
  const key = roomName + '|' + identity
  const cached = tokenCache.get(key)
  if (cached && Date.now() - cached.at < TOKEN_TTL) return cached
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { room: roomName, identity, name },
  })
  if (error) throw error
  const out = data as { token: string; url: string }
  tokenCache.set(key, { ...out, at: Date.now() })
  return out
}

// v1.176.0: раньше микрофон захватывался ТОЛЬКО после того, как комната уже
// подключилась — токен, коннект и getUserMedia шли строго друг за другом, отсюда
// секунды на ровном месте (диалог разрешения браузера и захват устройства
// блокировали весь остальной путь). Теперь захват микрофона стартует СРАЗУ,
// параллельно с получением токена и коннектом к LiveKit — как только комната
// готова, уже захваченная дорожка публикуется напрямую (без повторного
// getUserMedia, который делает setMicrophoneEnabled). Экономит секунды,
// особенно на первом входе в звонок за сессию.
/**
 * v1.301.0: сквозное шифрование медиа звонка.
 *
 * Ключ сюда приходит уже готовым: его вырабатывает звонящий и доставляет
 * собеседнику через обычную зашифрованную переписку — то есть по каналу, который
 * сервер прочитать не может. Сам сервер LiveKit при этом продолжает пересылать
 * пакеты, но их содержимое для него становится нечитаемым.
 *
 * Чего это НЕ скрывает, и об этом надо говорить прямо: сервер по-прежнему видит,
 * кто и когда подключился к какой комнате и сколько длился звонок. Шифруется
 * содержание, а не сам факт разговора.
 */
export interface E2eeOptions { key: string }

async function buildE2ee(lk: typeof import('livekit-client'), opt: E2eeOptions) {
  if (!lk.isE2EESupported()) throw new Error('Это устройство не поддерживает шифрование звонка')
  const keyProvider = new lk.ExternalE2EEKeyProvider()
  await keyProvider.setKey(opt.key)
  // Воркер шифрования поставляется вместе с библиотекой. Путь именно такой:
  // прямая ссылка на файл в dist не работает — пакет отдаёт наружу только
  // объявленные точки входа, и сборка на ней падает.
  const worker = new Worker(
    new URL('livekit-client/e2ee-worker', import.meta.url),
    { type: 'module' },
  )
  return { keyProvider, worker }
}

/**
 * Обработка микрофона: «Громкость микрофона» из настроек и эффект голоса.
 *
 * v1.332.0: ползунок громкости сохранялся и не читался нигде. v1.333.0: сюда же
 * встал голосовой эффект (см. voiceFx.ts) — цепочка одна и та же, менять эффект
 * посреди звонка можно без перепубликации дорожки.
 *
 * Осторожно и намеренно: если громкость 100% и эффект «Обычный» — дорожка НЕ
 * трогается вовсе, путь остаётся ровно прежним. Цепочка появляется только когда
 * человек сам чего-то попросил, и если WebAudio не заведётся, остаётся исходная
 * дорожка: тихий микрофон хуже необработанного, а звонки — самая непроверяемая
 * часть приложения.
 */
let curRoom: Room | null = null
let curMic: { mediaStreamTrack: MediaStreamTrack; stop: () => void } | null = null
let curChain: VoiceChain | null = null

function buildChain(track: { mediaStreamTrack: MediaStreamTrack }, effect: VoiceEffect): VoiceChain | null {
  try {
    const chain = new VoiceChain(track.mediaStreamTrack, getSettings().micVol / 100)
    chain.setEffect(effect)
    if (!chain.track) { chain.close(); return null }
    return chain
  } catch { return null }
}

function releaseMicChain() {
  setVoiceApplier(null)
  if (curChain) { setActiveChain(null); curChain.close(); curChain = null }
  try { curMic?.stop() } catch {}
  curMic = null
  curRoom = null
}

/**
 * Включить эффект голоса прямо во время разговора.
 *
 * Если цепочки ещё нет (человек не трогал ни громкость, ни эффекты), она
 * создаётся здесь же, и обработанная дорожка публикуется вместо исходной. Это
 * единственный момент, когда собеседник видит перепубликацию — дальше
 * переключение эффектов идёт внутри цепочки и для него незаметно.
 */
export async function applyVoiceEffect(effect: VoiceEffect): Promise<boolean> {
  if (curChain) { curChain.setEffect(effect); setActiveChain(curChain); return true }
  if (effect === 'none') return true
  if (!curRoom || !curMic) return false
  const chain = buildChain(curMic, effect)
  if (!chain) return false
  try {
    const lp: any = curRoom.localParticipant
    const pub = Array.from(lp.audioTrackPublications?.values?.() ?? lp.audioTracks?.values?.() ?? [])
      .find((p: any) => p?.source === Track.Source.Microphone) as any
    await lp.publishTrack(chain.track, { source: Track.Source.Microphone })
    if (pub?.track) { try { await lp.unpublishTrack(pub.track, false) } catch {} }
    curChain = chain
    setActiveChain(chain)
    return true
  } catch {
    chain.close()
    return false
  }
}

export interface ChannelMedia { bitrateKbps?: number; videoQuality?: string }
const VQ_HEIGHT: Record<string, number> = {
  '144p': 144, '240p': 240, '360p': 360, '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440,
}

export async function joinRoom(roomName: string, identity: string, name: string, e2ee?: E2eeOptions, media?: ChannelMedia): Promise<Room> {
  const tokenKey = roomName + '|' + identity
  // v1.64.0: максимальное качество звонка — подавление эха/шума и автогромкость,
  // высокобитрейтный стерео-звук (RED + DTX), камера 1080p с simulcast.
  // v1.80.0: как в Discord — кодек VP9 (та же картинка при меньшем битрейте,
  // c запасным кодеком для старых устройств), чёткий даунскейл под реальный
  // экран (pixelDensity: 'screen'), битрейт камеры поднят до 4.5 Мбит/с.
  // v1.113.0: звук ещё лучше — свой битрейт 256 кбит/с стерео (выше «музыкального»
  // пресета), камера до 8 Мбит/с; выбранные ранее устройства (микрофон/камера)
  // применяются сразу при входе в звонок.
  const savedMic = localStorage.getItem('ponoi_dev_mic') || undefined
  const savedCam = localStorage.getItem('ponoi_dev_cam') || undefined
  const audioOpts = { deviceId: savedMic, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  // Загрузка библиотеки идёт параллельно с получением токена — тот же приём, что
  // и с микрофоном ниже: сеть за токеном и сеть за кодом не ждут друг друга.
  const lkPromise2 = loadLivekit()
  const tokenPromise = getToken(roomName, identity, name)
  const { Room, VideoPresets, createLocalAudioTrack } = await lkPromise2
  const e2eeOpts = e2ee ? await buildE2ee(await lkPromise2, e2ee) : null
  // Не await — стартует параллельно с получением токена/коннектом ниже.
  const micPromise = createLocalAudioTrack(audioOpts).catch(() => null)
  let { token, url } = await tokenPromise
  // Качество видео канала: берём готовый пресет LiveKit по высоте кадра, чтобы
  // разрешение и битрейт картинки были согласованы, а не выдуманы здесь.
  const vqH = media?.videoQuality && media.videoQuality !== 'auto' ? VQ_HEIGHT[media.videoQuality] : undefined
  const vqPreset = vqH
    ? (Object.values(VideoPresets) as any[]).filter(p => p?.resolution?.height).sort((a, b) => a.resolution.height - b.resolution.height)
        .find(p => p.resolution.height >= vqH)
    : undefined
  const room = new Room({
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: true,
    audioCaptureDefaults: audioOpts,
    videoCaptureDefaults: { deviceId: savedCam, resolution: (vqPreset ?? VideoPresets.h1080).resolution },
    publishDefaults: {
      dtx: true,
      red: true,
      audioPreset: { maxBitrate: media?.bitrateKbps ? media.bitrateKbps * 1000 : 256_000 },
      videoCodec: 'vp9',
      backupCodec: true,
      videoEncoding: vqPreset?.encoding ?? { maxBitrate: 8_000_000, maxFramerate: 30 },
      simulcast: true,
    },
    ...(e2eeOpts ? { e2ee: e2eeOpts } : {}),
  })
  if (e2eeOpts) {
    // Включаем ДО подключения: иначе первые пакеты успели бы уйти незашифрованными.
    await room.setE2EEEnabled(true)
  }
  attachKrisp(room, await lkPromise2)
  try {
    await room.connect(url, token)
  } catch (e) {
    // Кэшированный токен мог не подойти (комната пересоздана, сервер перезапущен) —
    // берём заведомо свежий и пробуем один раз ещё, не роняя вызов на кэше.
    tokenCache.delete(tokenKey)
    ;({ token, url } = await getToken(roomName, identity, name))
    await room.connect(url, token)
  }
  const rawMic = await micPromise
  // Прошлая цепочка (быстрый переход между каналами) — закрываем, иначе её
  // AudioContext и захваченный микрофон остались бы жить.
  releaseMicChain()
  curRoom = room
  curMic = rawMic
  // v1.409.0: с этой минуты плагин с разрешением voice меняет голос той же
  // дорогой, что и кнопка в звонке: applyVoiceEffect при необходимости
  // соберёт цепочку обработки и перепубликует дорожку. Раньше плагин звал
  // переключатель уже собранной цепочки — и, если человек не трогал эффекты
  // руками, не делал ровно ничего.
  setVoiceApplier(applyVoiceEffect)
  room.once(RoomEvent.Disconnected as any, releaseMicChain)
  const wantEffect = savedVoiceEffect()
  const chain = rawMic && (getSettings().micVol !== 100 || wantEffect !== 'none')
    ? buildChain(rawMic, wantEffect) : null
  if (chain) { curChain = chain; setActiveChain(chain) }
  const micTrack: any = chain?.track ?? rawMic
  if (micTrack) {
    try { await room.localParticipant.publishTrack(micTrack, { source: Track.Source.Microphone as any }) }
    catch { try { micTrack.stop?.() } catch {} ; releaseMicChain(); await enableMicWithRetry(room) }
  } else {
    // Параллельный захват не удался (устройство было занято/отказано) — пробуем
    // ещё раз тем же путём, что и раньше: до нескольких попыток с паузой.
    await enableMicWithRetry(room)
  }
  ;(room as any).__ponoiInit = true
  return room
}

// v1.152.0: пауза укорочена (500 -> 200мс), попыток больше (3 -> 4) — тот же
// запас надёжности, но заметно быстрее в типичном случае, когда устройство
// освобождается почти сразу.
async function enableMicWithRetry(room: Room) {
  for (let i = 0; i < 4; i++) {
    try { await room.localParticipant.setMicrophoneEnabled(true); return }
    catch { await new Promise(r => setTimeout(r, 200)) }
  }
}

// Room/LocalTrackPublication — только типы: если бы они реэкспортировались как
// значения, любой импортёр снова утянул бы за собой всю библиотеку в главный кусок.
export type { Room, LocalTrackPublication }

/** Список устройств ввода. Раньше CallRoom дёргал статический Room.getLocalDevices
 *  напрямую — из-за одного этого вызова класс Room должен был быть значением, а
 *  значит вся библиотека снова оказалась бы в главном куске. */
export async function getLocalDevices(kind: 'audioinput' | 'videoinput'): Promise<MediaDeviceInfo[]> {
  const lk = await loadLivekit()
  try { return await lk.Room.getLocalDevices(kind, true) } catch { return [] }
}
export { RoomEvent, Track, DisconnectReason } from './livekitConst'
