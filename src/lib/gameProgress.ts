// v1.482.0: «Прохождения» — что человек играл и где остановился.
//
// Зачем. Владелец попросил отслеживание прогресса, «как у WeMod»: приложение
// само смотрит файлы и говорит, во что ты играешь, — а не просит заводить игры
// руками. Раньше в NeyLivo было только про ЗАПУЩЕННУЮ игру: закрыл — и ничего.
//
// Как устроено. Обход диска делает настольная часть (electron/gameScan.cjs) —
// у окна доступа к файлам нет и не должно быть. Здесь — то, что можно и нужно
// проверять без файлов: как сложить прочитанное в понятный человеку вид, что
// считать «заброшенным», как не потерять игру, которую убрали с диска.
//
// ПРИВАТНОСТЬ. Список живёт на этом устройстве. Наружу он не уходит ни строкой,
// пока человек сам не поделится игрой — для этого в приложении есть отдельная
// кнопка, и она отправляет ОДНУ игру, а не весь список.
//
// Проверки: npm run test:ui (эти функции) и npm run test:games (разбор файлов).

export interface ScannedGame {
  appId: string
  name: string
  dir: string | null
  sizeBytes: number
  /** Сколько минут наиграно по данным Steam. 0 — неизвестно. */
  minutes: number
  hours: string
  /** Когда последний раз запускали, мс. 0 — ни разу. */
  lastPlayed: number
  saves: { dir: string; count: number; last: number } | null
  milestones?: { done: number; total: number }
  source: string
}

export interface ScanResult {
  games: ScannedGame[]
  libraries: string[]
  checkedAt?: number
  error?: string
}

/** Что показывать в строке про эту игру. */
export type GameState = 'играю' | 'отложил' | 'забросил' | 'не начинал'

const ДЕНЬ = 24 * 60 * 60 * 1000

/**
 * В каком состоянии прохождение.
 *
 * Правило простое и честное: судим по времени последнего запуска, а не по
 * содержимому сохранений — их формат у каждой игры свой, и «глава 4 из 12»
 * взять неоткуда. Придумывать сюжетный прогресс, которого не знаешь, нельзя:
 * человек поверит цифре, а она будет выдумкой.
 */
export function gameState(g: Pick<ScannedGame, 'lastPlayed' | 'minutes'>, now = Date.now()): GameState {
  if (!g.lastPlayed && !g.minutes) return 'не начинал'
  if (!g.lastPlayed) return 'отложил'
  const дней = (now - g.lastPlayed) / ДЕНЬ
  if (дней <= 7) return 'играю'
  if (дней <= 60) return 'отложил'
  return 'забросил'
}

/** Человеческая давность: «сегодня», «3 дня назад», «в марте». */
export function agoLabel(ts: number, now = Date.now()): string {
  if (!ts) return 'ни разу'
  const d = Math.floor((now - ts) / ДЕНЬ)
  if (d <= 0) return 'сегодня'
  if (d === 1) return 'вчера'
  if (d < 7) return d + ' дн. назад'
  if (d < 31) return Math.floor(d / 7) + ' нед. назад'
  if (d < 365) return Math.floor(d / 30) + ' мес. назад'
  const л = Math.floor(d / 365)
  return л === 1 ? 'год назад' : л + ' г. назад'
}

/** Сколько процентов вех пройдено. null — вех у игры нет. */
export function milestonePercent(m?: { done: number; total: number }): number | null {
  if (!m || !m.total) return null
  return Math.min(100, Math.round((m.done / m.total) * 100))
}

/**
 * Порядок в списке: сначала то, во что играют сейчас, потом отложенное, потом
 * заброшенное. Внутри — по времени последнего запуска.
 *
 * Не по часам: игра, в которую наиграно двести часов год назад, человеку
 * сейчас не интересна, а вчерашняя двухчасовая — интересна.
 */
export function sortGames(games: ScannedGame[], now = Date.now()): ScannedGame[] {
  const вес: Record<GameState, number> = { 'играю': 0, 'отложил': 1, 'забросил': 2, 'не начинал': 3 }
  return [...games].sort((a, b) =>
    вес[gameState(a, now)] - вес[gameState(b, now)]
    || b.lastPlayed - a.lastPlayed
    || b.minutes - a.minutes)
}

/**
 * Слить новый обход со старым.
 *
 * Игра, которую сняли с диска, из списка НЕ пропадает: прохождение остаётся
 * прохождением, даже если игру удалили, — иначе история стиралась бы сама
 * собой. Такие помечаются gone, и человек решает сам.
 */
export function mergeScans(было: ScannedGame[], стало: ScannedGame[]): (ScannedGame & { gone?: boolean })[] {
  const карта = new Map(стало.map(g => [g.appId, g]))
  const out: (ScannedGame & { gone?: boolean })[] = стало.map(g => ({ ...g }))
  for (const g of было) {
    if (карта.has(g.appId)) continue
    out.push({ ...g, gone: true })
  }
  return out
}

// ── Хранение на устройстве ──────────────────────────────────────────────────

const КЛЮЧ = 'ponoi_games_scan_v1'

export function loadScan(): ScannedGame[] {
  try {
    const v = JSON.parse(localStorage.getItem(КЛЮЧ) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

export function saveScan(games: ScannedGame[]) {
  try { localStorage.setItem(КЛЮЧ, JSON.stringify(games.slice(0, 500))) } catch { /* переполнено */ }
}

/** Есть ли вообще настольная часть: на вебе и телефоне файлов не видно. */
export function canScan(): boolean {
  return typeof (window as any)?.neylivoDesktop?.scanGames === 'function'
}

/** Спросить настольную часть и запомнить ответ. */
export async function scanNow(): Promise<{ games: (ScannedGame & { gone?: boolean })[]; error?: string }> {
  const d = (window as any)?.neylivoDesktop
  if (!d?.scanGames) return { games: loadScan(), error: 'Только в приложении на компьютере: в браузере файлов не видно.' }
  const r: ScanResult = await d.scanGames()
  if (r?.error) return { games: loadScan(), error: r.error }
  const слито = mergeScans(loadScan(), r.games ?? [])
  saveScan(слито)
  return { games: слито }
}
