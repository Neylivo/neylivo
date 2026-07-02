import { Room, RoomEvent, Track, LocalTrackPublication } from 'livekit-client'
import { supabase } from './supabase'

export async function joinRoom(roomName: string, identity: string, name: string): Promise<Room> {
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { room: roomName, identity, name },
  })
  if (error) throw error
  const { token, url } = data as { token: string; url: string }
  const room = new Room({ adaptiveStream: true, dynacast: true })
  await room.connect(url, token)
  return room
}

export { Room, RoomEvent, Track }
export type { LocalTrackPublication }
