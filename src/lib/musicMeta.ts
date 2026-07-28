// v1.369.0: какие поля трека уходят в базу при дозаписи.
//
// Отдельным файлом без зависимостей — это правило, а не запрос: от него зависит,
// не сотрёт ли обновление обложки рабочую ссылку воспроизведения. Раньше стирало:
// писались все три поля разом, и там, где нового значения не было, уезжал null.
// Трек с виду обновлялся, а на деле переставал играть.

export interface TrackMeta { author?: string; art?: string | null; play?: string | null; dur?: number }

/** Только то, что реально узнали. Пусто — значит запроса быть не должно вовсе. */
export function metaPatch(m: TrackMeta): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (m.author) patch.author = m.author
  if (m.art) patch.art = m.art
  if (m.play) patch.play_url = m.play
  if (typeof m.dur === 'number' && m.dur > 0) patch.duration = Math.round(m.dur)
  return patch
}
