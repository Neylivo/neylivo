// v1.551.0: «Любимые» треки.
//
// Владелец прислал макет Трекотеки: там есть плитка «Любимые» с числом треков.
// Раньше за ней не стояло ничего, и рисовать её я отказался — кнопка, которая
// молчит, хуже отсутствующей. Теперь стоит.
//
// ГДЕ ХРАНИТСЯ. В тех же личных настройках, что плейлисты и закреплённые
// диалоги (userPrefs): они уже ездят между устройствами и уже переживают
// переустановку. Заводить ради отметки отдельную таблицу — значит завести
// вторую точку отказа там, где есть работающая первая.
//
// ЧЕГО ЗДЕСЬ НЕТ: списка «кому нравится». Отметка ЛИЧНАЯ и видна только тому,
// кто её поставил. Трекотека общая, и «кто что слушает» из неё уже видно
// достаточно; превращать отметку в публичный счётчик — отдельное решение,
// которого никто не принимал.

/** Порядок в списке: сначала отмеченное позже. */
export interface Like { id: string; at: number }

/** Привести к порядку то, что приехало из настроек: там может лежать что угодно. */
export function normalizeLikes(raw: unknown): Like[] {
  if (!Array.isArray(raw)) return []
  const из: Like[] = []
  const было = new Set<string>()
  for (const x of raw) {
    // Старый вид — просто массив идентификаторов. Читаем и его: настройки
    // переживают версии приложения, и ронять их на смене формата нельзя.
    if (typeof x === 'string') {
      if (!x || было.has(x)) continue
      было.add(x)
      из.push({ id: x, at: 0 })
      continue
    }
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || было.has(o.id)) continue
    было.add(o.id)
    из.push({ id: o.id, at: typeof o.at === 'number' && isFinite(o.at) ? o.at : 0 })
  }
  return из
}

export function isLiked(list: Like[], id: string): boolean {
  return list.some(l => l.id === id)
}

/** Отметить или снять отметку. Возвращает НОВЫЙ список — старый не меняется. */
export function toggleLike(list: Like[], id: string, now = Date.now()): Like[] {
  if (!id) return list
  return isLiked(list, id) ? list.filter(l => l.id !== id) : [{ id, at: now }, ...list]
}

/** Сколько отмечено. Для подписи на плитке. */
export function likeCount(list: Like[]): number {
  return list.length
}

/**
 * Отмеченные треки в порядке «сначала недавние».
 *
 * Треки, которых уже нет в Трекотеке, из выдачи выпадают, но из настроек НЕ
 * удаляются: склад общий и подгружается частями, и трека может не быть просто
 * потому, что он ещё не приехал. Вычистить отметку из-за этого значило бы
 * потерять её молча.
 */
export function likedTracks<T extends { id: string }>(list: Like[], tracks: T[]): T[] {
  const порядок = new Map(list.map((l, i) => [l.id, i]))
  return tracks.filter(t => порядок.has(t.id))
    .sort((a, b) => (порядок.get(a.id) ?? 0) - (порядок.get(b.id) ?? 0))
}

/**
 * Треки по исполнителям.
 *
 * У трека есть автор, а альбома нет вовсе — поэтому в макете «Исполнители» есть,
 * а «Альбомы» не будет, пока альбомам неоткуда взяться.
 *
 * Пустое имя не превращается в «Неизвестный исполнитель» отдельной группой
 * молча: такой группой становится всё, у чего автор не проставлен, и человек
 * должен понимать, что это свалка, а не исполнитель с таким именем.
 */
export function byArtist<T extends { id: string; author?: string | null }>(
  tracks: T[],
): { artist: string; tracks: T[] }[] {
  const карта = new Map<string, T[]>()
  for (const t of tracks) {
    const имя = String(t.author || '').trim() || 'Без исполнителя'
    const было = карта.get(имя)
    if (было) было.push(t)
    else карта.set(имя, [t])
  }
  return [...карта.entries()]
    .map(([artist, list]) => ({ artist, tracks: list }))
    // Больше треков — выше; при равенстве по алфавиту, чтобы порядок не прыгал
    // от перезагрузки к перезагрузке.
    .sort((a, b) => b.tracks.length - a.tracks.length || a.artist.localeCompare(b.artist, 'ru'))
}
