// Статистика онлайн-игр за 30 дней (v1.150.0): история завершённых матчей,
// сейчас — только CS2 (единственная игра, где GSI честно отдаёт финальный счёт,
// карту и режим). Другие игры добавятся, когда появится официальный источник
// таких данных — выдумывать счёт по логам не будем.
import { supabase } from './supabase'

export interface GameMatch {
  id: string
  user_id: string
  game_name: string
  score: string | null
  mode: string | null
  map: string | null
  result: 'win' | 'loss' | 'draw' | null
  created_at: string
  // v1.165.0: только CS2 — kills/deaths/assists/mvps из GSI player_match_stats.
  kills: number | null
  deaths: number | null
  assists: number | null
  mvps: number | null
}

// Игры, для которых есть источник статистики — локальный GSI (CS2) или внешний
// API по привязанному аккаунту (Dota 2 — OpenDota, см. src/lib/opendota.ts).
// Используется, чтобы решить, показывать ли «Статистика» по клику на активность.
export const MATCH_TRACKED_GAMES = new Set(['Counter-Strike 2', 'Dota 2'])

export async function saveMatch(userId: string, m: { game: string; mode?: string | null; map?: string | null; score?: string | null; result?: 'win' | 'loss' | 'draw' | null; kills?: number | null; deaths?: number | null; assists?: number | null; mvps?: number | null }): Promise<void> {
  const { error } = await supabase.from('game_matches').insert({
    user_id: userId, game_name: m.game, mode: m.mode ?? null, map: m.map ?? null, score: m.score ?? null, result: m.result ?? null,
    kills: m.kills ?? null, deaths: m.deaths ?? null, assists: m.assists ?? null, mvps: m.mvps ?? null,
  })
  if (error) throw error
}

export async function fetchMatches(userId: string, gameName: string, days = 30): Promise<GameMatch[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data } = await supabase.from('game_matches').select('*')
    .eq('user_id', userId).eq('game_name', gameName).gte('created_at', since)
    .order('created_at', { ascending: false })
  return (data as GameMatch[]) ?? []
}

export interface MatchStats {
  total: number
  wins: number
  losses: number
  draws: number
  winrate: number   // 0..100, только среди матчей с известным результатом
  byMap: { map: string; count: number; wins: number }[]
  byMode: { mode: string; count: number }[]
  // v1.165.0: K/D/A/MVP — только по матчам, где GSI их прислал (kills != null).
  hasKda: boolean
  avgKills: number
  avgDeaths: number
  avgAssists: number
  kd: number
  totalMvps: number
}

export function computeStats(matches: GameMatch[]): MatchStats {
  const decided = matches.filter(m => m.result === 'win' || m.result === 'loss')
  const wins = matches.filter(m => m.result === 'win').length
  const losses = matches.filter(m => m.result === 'loss').length
  const draws = matches.filter(m => m.result === 'draw').length
  const mapAgg = new Map<string, { count: number; wins: number }>()
  const modeAgg = new Map<string, number>()
  for (const m of matches) {
    const map = m.map || 'Неизвестно'
    const e = mapAgg.get(map) ?? { count: 0, wins: 0 }
    e.count++
    if (m.result === 'win') e.wins++
    mapAgg.set(map, e)
    const mode = m.mode || 'Неизвестно'
    modeAgg.set(mode, (modeAgg.get(mode) ?? 0) + 1)
  }
  const kdaMatches = matches.filter(m => m.kills != null && m.deaths != null)
  const totalKills = kdaMatches.reduce((s, m) => s + (m.kills ?? 0), 0)
  const totalDeaths = kdaMatches.reduce((s, m) => s + (m.deaths ?? 0), 0)
  const totalAssists = kdaMatches.reduce((s, m) => s + (m.assists ?? 0), 0)
  const totalMvps = matches.reduce((s, m) => s + (m.mvps ?? 0), 0)
  return {
    total: matches.length, wins, losses, draws,
    winrate: decided.length ? Math.round((wins / decided.length) * 100) : 0,
    byMap: [...mapAgg.entries()].map(([map, v]) => ({ map, ...v })).sort((a, b) => b.count - a.count),
    byMode: [...modeAgg.entries()].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count),
    hasKda: kdaMatches.length > 0,
    avgKills: kdaMatches.length ? totalKills / kdaMatches.length : 0,
    avgDeaths: kdaMatches.length ? totalDeaths / kdaMatches.length : 0,
    avgAssists: kdaMatches.length ? totalAssists / kdaMatches.length : 0,
    kd: totalDeaths ? totalKills / totalDeaths : totalKills,
    totalMvps,
  }
}
