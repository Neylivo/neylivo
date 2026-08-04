// v1.460.0: плеер помнит, на чём остановился.
//
// Что было. Закрыл приложение — и плеер открывался пустым: ни трека, ни места в
// нём. Человек, слушавший альбом или длинную запись, каждый раз начинал заново и
// сам искал, где остановился. Громкость при этом помнилась, а сам сеанс — нет.
//
// Что помним: какой трек играл, на какой секунде и чем он был занят из очереди.
// Сколько именно — важно: восстанавливать позицию имеет смысл только если она
// заметная, иначе после случайного открытия трек «продолжится» с третьей секунды
// и это выглядит как поломка.
//
// Чего НЕ делаем: не включаем воспроизведение само. Приложение, начинающее
// играть без спроса при запуске, — это то, за что выключают звук навсегда.
// Восстанавливаем ПАУЗУ на нужном месте: нажми — и продолжится.
//
// Проверки: src/music/__music_test.ts (npm run test:music).

export interface Session {
  /** id трека в складе. */
  id: string
  /** Ссылка — по ней трек находится, даже если id поменялся. */
  url: string
  /** Секунда, на которой остановились. */
  pos: number
  /** Когда сохраняли (мс). */
  at: number
}

const KEY = 'ponoi_mus_session_v1'

/** Позицию меньше этой не запоминаем: трек только начался. */
export const MIN_POS = 20
/** И ближе этого к концу — тоже: он практически дослушан, продолжать нечего. */
export const TAIL = 15
/** Старше этого сеанс не восстанавливаем: слушали неделю назад, это уже не
 *  «продолжить», а «внезапно включилось что-то забытое». */
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000

/** Стоит ли вообще запоминать эту позицию. */
export function worthSaving(pos: number, dur: number): boolean {
  if (!Number.isFinite(pos) || pos < MIN_POS) return false
  if (dur > 0 && pos > dur - TAIL) return false
  return true
}

export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* приватный режим */ }
}

export function clearSession() {
  try { localStorage.removeItem(KEY) } catch { /* неважно */ }
}

/** Что было в прошлый раз. null — нечего или слишком давно. */
export function loadSession(now = Date.now()): Session | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw.url !== 'string' || !raw.url) return null
    const at = Number(raw.at) || 0
    if (!at || now - at > MAX_AGE_MS) return null
    return { id: String(raw.id ?? ''), url: raw.url, pos: Math.max(0, Number(raw.pos) || 0), at }
  } catch { return null }
}

/**
 * Какой трек из склада продолжить. Ищем сперва по ссылке, потом по id: ссылка
 * переживает пересборку склада, а id — нет.
 */
export function findTrack<T extends { id: string; url: string }>(s: Session | null, tracks: readonly T[]): number {
  if (!s) return -1
  const byUrl = tracks.findIndex(t => t.url === s.url)
  if (byUrl >= 0) return byUrl
  return s.id ? tracks.findIndex(t => t.id === s.id) : -1
}
