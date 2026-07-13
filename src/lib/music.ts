
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
  // v1.274.0: .select('id') — без него вызывающая сторона (MusicPlayer.tsx) не
  // может отличить «правда удалено» от «RLS молча отклонил» и убирала трек из
  // локального списка в любом случае (он потом «сам возвращался» у всех).
  return supabase.from('music_tracks').delete().eq('id', id).select('id')
}

/** Дозапись метаданных трека (v1.79.0): если чей-то клиент смог получить
 *  обложку/автора/play-URL — сохраняем в базу, чтобы видели все и навсегда.
 *  Ошибки (нет колонок из 22_music_meta.sql, нет прав) молча игнорируем. */
export async function updateTrackMeta(id: string, m: { author?: string; art?: string | null; play?: string | null }) {
  try {
    await supabase.from('music_tracks').update({
      author: m.author || null, art: m.art ?? null, play_url: m.play ?? null,
    }).eq('id', id)
  } catch {}
}
