import { Room, RoomEvent, Track, LocalTrackPublication, VideoPresets, AudioPresets } from 'livekit-client'
import { supabase } from './supabase'

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
  await room.connect(url, token)
  return room
}

export { Room, RoomEvent, Track }
export type { LocalTrackPublication }
