
// Shared music library ("Трекотека"): one `music_tracks` table everyone reads,
// and anyone signed-in can add to. Backed by Supabase + realtime so new tracks
// appear for all listeners immediately. Метаданные (автор/обложка/длительность/
// play-URL) хранятся в базе (22_music_meta.sql) — видны всем и навсегда.
import { supabase } from './supabase'
import { normalizeTrackUrl } from '../music/trackUrl'
// Правило «это повтор» живёт отдельно, без зависимостей — его проверяет тест.
export { isDuplicateTrack } from './musicDupe'
import { metaPatch, type TrackMeta } from './musicMeta'
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

let warnedNoMeta = false
function warnNoMusicMeta() {
  if (warnedNoMeta) return
  warnedNoMeta = true
  // Через событие, а не импортом тостов: этот модуль зовут и из мест без интерфейса.
  try {
    window.dispatchEvent(new CustomEvent('ponoi-music-nometa'))
  } catch { /* не браузер — молча */ }
}



export async function addTrack(t: NewTrack) {
  // Полная запись с метаданными (нужна миграция 22_music_meta.sql). Если колонок
  // ещё нет — тихо откатываемся на старый формат, чтобы ничего не сломать.
  // v1.373.0: адрес приводим к одному виду здесь, а не на каждом из четырёх
  // путей добавления: мимо этой функции в таблицу ничего не попадает, и забыть
  // тут невозможно — в отличие от «не забыть вызвать перед каждым insert».
  const url = normalizeTrackUrl(t.url)
  const full = {
    url, name: t.name, owner: t.ownerId, owner_name: t.ownerName, kind: t.kind,
    author: t.author || null, art: t.art ?? null,
    duration: typeof t.dur === 'number' && t.dur > 0 ? Math.round(t.dur) : null,
    play_url: t.play ?? null,
  }
  let r = await supabase.from('music_tracks').insert(full).select().single()
  if (r.error && (r.error.code === 'PGRST204' || r.error.code === '42703' || /column/i.test(r.error.message || ''))) {
    r = await supabase.from('music_tracks')
      .insert({ url, name: t.name, owner: t.ownerId, owner_name: t.ownerName, kind: t.kind })
      .select().single()
    // v1.369.0: раньше этот откат был совсем молчаливым, и человек не мог понять,
    // почему обложка каждый раз пропадает: колонок под неё в базе просто нет, и
    // она живёт только в кэше этого браузера. Говорим прямо один раз.
    warnNoMusicMeta()
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
/**
 * Дозапись метаданных трека (v1.369.0 — переписано).
 *
 * Что было не так. Обновление писало ВСЕ три поля разом, подставляя null там,
 * где нового значения не было. А зовут его в том числе ради одной обложки — и
 * тогда вместе с ней в базу уезжали `author: null` и `play_url: null`, стирая
 * рабочую ссылку воспроизведения, добытую раньше. Трек с виду обновлялся, а на
 * деле переставал играть: обложка появилась, звук пропал.
 *
 * Теперь пишем только то, что реально узнали. Нечего писать — запроса нет вовсе.
 */
export async function updateTrackMeta(id: string, m: TrackMeta) {
  const patch = metaPatch(m)
  if (Object.keys(patch).length === 0) return
  try {
    await supabase.from('music_tracks').update(patch).eq('id', id)
  } catch { /* колонок нет — см. предупреждение в addTrack */ }
}

// Правило дозаписи живёт отдельно, без зависимостей — его проверяет npm run test:ui.
export { metaPatch } from './musicMeta'
