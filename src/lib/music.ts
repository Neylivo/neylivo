
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

/**
 * Строка базы — в трек. Отдельно и наружу (v1.420.0), потому что теперь ровно
 * те же поля приходят три разными путями: страницей склада, ответом на
 * добавление и живым событием о чужом треке. Три разных разбора одного и того
 * же — это три места, где однажды разойдутся поля.
 */
export function rowToTrack(r: any): Track {
  return {
    id: r.id as string,
    url: r.url as string,
    name: r.name as string,
    owner: (r.owner_name || r.owner) as string,
    // owner — как подписать («файл · Вася»), ownerId — кто это на самом деле.
    ownerId: r.owner as string,
    kind: (r.kind as 'url' | 'file'),
    author: (r.author ?? undefined) as string | undefined,
    art: (r.art ?? null) as string | null,
    dur: typeof r.duration === 'number' && r.duration > 0 ? r.duration : undefined,
    play: (r.play_url ?? null) as string | null,
    at: (r.created_at ?? undefined) as string | undefined,
    /**
     * Сколько раз трек слушали все (v1.424.0).
     *
     * Колонка `plays` в базе есть с v1.377.0 и всё это время НЕ ЧИТАЛАСЬ здесь
     * вовсе. Последствий было два, и оба видны человеку:
     *   • число на карточке показывало только то, что он послушал сам в этой
     *     сессии, — у всех остальных треков стояло пусто;
     *   • склад «сначала то, что слушают чаще всего» (libraryOrder, v1.406.0)
     *     сортировал по нулям, то есть остался обычным списком по времени
     *     добавления. Ровно тот случай, когда возможность объявлена, а её нет.
     */
    plays: typeof r.plays === 'number' && r.plays > 0 ? r.plays : 0,
  }
}

/**
 * Сколько треков забирается за один заход (v1.420.0).
 *
 * Раньше страница была в тысячу строк и склад выкачивался ЦЕЛИКОМ, прежде чем
 * человек видел хоть что-нибудь: на нескольких тысячах треков это несколько
 * запросов подряд и заметное ожидание перед первой песней, причём каждый раз.
 * Меньшая страница приезжает быстро, показывается сразу, а остальное
 * догружается следом и незаметно.
 */
export const TRACKS_PAGE = 300

/** Одна страница склада. done — дальше ничего нет. */
export async function fetchTracksPage(from: number, size = TRACKS_PAGE): Promise<{ tracks: Track[]; done: boolean }> {
  const { data, error } = await supabase.from('music_tracks').select('*')
    .order('created_at').range(from, from + size - 1)
  if (error) return { tracks: [], done: true }
  const rows = (data ?? []) as any[]
  // Пришло меньше страницы — значит, это была последняя.
  return { tracks: rows.map(rowToTrack), done: rows.length < size }
}

/**
 * Сколько всего треков в складе (v1.435.0).
 *
 * Один дешёвый запрос: `head: true` означает, что строки не передаются вовсе,
 * приходит только число. По нему решается, можно ли доверять снимку на
 * устройстве (см. music/libCache.ts) — совпало, значит ни добавлений, ни
 * удалений не было.
 */
export async function tracksCount(): Promise<number | null> {
  try {
    const { count, error } = await supabase.from('music_tracks').select('id', { count: 'exact', head: true })
    if (error || typeof count !== 'number') return null
    return count
  } catch { return null }
}

/**
 * Треки, добавленные после указанного момента (v1.420.0).
 *
 * Нужны на случай, когда живая подписка молчала: вкладку свернули, сеть
 * отвалилась, канал не поднялся. Дешёвый способ догнать — спросить только
 * новое, а не выкачивать склад заново.
 */
export async function fetchTracksAfter(sinceIso: string, limit = TRACKS_PAGE): Promise<Track[]> {
  const { data, error } = await supabase.from('music_tracks').select('*')
    .gt('created_at', sinceIso).order('created_at').limit(limit)
  if (error) return []
  return ((data ?? []) as any[]).map(rowToTrack)
}

/**
 * Весь склад целиком. Осталось для мест, где иначе нельзя, но начальную
 * загрузку плеер делает страницами (см. fetchTracksPage): выкачивать тысячи
 * строк ради того, чтобы показать первую песню, незачем.
 *
 * v1.418.0: база отдаёт за один запрос не больше тысячи строк — это её
 * собственный потолок, и молчаливый: тысяча первая песня просто не приезжала.
 */
export async function fetchTracks(): Promise<Track[]> {
  const all: Track[] = []
  for (let from = 0; ; from += 1000) {
    const { tracks, done } = await fetchTracksPage(from, 1000)
    all.push(...tracks)
    if (done) break
    // Предохранитель от бесконечного круга, если база вдруг отдаёт одно и то же.
    if (from > 100_000) break
  }
  return all
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

/**
 * Отметить прослушивание (v1.377.0).
 *
 * Считаем и общее число, и личное: общее показывается на карточке, личное
 * решает, что поставить в очередь. Тихо ничего не делает, если миграция ещё не
 * применена — плеер из-за счётчика останавливаться не должен.
 */
export async function recordPlay(trackId: string): Promise<void> {
  try { await supabase.rpc('record_play', { p_track: trackId }) } catch { /* нет функции — не беда */ }
}

/** Сколько раз я слушал каждый трек: id -> число. Для очереди «под себя». */
export async function myPlayCounts(): Promise<Record<string, number>> {
  try {
    const { data } = await supabase.from('music_plays').select('track_id, plays')
    const out: Record<string, number> = {}
    for (const r of (data ?? []) as any[]) out[r.track_id] = r.plays ?? 0
    return out
  } catch { return {} }
}
