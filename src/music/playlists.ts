// v1.428.0: плейлисты — по-настоящему.
//
// Что было. Плейлист умел ровно две вещи: заводиться (по названию, через окошко
// «введите название») и хранить список id. Ни открыть его отдельно, ни
// переименовать, ни убрать один трек, ни включить плейлист целиком было нельзя:
// в панели плеера рисовался плоский список названий, и щелчок по строке играл
// один трек из общего склада, а не плейлист.
//
// Здесь чистая часть: сами действия над плейлистами. Отдельным файлом — чтобы
// проверять их без браузера, как всё остальное в музыке: список, из которого
// молча пропадает трек или у которого сбивается порядок, человек заметит не
// сразу, а восстановить его будет нечем.
//
// Порядок треков внутри плейлиста — тот, в котором их добавляли, и он важен:
// плейлист для этого и нужен. Повторов нет: один трек в плейлисте один раз.

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  /** Когда создан, мс. По нему сортируется список: свежие сверху. */
  at?: number
}

export const PL_NAME_MAX = 60
/** Больше — это уже не плейлист, а второй склад; и такой список не открыть. */
export const PL_TRACKS_MAX = 500

/** Разобрать то, что лежит в настройках: там может быть что угодно из прошлых версий. */
export function normalizePlaylists(raw: unknown): Playlist[] {
  if (!Array.isArray(raw)) return []
  const out: Playlist[] = []
  for (const p of raw as any[]) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue
    const ids: string[] = Array.isArray(p.trackIds) ? p.trackIds.filter((x: any) => typeof x === 'string') as string[] : []
    out.push({
      id: p.id,
      name: p.name.slice(0, PL_NAME_MAX),
      trackIds: [...new Set(ids)].slice(0, PL_TRACKS_MAX),
      at: typeof p.at === 'number' ? p.at : undefined,
    })
  }
  return out
}

export const newPlaylistId = (): string => 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** Завести плейлист. Пустое имя — не плейлист, поэтому отказ. */
export function createPlaylist(list: Playlist[], name: string, firstTrack?: string): Playlist[] {
  const nm = name.trim().slice(0, PL_NAME_MAX)
  if (!nm) return list
  return [...list, { id: newPlaylistId(), name: nm, trackIds: firstTrack ? [firstTrack] : [], at: Date.now() }]
}

export function renamePlaylist(list: Playlist[], id: string, name: string): Playlist[] {
  const nm = name.trim().slice(0, PL_NAME_MAX)
  if (!nm) return list
  return list.map(p => (p.id === id ? { ...p, name: nm } : p))
}

export function removePlaylist(list: Playlist[], id: string): Playlist[] {
  return list.filter(p => p.id !== id)
}

/** Добавить трек в конец. Повтор не добавляется — и это не ошибка, просто нечего делать. */
export function addToPlaylist(list: Playlist[], id: string, trackId: string): Playlist[] {
  return list.map(p => {
    if (p.id !== id || p.trackIds.includes(trackId)) return p
    if (p.trackIds.length >= PL_TRACKS_MAX) return p
    return { ...p, trackIds: [...p.trackIds, trackId] }
  })
}

export function removeFromPlaylist(list: Playlist[], id: string, trackId: string): Playlist[] {
  return list.map(p => (p.id === id ? { ...p, trackIds: p.trackIds.filter(x => x !== trackId) } : p))
}

/**
 * Передвинуть трек внутри плейлиста на другое место.
 *
 * Нужно ровно для того, ради чего плейлисты и делают: порядок песен. Границы
 * приводим сами — вызывающему проще передать «на одну вверх», не думая о концах
 * списка.
 */
export function movePlaylistTrack(list: Playlist[], id: string, trackId: string, delta: number): Playlist[] {
  return list.map(p => {
    if (p.id !== id) return p
    const from = p.trackIds.indexOf(trackId)
    if (from < 0) return p
    const to = Math.max(0, Math.min(p.trackIds.length - 1, from + delta))
    if (to === from) return p
    const ids = [...p.trackIds]
    ids.splice(from, 1)
    ids.splice(to, 0, trackId)
    return { ...p, trackIds: ids }
  })
}

/** Свежие сверху; у старых записей времени нет — они идут после, в своём порядке. */
export function playlistsOrder(list: Playlist[]): Playlist[] {
  return [...list].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/**
 * Треки плейлиста в его порядке — только те, что ещё есть в складе.
 *
 * Трек могли убрать из Трекотеки, и тогда в плейлисте остаётся id, за которым
 * ничего нет. Прятать такие строки надо здесь, а не в разметке: иначе «включить
 * плейлист» попыталось бы играть пустоту.
 */
export function playlistTracks<T extends { id: string }>(p: Playlist, all: T[]): T[] {
  const by = new Map(all.map(t => [t.id, t]))
  const out: T[] = []
  for (const id of p.trackIds) {
    const t = by.get(id)
    if (t) out.push(t)
  }
  return out
}

/** Сколько треков плейлиста реально можно включить — это число и показываем. */
export function playlistSize(p: Playlist, all: { id: string }[]): number {
  return playlistTracks(p, all).length
}
