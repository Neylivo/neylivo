import { Room, RoomEvent, Track, DisconnectReason, LocalTrackPublication, LocalAudioTrack, VideoPresets } from 'livekit-client'
import { supabase } from './supabase'

// v1.71.0: AI-шумоподавление Krisp — то же, что использует Discord: отсекает
// клавиатуру, вентиляторы, улицу и прочий фон, оставляя только голос.
// Вешается на локальную дорожку микрофона при её публикации; если Krisp
// недоступен (старый браузер / self-hosted LiveKit / пакет не установился при
// сборке) — тихо остаёмся на браузерном noiseSuppression, звонок работает как раньше.
// v1.150.0: импорт сделан динамическим — раньше это был статический import,
// и когда пакет однажды не резолвился (см. build_environment_issue), падал
// не только Krisp, а ВЕСЬ этот файл и, соответственно, все звонки целиком.
function attachKrisp(room: Room) {
  room.on(RoomEvent.LocalTrackPublished, async (pub: LocalTrackPublication) => {
    if (pub.source !== Track.Source.Microphone) return
    const track = pub.track
    if (!(track instanceof LocalAudioTrack)) return
    try {
      const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import('@livekit/krisp-noise-filter')
      if (!isKrispNoiseFilterSupported()) return
      await track.setProcessor(KrispNoiseFilter())
    } catch { /* пакет недоступен или процессор не завёлся — остаёмся на браузерном шумодаве */ }
  })
}

export async function joinRoom(roomName: string, identity: string, name: string): Promise<Room> {
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { room: roomName, identity, name },
  })
  if (error) throw error
  const { token, url } = data as { token: string; url: string }
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
  const room = new Room({
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: true,
    audioCaptureDefaults: { deviceId: savedMic, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    videoCaptureDefaults: { deviceId: savedCam, resolution: VideoPresets.h1080.resolution },
    publishDefaults: {
      dtx: true,
      red: true,
      audioPreset: { maxBitrate: 256_000 },
      videoCodec: 'vp9',
      backupCodec: true,
      videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 30 },
      simulcast: true,
    },
  })
  attachKrisp(room)
  await room.connect(url, token)
  // v1.113.0: микрофон включается сразу при входе в звонок. Раньше это делал каждый
  // экран сам, и любой сбой (занятое устройство, медленный ответ на разрешение)
  // тихо оставлял микрофон выключенным. Теперь — до трёх попыток с паузой.
  for (let i = 0; i < 3; i++) {
    try { await room.localParticipant.setMicrophoneEnabled(true); break }
    catch { await new Promise(r => setTimeout(r, 500)) }
  }
  ;(room as any).__ponoiInit = true
  return room
}

export { Room, RoomEvent, Track, DisconnectReason }
export type { LocalTrackPublication }
