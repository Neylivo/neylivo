
// v1.139.0: значок активности по жанру игры — автомат для шутеров, меч для RPG,
// машина для гонок и т.д. Категория определяется по названию игры (подстроки,
// без регистра). Неизвестные игры — обычный геймпад.
const CATS: { icon: string; keys: string[] }[] = [
  { icon: 'rifle', keys: [
    'counter-strike', 'cs:go', 'cs2', 'valorant', 'fortnite', 'apex', 'pubg', 'overwatch',
    'rust', 'tarkov', 'delta force', 'finals', 'helldivers', 'warframe', 'destiny',
    'rainbow six', 'ready or not', 'call of duty', 'warzone', 'battlefield', 'doom',
    'half-life', 'stalker', 's.t.a.l.k.e.r', 'metro', 'far cry', 'borderlands', 'titanfall',
    'hunt: showdown', 'insurgency', 'squad', 'arma', 'halo', 'quake', 'paladins',
    'crossfire', 'standoff', 'war thunder', 'world of tanks', 'warships', 'enlisted', 'payday',
  ] },
  { icon: 'sword', keys: [
    'dota', 'league of legends', 'elden ring', 'witcher', 'baldur', 'diablo',
    'world of warcraft', 'genshin', 'dark souls', 'sekiro', 'skyrim', 'elder scrolls',
    'hogwarts', 'monster hunter', 'path of exile', 'lost ark', 'albion', 'runescape',
    'final fantasy', 'nier', 'god of war', 'assassin', 'lineage', 'black desert',
    'honkai', 'wuthering', 'smite', 'for honor', 'chivalry', 'mordhau', 'valheim',
  ] },
  { icon: 'car', keys: [
    'rocket league', 'gta', 'grand theft', 'forza', 'need for speed', 'nfs', 'beamng',
    'assetto', 'f1 2', 'f1 “', 'dirt rally', 'snowrunner', 'euro truck', 'american truck',
    'trackmania', 'wreckfest', 'the crew', 'gran turismo', 'carx', 'drift',
  ] },
  { icon: 'cube', keys: [
    'minecraft', 'roblox', 'terraria', 'factorio', 'stardew', 'sims', 'satisfactory',
    'rimworld', 'cities', 'planet coaster', 'planet zoo', 'core keeper', 'astroneer',
    'subnautica', 'raft', 'grounded', 'lego', 'garry', "gmod", 'teardown', 'unturned', 'scrap mechanic',
  ] },
  { icon: 'ball', keys: [
    'fifa', 'fc 24', 'fc 25', 'fc 26', 'efootball', 'pes 2', 'nba', 'nhl', 'madden',
    'golf', 'tennis', 'volley', 'football manager', 'soccer', 'basketball',
  ] },
  { icon: 'skull', keys: [
    'dead by daylight', 'phasmophobia', 'resident evil', 'outlast', 'amnesia',
    'dying light', 'dead space', 'silent hill', 'the forest', 'sons of the forest',
    'lethal company', 'devour', 'demonologist', 'fnaf', 'five nights', 'poppy playtime', 'granny',
  ] },
  { icon: 'music', keys: [
    'osu', 'beat saber', 'friday night funkin', 'guitar hero', 'clone hero', 'just dance', 'rhythm',
  ] },
]

export function gameIconOf(name?: string | null): string {
  const n = (name ?? '').toLowerCase()
  if (!n) return 'gamepad'
  for (const c of CATS) if (c.keys.some(k => n.includes(k))) return c.icon
  return 'gamepad'
}
