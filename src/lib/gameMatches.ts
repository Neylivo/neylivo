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
}

// Игры, для которых main-процесс умеет присылать событие конца матча —
// используется, чтобы решить, показывать ли «Статистика» по клику на активность.
export const MATCH_TRACKED_GAMES = new Set(['Counter-Strike 2'])

export async function saveMatch(userId: string, m: { game: string; mode?: string | null; map?: string | null; score?: string | null; result?: 'win' | 'loss' | 'draw' | null }): Promise<void> {
  const { error } = await supabase.from('game_matches').insert({
    user_id: userId, game_name: m.game, mode: m.mode ?? null, map: m.map ?? null, score: m.score ?? null, result: m.result ?? null,
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
  return {
    total: matches.length, wins, losses, draws,
    winrate: decided.length ? Math.round((wins / decided.length) * 100) : 0,
    byMap: [...mapAgg.entries()].map(([map, v]) => ({ map, ...v })).sort((a, b) => b.count - a.count),
    byMode: [...modeAgg.entries()].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count),
  }
}
