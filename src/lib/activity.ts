
import { supabase } from './supabase'

// История игровых сессий (миграция 14): пишем старт/конец своей игры,
// читаем агрегат за 7 дней для вкладки «История активностей» в фулл-профиле.

export async function startSession(userId: string, name: string, since: number): Promise<string | null> {
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
      const e = r.ended_at ? new Date(r.ended_at).getTime() : Date.now()
      const st = by[r.name] ?? (by[r.name] = { name: r.name, totalMs: 0, sessions: 0, last: 0 })
      st.totalMs += Math.min(Math.max(0, e - s), 8 * 3600000)
      st.sessions++
      st.last = Math.max(st.last, s)
    }
    return Object.values(by).sort((a, b) => b.totalMs - a.totalMs)
  } catch { return [] }
}


// «Недавняя активность» за 30 дней (окно выборки 90 дней — чтобы честно посчитать
// стрик, «Нового игрока» и «Снова в деле спустя N мес.»). Формат 1-в-1 как в Discord.
export interface RecentGame {
  name: string
  last: number        // старт последней сессии
  totalMs: number
  sessions: number
  streak: number      // дней подряд, заканчивая днём последней сессии
  longestMs: number   // самая длинная сессия
  gapDays: number     // пауза перед последней сессией (для «Снова в деле…»)
  isNew: boolean      // самая первая сессия игры была в последние 14 дней
}

export async function recentActivity(userId: string): Promise<RecentGame[]> {
  try {
    const from = new Date(Date.now() - 90 * 86400000).toISOString()
    const { data } = await supabase.from('activity_sessions').select('name, started_at, ended_at')
      .eq('user_id', userId).gte('started_at', from)
      .order('started_at', { ascending: true }).limit(500)
    const by: Record<string, { s: number; e: number }[]> = {}
    for (const r of (data ?? []) as any[]) {
      const s = new Date(r.started_at).getTime()
      const e = r.ended_at ? new Date(r.ended_at).getTime() : Date.now()
      ;(by[r.name] ?? (by[r.name] = [])).push({ s, e })
    }
    const out: RecentGame[] = []
    const cutoff30 = Date.now() - 30 * 86400000
    for (const name of Object.keys(by)) {
      const rows = by[name]
      const last = rows[rows.length - 1]
      if (last.s < cutoff30) continue   // показываем только то, во что играли за 30 дней
      const days = new Set(rows.map(r => Math.floor(r.s / 86400000)))
      let streak = 1
      const lastDay = Math.floor(last.s / 86400000)
      while (days.has(lastDay - streak)) streak++
      const prev = rows.length > 1 ? rows[rows.length - 2] : null
      const dur = (r: { s: number; e: number }) => Math.min(Math.max(0, r.e - r.s), 8 * 3600000)
      out.push({
        name,
        last: last.s,
        totalMs: rows.reduce((a, r) => a + dur(r), 0),
        sessions: rows.length,
        streak,
        longestMs: Math.max(...rows.map(dur)),
        gapDays: prev ? Math.floor((last.s - prev.e) / 86400000) : 0,
        isNew: rows[0].s > Date.now() - 14 * 86400000,
      })
    }
    return out.sort((a, b) => b.last - a.last)
  } catch { return [] }
}

// Каталог игр для пикера «Любимая игра» (v1.162.0, как в Discord) — реально
// сыгранные на Ponoi игры, отсортированы по числу разных игроков. Пустой
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
