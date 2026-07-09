// Dota 2 статистика (v1.165.0): Valve не отдаёт MMR через GSI (античит-ограничение),
// поэтому вместо локального game_matches тянем матчи и медаль напрямую из OpenDota —
// открытый бесплатный API без ключа, нужен только привязанный SteamID64 (Настройки ->
// Активность). Аккаунт может быть скрыт настройками приватности Dota — тогда OpenDota
// просто не отдаёт часть полей, обрабатываем как «нет данных», а не как ошибку.
const API = 'https://api.opendota.com/api'

export function steamId64ToAccountId(steamId64: string): number | null {
  const id = BigInt(steamId64 || '0')
  const base = 76561197960265728n
  if (id <= base) return null
  return Number(id - base)
}

const RANK_NAMES = ['', 'Рекрут', 'Страж', 'Крестоносец', 'Архонт', 'Легенда', 'Древний', 'Божественный', 'Immortal']
export function rankLabel(rankTier: number | null | undefined): string | null {
  if (!rankTier) return null
  const tier = Math.floor(rankTier / 10)
  const stars = rankTier % 10
  const name = RANK_NAMES[tier]
  if (!name) return null
  return tier === 8 ? name : name + (stars ? ' ' + stars : '')
}

let heroCache: Record<number, string> | null = null
async function heroNames(): Promise<Record<number, string>> {
  if (heroCache) return heroCache
  try {
    const list = await fetch(API + '/heroes').then(r => r.json())
    heroCache = {}
    for (const h of list as any[]) heroCache[h.id] = h.localized_name
  } catch { heroCache = {} }
  return heroCache
}

export interface DotaMatch {
  match_id: number
  hero: string
  kills: number
  deaths: number
  assists: number
  win: boolean
  duration: number
  start_time: number
}

export interface DotaStats {
  mmrEstimate: number | null
  rank: string | null
  matches: DotaMatch[]
}

export async function fetchDotaStats(steamId64: string): Promise<DotaStats | null> {
  const accountId = steamId64ToAccountId(steamId64)
  if (accountId == null) return null
  try {
    const [player, matches, heroes] = await Promise.all([
      fetch(API + '/players/' + accountId).then(r => r.json()),
      fetch(API + '/players/' + accountId + '/matches?limit=20').then(r => r.json()),
      heroNames(),
    ])
    if (!player || player.error) return null
    const mmrEstimate = player.mmr_estimate?.estimate ?? null
    const rank = rankLabel(player.leaderboard_rank ? 80 : player.rank_tier)
    const list: DotaMatch[] = Array.isArray(matches) ? matches.map((m: any) => ({
      match_id: m.match_id,
      hero: heroes[m.hero_id] || 'Неизвестный герой',
      kills: m.kills, deaths: m.deaths, assists: m.assists,
      win: (m.player_slot < 128) === !!m.radiant_win,
      duration: m.duration, start_time: m.start_time * 1000,
    })) : []
    return { mmrEstimate, rank, matches: list }
  } catch { return null }
}
