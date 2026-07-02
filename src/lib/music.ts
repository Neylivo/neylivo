// Shared music library ("Трекотека"): one `music_tracks` table everyone reads,
// and anyone signed-in can add to. Backed by Supabase + realtime so new tracks
// appear for all listeners immediately.
import { supabase } from './supabase'
import type { Track } from '../music/types'

export async function fetchTracks(): Promise<Track[]> {
  const { data } = await supabase.from('music_tracks').select('*').order('created_at')
  return ((data ?? []) as any[]).map(r => ({
    id: r.id as string,
    url: r.url as string,
    name: r.name as string,
    owner: (r.owner_name || r.owner) as string,
    kind: (r.kind as 'url' | 'file'),
  }))
}

export async function addTrack(t: { url: string; name: string; ownerId: string; ownerName: string; kind: 'url' | 'file' }) {
  return supabase.from('music_tracks')
    .insert({ url: t.url, name: t.name, owner: t.ownerId, owner_name: t.ownerName, kind: t.kind })
    .select().single()
}

export async function removeTrackDb(id: string) {
  return supabase.from('music_tracks').delete().eq('id', id)
}