// v1.180.0: «Игровой Экспресс» (QuickLaunch) — поделиться сборкой Minecraft
// прямо в чате и авто-запустить её у друга. Этот модуль — main-процессная
// половина (файловая система, сеть, запуск процессов); рендерер видит только
// узкие IPC-каналы через preload.cjs, как и остальной ponoiDesktop-бридж.
//
// v1: только Minecraft Java + Forge + offline-режим сервера (см. план в
// C:\Users\nubas\.claude\plans\indexed-riding-quokka.md за полным разбором
// упрощений и почему они необходимы для первой версии).
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

function mcRoot() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, '.minecraft')
}

// Хэш файла потоково — моды/библиотеки бывают десятки МБ, грузить целиком в память не нужно.
function sha1File(fp) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const s = fs.createReadStream(fp)
    s.on('data', d => hash.update(d))
    s.on('end', () => resolve(hash.digest('hex')))
    s.on('error', reject)
  })
}

// v1.180.0: сперва определяли версию MC регэкспом по имени папки (форматом
// Forge — "1.20.1-forge-47.2.0"), но у NeoForge имя версии — просто
// "neoforge-21.1.229", без версии MC внутри вообще. Настоящая версия MC у ЛЮБОГО
// модового лоадера (Forge, NeoForge, Fabric) лежит в самом version JSON, в поле
// inheritsFrom — так её достают все лаунчеры (включая официальный), поэтому
// матчим по нему, а не по имени папки. Заодно это даром даёт поддержку NeoForge.
const LOADER_ID_RE = /^(?:(\d+\.\d+(?:\.\d+)?)-)?(forge|neoforge)-(.+)$/

function readVersionJson(root, id) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'versions', id, id + '.json'), 'utf8')) }
  catch { return null }
}

function loaderFromVersionId(root, id) {
  const m = String(id).match(LOADER_ID_RE)
  if (!m) return null
  const json = readVersionJson(root, id)
  const mcVersion = (json && json.inheritsFrom) || m[1]
  if (!mcVersion) return null   // ни inheritsFrom в json, ни версия в имени — не сматчим с модами по версии
  return { mcVersion, loader: m[2], loaderVersion: m[3] }
}

// Лоадер, которым хост реально играл — по последнему использованному профилю
// в launcher_profiles.json (пишут и официальный лаунчер, и TLauncher/подобные —
// формат общий). Фолбэк — самая недавно изменённая forge/neoforge-папка в versions/,
// если профили не читаются.
function detectLoader(root) {
  try {
    const raw = fs.readFileSync(path.join(root, 'launcher_profiles.json'), 'utf8')
    const j = JSON.parse(raw)
    const profiles = Object.values(j.profiles || {})
      .filter(p => p && typeof p.lastVersionId === 'string')
      .sort((a, b) => new Date(b.lastUsed || 0) - new Date(a.lastUsed || 0))
    for (const p of profiles) {
      const found = loaderFromVersionId(root, p.lastVersionId)
      if (found) return found
    }
  } catch {}
  try {
    const versionsDir = path.join(root, 'versions')
    const dirs = fs.readdirSync(versionsDir, { withFileTypes: true }).filter(d => d.isDirectory())
    const candidates = dirs
      .filter(d => LOADER_ID_RE.test(d.name))
      .map(d => { let mtime = 0; try { mtime = fs.statSync(path.join(versionsDir, d.name)).mtimeMs } catch {}; return { id: d.name, mtime } })
      .sort((a, b) => b.mtime - a.mtime)
    for (const c of candidates) {
      const found = loaderFromVersionId(root, c.id)
      if (found) return found
    }
  } catch {}
  return null
}

const MOD_EXT = '.jar'   // единственный разрешённый тип «мода» — см. пункт 6 плана (безопасность)

// Черновик манифеста для карточки «Поделиться сборкой»: версия MC/лоадера хоста +
// список модов с sha1 (докачка/дедуп на стороне друга и в Storage считается по хешу).
async function scanMods() {
  const root = mcRoot()
  if (!fs.existsSync(root)) return { error: 'no-minecraft' }
  const modsDir = path.join(root, 'mods')
  if (!fs.existsSync(modsDir)) return { error: 'no-mods-folder' }
  const loader = detectLoader(root)
  if (!loader) return { error: 'no-loader' }
  const files = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith(MOD_EXT))
  const mods = []
  for (const f of files) {
    const fp = path.join(modsDir, f)
    let st
    try { st = fs.statSync(fp) } catch { continue }
    if (!st.isFile()) continue
    const sha1 = await sha1File(fp)
    mods.push({ name: f.replace(/\.jar$/i, ''), filename: f, sha1, size: st.size })
  }
  return { mcVersion: loader.mcVersion, loader: loader.loader, loaderVersion: loader.loaderVersion, mods }
}

// ---- Заливка недостающих модов в общий (контент-адресованный) bucket modfiles ----
// Идёт из main-процесса напрямую (не через рендерер): файл читается потоком с
// диска и льётся в Supabase Storage REST, без промежуточной загрузки байтов в
// окно — моды бывают под сотню МБ, гонять их лишний раз через IPC незачем.
// Тот же протокол заголовков, что uploadWithProgress() в src/lib/storage.ts.
function publicUrl(supabaseUrl, sha1) {
  return supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/public/modfiles/' + sha1 + '.jar'
}
async function modExists(supabaseUrl, sha1) {
  try { const res = await fetch(publicUrl(supabaseUrl, sha1), { method: 'HEAD' }); return res.ok }
  catch { return false }
}
async function uploadMod({ supabaseUrl, anonKey, accessToken, sha1, filename }) {
  if (await modExists(supabaseUrl, sha1)) return { skipped: true }
  const filepath = path.join(mcRoot(), 'mods', filename)
  const stream = fs.createReadStream(filepath)
  const res = await fetch(supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/modfiles/' + sha1 + '.jar', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      apikey: anonKey,
      'content-type': 'application/java-archive',
      'x-upsert': 'true',
    },
    body: stream,
    duplex: 'half',
  })
  if (!res.ok) throw new Error('upload failed: HTTP ' + res.status)
  return { skipped: false }
}

function registerQuicklaunch(ipcMain) {
  ipcMain.handle('ponoi-mc-scan-mods', () => scanMods())
  ipcMain.handle('ponoi-mc-mod-exists', (_e, { supabaseUrl, sha1 }) => modExists(supabaseUrl, sha1))
  ipcMain.handle('ponoi-mc-upload-mod', (_e, args) => uploadMod(args))
}

module.exports = { registerQuicklaunch, scanMods, mcRoot, sha1File, detectLoader, modExists, uploadMod }
