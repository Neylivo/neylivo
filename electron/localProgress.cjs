// v1.461.0: прохождение берётся С ДИСКА — без Steam ID и без интернета.
//
// Что было. Вехи тянулись из профиля Steam: нужен привязанный SteamID64,
// открытый профиль и сеть. Владелец сказал прямо: должно работать и без этого —
// «например, когда на пиратке играешь». И он прав: у человека, играющего в
// нелицензионную копию, профиля Steam для этой игры нет вовсе, а прохождение у
// него есть — оно лежит на его же диске.
//
// Откуда берём, по порядку надёжности:
//
//   1. Steam, свои файлы. Имя пользователя и SteamID64 лежат в
//      `config/loginusers.vdf` — то есть вводить их руками не надо НИКОМУ, даже
//      обладателю лицензии. А сами достижения Steam держит в
//      `userdata/<id>/<appid>/stats/` — но в двоичном виде, поэтому оттуда
//      берём только то, что читается достоверно.
//
//   2. Эмуляторы Steam, которыми снабжают нелицензионные копии. Каждый пишет
//      достижения в свой файл, и почти все — в понятном виде:
//        • Goldberg — `%APPDATA%/Goldberg SteamEmu Saves/<appid>/achievements.json`;
//        • CODEX    — `%PUBLIC%/Documents/Steam/CODEX/<appid>/achievements.ini`;
//        • RUNE/RLD — тот же вид ini в своих папках;
//        • SmartSteamEmu — `%APPDATA%/SmartSteamEmu/<appid>/stats/achievements.ini`.
//
//   3. Названия и описания вех. Их знает не эмулятор, а сама игра: Goldberg
//      кладёт рядом с игрой `steam_settings/achievements.json` — там имена,
//      описания и картинки. Если этого файла нет, показываем то, что есть:
//      сами метки достижений. Это некрасиво, но ЧЕСТНО — придумывать названия
//      вех я не буду, они были бы выдумкой в том месте, где нужна точность.
//
// Ничего не скачиваем и никуда не ходим: всё лежит на диске у человека.
//
// Проверки: npm run test:games.
const fs = require('fs')
const path = require('path')

// ── Кто вошёл в Steam на этой машине ────────────────────────────────────────

/**
 * SteamID64 из loginusers.vdf. Берём того, кто входил последним: у человека
 * может быть несколько учёток, и «самая свежая» — это почти всегда та, под
 * которой он сейчас играет.
 */
function steamIdFromLoginUsers(text) {
  const s = String(text || '')
  let лучший = null
  // Блоки вида: "76561198…" { "AccountName" "x" ... "Timestamp" "1700000000" }
  for (const m of s.matchAll(/"(\d{17})"\s*\{([\s\S]*?)\n\s*\}/g)) {
    const id = m[1]
    const тело = m[2]
    const t = Number((тело.match(/"Timestamp"\s*"(\d+)"/i) || [])[1] || 0)
    const свежий = /"MostRecent"\s*"1"/i.test(тело)
    const вес = (свежий ? 1e12 : 0) + t
    if (!лучший || вес > лучший.вес) лучший = { id, вес }
  }
  return лучший ? лучший.id : null
}

/** Где может стоять Steam. Порядок — от обычного к редкому. */
function steamRoots(env = process.env) {
  const out = []
  for (const v of [env['ProgramFiles(x86)'], env.ProgramFiles, env.SystemDrive]) {
    if (v) out.push(path.join(v, 'Steam'))
  }
  return out
}

/** Найти SteamID64 самому. null — Steam не стоит или никто не входил. */
function localSteamId(roots = steamRoots(), readFile = fs.readFileSync) {
  for (const r of roots) {
    try {
      const t = String(readFile(path.join(r, 'config', 'loginusers.vdf'), 'utf8'))
      const id = steamIdFromLoginUsers(t)
      if (id) return id
    } catch { /* нет такого */ }
  }
  return null
}

// ── Достижения из файлов эмуляторов ─────────────────────────────────────────

/**
 * Goldberg: `{ "ACH_NAME": { "earned": true, "earned_time": 1700000000 }, … }`
 * Встречается и старый вид — просто список полученных.
 */
function parseGoldberg(text) {
  let j
  try { j = JSON.parse(String(text || '')) } catch { return [] }
  const out = []
  if (Array.isArray(j)) {
    for (const k of j) if (typeof k === 'string') out.push({ id: k, done: true, at: 0 })
    return out
  }
  if (!j || typeof j !== 'object') return []
  for (const [k, v] of Object.entries(j)) {
    if (!k) continue
    const done = v === true || (v && typeof v === 'object' && (v.earned === true || v.Achieved === 1))
    const at = Number((v && typeof v === 'object' && (v.earned_time ?? v.UnlockTime)) || 0)
    out.push({ id: k, done: !!done, at: at ? at * 1000 : 0 })
  }
  return out
}

