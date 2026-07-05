import { Room, RoomEvent, Track, LocalTrackPublication, LocalAudioTrack, VideoPresets, AudioPresets } from 'livekit-client'
import { KrispNoiseFilter, isKrispNoiseFilterSupported } from '@livekit/krisp-noise-filter'
import { supabase } from './supabase'

// v1.71.0: AI-шумоподавление Krisp — то же, что использует Discord: отсекает
// клавиатуру, вентиляторы, улицу и прочий фон, оставляя только голос.
// Вешается на локальную дорожку микрофона при её публикации; если Krisp
// недоступен (старый браузер / self-hosted LiveKit) — тихо остаёмся на
// браузерном noiseSuppression, звонок работает как раньше.
function attachKrisp(room: Room) {
  room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
    if (pub.source !== Track.Source.Microphone) return
    const track = pub.track
    if (!(track instanceof LocalAudioTrack)) return
    if (!isKrispNoiseFilterSupported()) return
    track.setProcessor(KrispNoiseFilter()).catch(() => { /* fallback: браузерный шумодав */ })
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
  const room = new Room({
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    videoCaptureDefaults: { resolution: VideoPresets.h1080.resolution },
    publishDefaults: {
      dtx: true,
      red: true,
      audioPreset: AudioPresets.musicHighQualityStereo,
      videoCodec: 'vp9',
      backupCodec: true,
      videoEncoding: { maxBitrate: 4_500_000, maxFramerate: 30 },
      simulcast: true,
    },
  })
  attachKrisp(room)
  await room.connect(url, token)
  return room
}

export { Room, RoomEvent, Track }
export type { LocalTrackPublication }
