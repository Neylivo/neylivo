// v1.373.0: приведение ссылки на трек к одному виду.
//
// Зачем. Одна и та же песня приезжает с разными хвостами: `?si=…` от кнопки
// «поделиться», `?utm_source=…` от рекламы, `&t=42` от «поделиться с этого
// места», `?in=…/sets/…` когда трек открыли из плейлиста. Для человека это одна
// песня, для строкового сравнения — четыре разные, и трекотека набивалась
// повторами одного и того же.
//
// Что убираем и что оставляем. Убираем то, что не меняет саму запись: трекинг и
// момент воспроизведения. Оставляем всё, что её определяет — в первую очередь
// `v=` у YouTube, без которого от ссылки не остаётся ничего.

/** Хвосты, которые ничего не говорят о самой песне. */
const JUNK = new Set([
  'si', 'in', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'feature', 'app', 'ref', 'referrer', 'context', 'igshid', 'fbclid', 'gclid',
  't', 'start', 'time_continue', 'pp', 'ab_channel', 'nd', 'ved', 'source',
])

/**
 * Одинаковые песни — одинаковые строки.
 *
 * Ссылку, которую не удалось разобрать (например, локальный файл), возвращаем
 * как есть: ломать то, чего не понимаем, хуже, чем оставить как было.
 */
export function normalizeTrackUrl(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return s
  let u: URL
  try { u = new URL(s) } catch { return s }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return s

  // Схема и домен — в нижний регистр, www. ни на что не влияет.
  u.protocol = 'https:'
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  u.hash = ''

  for (const k of [...u.searchParams.keys()]) {
    if (JUNK.has(k.toLowerCase())) u.searchParams.delete(k)
  }
  // Порядок оставшихся доводов не должен решать, одна это песня или две.
  u.searchParams.sort()

  // Хвостовая косая у страницы трека ничего не меняет.
  let out = u.toString()
  if (u.search === '') out = out.replace(/\/+$/, '')
  return out
}

/** Одна ли это песня. Сравниваем приведённые виды, а не исходные строки. */
export function sameTrack(a: string, b: string): boolean {
  return normalizeTrackUrl(a) === normalizeTrackUrl(b)
}