/**
 * CODEX / RUNE / SmartSteamEmu: ini вида
 *   [ACH_NAME]
 *   Achieved=1
 *   UnlockTime=1700000000
 */
function parseAchIni(text) {
  const out = []
  let cur = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const m = /^\[(.+?)\]$/.exec(line)
    if (m) {
      cur = { id: m[1].trim(), done: false, at: 0 }
      // Служебные разделы вроде [SteamAchievements] — не веха.
      if (/^steam/i.test(cur.id)) { cur = null; continue }
      out.push(cur)
      continue
    }
    if (!cur) continue
    const kv = /^([A-Za-z_]+)\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    const ключ = kv[1].toLowerCase()
    if (ключ === 'achieved' || ключ === 'earned' || ключ === 'haveachieved') {
      cur.done = kv[2].trim() === '1' || /true/i.test(kv[2])
    } else if (ключ.includes('time')) {
      const t = Number(kv[2].trim()) || 0
      if (t) cur.at = t * 1000
    }
  }
  return out.filter(a => a.id)
}

/** Схема из Goldberg рядом с игрой: имена, описания, картинки. */
function parseSchema(text) {
  let j
  try { j = JSON.parse(String(text || '')) } catch { return {} }
  const list = Array.isArray(j) ? j : (j && typeof j === 'object' ? Object.values(j) : [])
  const out = {}
  for (const a of list) {
    if (!a || typeof a !== 'object') continue
    const id = String(a.name ?? a.internal_name ?? a.id ?? '')
    if (!id) continue
    const назв = a.displayName ?? a.display_name ?? (a.displayname) ?? {}
    out[id] = {
      title: typeof назв === 'string' ? назв : String(назв.russian ?? назв.english ?? id),
      desc: (() => {
        const d = a.description ?? a.desc ?? {}
        return typeof d === 'string' ? d : String(d.russian ?? d.english ?? '')
      })(),
      icon: String(a.icon ?? a.icon_gray ?? '') || undefined,
    }
  }
  return out
}

/** Где искать файлы достижений для этой игры. */
function candidatePaths(appId, exePath, env = process.env) {
  const app = String(appId || '')
  const out = []
  const push = (p, вид) => { if (p) out.push({ path: p, kind: вид }) }
  const APPDATA = env.APPDATA
  const PUBLIC = env.PUBLIC || 'C:\\Users\\Public'
  if (APPDATA && app) {
    push(path.join(APPDATA, 'Goldberg SteamEmu Saves', app, 'achievements.json'), 'goldberg')
    push(path.join(APPDATA, 'GSE Saves', app, 'achievements.json'), 'goldberg')
    push(path.join(APPDATA, 'SmartSteamEmu', app, 'stats', 'achievements.ini'), 'ini')
    push(path.join(APPDATA, 'Steam', 'CODEX', app, 'achievements.ini'), 'ini')
    push(path.join(APPDATA, 'Steam', 'RUNE', app, 'achievements.ini'), 'ini')
  }
  if (app) {
    push(path.join(PUBLIC, 'Documents', 'Steam', 'CODEX', app, 'achievements.ini'), 'ini')
    push(path.join(PUBLIC, 'Documents', 'Steam', 'RUNE', app, 'achievements.ini'), 'ini')
    push(path.join(PUBLIC, 'Documents', 'EMPRESS', app, 'achievements.ini'), 'ini')
  }
  // Рядом с самой игрой — так делают ALI213 и часть сборок.
  if (exePath) {
    const dir = path.dirname(String(exePath))
    push(path.join(dir, 'ALI213', 'Stats', 'Achievements.ini'), 'ini')
    push(path.join(dir, 'Profile', 'Stats', 'achievements.ini'), 'ini')
    push(path.join(dir, 'steam_settings', 'achievements.json'), 'schema')
  }
  return out
}

/**
 * Собрать прохождение с диска.
 * Возвращает { ok, items } либо { ok: false, why }.
 */
function localProgress(appId, exePath, io2 = {}) {
  const readFile = io2.readFile || fs.readFileSync
  const env = io2.env || process.env
  const пути = candidatePaths(appId, exePath, env)

  let схема = {}
  let достижения = null
  for (const c of пути) {
    let t
    try { t = String(readFile(c.path, 'utf8')) } catch { continue }
    if (c.kind === 'schema') { схема = parseSchema(t); continue }
    const list = c.kind === 'goldberg' ? parseGoldberg(t) : parseAchIni(t)
    if (list.length && !достижения) достижения = list
  }
  if (!достижения || !достижения.length) return { ok: false, why: 'no-local' }

  const items = достижения.map(a => {
    const s = схема[a.id] || {}
    return {
      name: s.title || a.id,
      desc: s.desc || '',
      icon: s.icon || '',
      done: !!a.done,
      at: a.at || 0,
    }
  })
  return { ok: true, items }
}

module.exports = {
  steamIdFromLoginUsers, localSteamId, steamRoots,
  parseGoldberg, parseAchIni, parseSchema, candidatePaths, localProgress,
}
