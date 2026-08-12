
import { supabase } from './supabase'
import { sessionMs } from './sessionTime'
import { aggregateSessions, type RecentGame, type SessionRow } from './activityStats'
export { aggregateSessions } from './activityStats'
export type { RecentGame, SessionRow } from './activityStats'

// История игровых сессий (миграция 14): пишем старт/конец своей игры,
// читаем агрегат за 7 дней для вкладки «История активностей» в фулл-профиле.

/**
 * Скрыт ли «был в сети» (v1.378.0).
 *
 * Читаем настройку напрямую: этот модуль зовут из мест без провайдера настроек,
 * а флаг нужен ровно один.
 */
function hiddenLastSeen(): boolean {
  try { return !!JSON.parse(localStorage.getItem('ponoi_settings') || '{}').hideLastSeen } catch { return false }
}

export async function startSession(userId: string, name: string, since: number): Promise<string | null> {
  // v1.378.0: «скрывать был в сети» останавливало отметку last_seen, но историю
  // игровых сессий писало по-прежнему — а по ней видно ровно то же самое и даже
  // подробнее: когда человек был за компьютером и во что играл. Читать её может
  // любой вошедший. Настройка обещала одно, а данные утекали через соседнюю дверь.
  if (hiddenLastSeen()) return null
  try {
    const { data } = await supabase.from('activity_sessions')
      .insert({ user_id: userId, kind: 'game', name, started_at: new Date(since).toISOString() })
      .select('id').single()
    return (data as any)?.id ?? null
  } catch { return null }
}

export async function endSession(id: string) {
  try { await supabase.from('activity_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id) } catch {}
}

export interface GameStat { name: string; totalMs: number; sessions: number; last: number }

// Статистика за неделю: сумма часов по каждой игре. Открытая сессия считается
// «до текущего момента», но каждая сессия ограничена 8 часами (защита от
// зависших записей, если приложение убили и ended_at не записался).
export async function weekStats(userId: string): Promise<GameStat[]> {
  try {
    const from = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('activity_sessions').select('name, started_at, ended_at')
      .eq('user_id', userId).gte('started_at', from)
      .order('started_at', { ascending: false }).limit(300)
    const by: Record<string, GameStat> = {}
    for (const r of (data ?? []) as any[]) {
      const s = new Date(r.started_at).getTime()
      const st = by[r.name] ?? (by[r.name] = { name: r.name, totalMs: 0, sessions: 0, last: 0 })
      st.totalMs += sessionMs(r.started_at, r.ended_at)
      st.sessions++
      st.last = Math.max(st.last, s)
    }
    return Object.values(by).sort((a, b) => b.totalMs - a.totalMs)
  } catch { return [] }
}


// «Недавняя активность» за 30 дней (окно выборки 90 дней — чтобы честно посчитать
// стрик, «Нового игрока» и «Снова в деле спустя N мес.»). Формат 1-в-1 как в Discord.
export async function recentActivity(userId: string): Promise<RecentGame[]> {
  try {
    const from = new Date(Date.now() - 90 * 86400000).toISOString()
    // v1.463.0: было ascending: true с тем же limit 500 — то есть из девяноста
    // дней брались САМЫЕ СТАРЫЕ пятьсот сессий. У того, кто играет часто, всё
    // недавнее в них просто не попадало, и «Недавняя активность» показывала
    // старьё или пустоту. Ровно это владелец и принёс как «немного сломана».
    const { data } = await supabase.from('activity_sessions').select('name, started_at, ended_at')
      .eq('user_id', userId).gte('started_at', from)
      .order('started_at', { ascending: false }).limit(500)
    return aggregateSessions((data ?? []) as SessionRow[])
  } catch { return [] }
}


// Каталог игр для пикера «Любимая игра» (v1.162.0, как в Discord) — реально
// сыгранные на NeyLivo игры, отсортированы по числу разных игроков. Пустой
// запрос — топ популярных, иначе поиск по подстроке (server-side, миграция 38).
export interface CatalogGame { name: string; players: number; lastPlayed: number }

export async function fetchGameCatalog(query?: string, limit = 60): Promise<CatalogGame[]> {
  try {
    const { data, error } = await supabase.rpc('game_catalog', { p_query: query?.trim() || null, p_limit: limit })
    if (error || !data) return []
    return (data as any[]).map(r => ({ name: r.name, players: Number(r.players), lastPlayed: new Date(r.last_played).getTime() }))
  } catch { return [] }
}

// «Популярное»: игрой за последние 2 недели занимались ≥2 разных человек.
export async function popularGames(names: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!names.length) return out
  try {
    const from = new Date(Date.now() - 14 * 86400000).toISOString()
    const { data } = await supabase.from('activity_sessions').select('name, user_id')
      .in('name', names).gte('started_at', from).limit(1000)
    const by: Record<string, Set<string>> = {}
    for (const r of (data ?? []) as any[]) (by[r.name] ?? (by[r.name] = new Set())).add(r.user_id)
    for (const n of Object.keys(by)) if (by[n].size >= 2) out.add(n)
  } catch {}
  return out
}

// Правило длительности живёт отдельным файлом без зависимостей: его проверяет
// npm run test:ui, а туда нельзя тянуть модуль, которому нужен настроенный сервер.
export { sessionMs } from './sessionTime'
