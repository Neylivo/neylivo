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
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    videoCaptureDefaults: { resolution: VideoPresets.h1080.resolution },
    publishDefaults: {
      dtx: true,
      red: true,
      audioPreset: AudioPresets.musicHighQualityStereo,
      videoEncoding: { maxBitrate: 3_500_000, maxFramerate: 30 },
      simulcast: true,
    },
  })
  attachKrisp(room)
  await room.connect(url, token)
  return room
}

export { Room, RoomEvent, Track }
export type { LocalTrackPublication }
