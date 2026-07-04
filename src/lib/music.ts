
// Shared music library ("Трекотека"): one `music_tracks` table everyone reads,
// and anyone signed-in can add to. Backed by Supabase + realtime so new tracks
// appear for all listeners immediately. Метаданные (автор/обложка/длительность/
// play-URL) хранятся в базе (22_music_meta.sql) — видны всем и навсегда.
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
    author: (r.author ?? undefined) as string | undefined,
    art: (r.art ?? null) as string | null,
    dur: typeof r.duration === 'number' && r.duration > 0 ? r.duration : undefined,
    play: (r.play_url ?? null) as string | null,
  }))
}

export interface NewTrack {
  url: string; name: string; ownerId: string; ownerName: string; kind: 'url' | 'file'
  author?: string; art?: string | null; dur?: number; play?: string | null
}

export async function addTrack(t: NewTrack) {
  // Полная запись с метаданными (нужна миграция 22_music_meta.sql). Если колонок
  // ещё нет — тихо откатываемся на старый формат, чтобы ничего не сломать.
  const full = {
    url: t.url, name: t.name, owner: t.ownerId, owner_name: t.ownerName, kind: t.kind,
    author: t.author || null, art: t.art ?? null,
    duration: typeof t.dur === 'number' && t.dur > 0 ? Math.round(t.dur) : null,
    play_url: t.play ?? null,
  }
  let r = await supabase.from('music_tracks').insert(full).select().single()
  if (r.error && (r.error.code === 'PGRST204' || r.error.code === '42703' || /column/i.test(r.error.message || ''))) {
    r = await supabase.from('music_tracks')
      .insert({ url: t.url, name: t.name, owner: t.ownerId, owner_name: t.ownerName, kind: t.kind })
      .select().single()
  }
  return r
}

export async function removeTrackDb(id: string) {
  return supabase.from('music_tracks').delete().eq('id', id)
}
