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
const { pipeline } = require('stream/promises')
const { Readable } = require('stream')

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
  const size = fs.statSync(filepath).size
  const stream = fs.createReadStream(filepath)
  // content-length обязателен: без него Node-fetch льёт стрим как
  // Transfer-Encoding: chunked, а Storage API Supabase на этом эндпоинте
  // такие запросы отклоняет с HTTP 400 (в отличие от uploadWithProgress()
  // в src/lib/storage.ts — там XHR шлёт File/Blob с уже известной длиной).
  const res = await fetch(supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/modfiles/' + sha1 + '.jar', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      apikey: anonKey,
      'content-type': 'application/java-archive',
      'content-length': String(size),
      'x-upsert': 'true',
    },
    body: stream,
    duplex: 'half',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error('upload failed: HTTP ' + res.status + (body ? ' — ' + body.slice(0, 300) : ''))
  }
  return { skipped: false }
}

// ---- Песочница у друга: докачка недостающих модов + подготовка instance-папки ----
// Модовый инстанс живёт ОТДЕЛЬНО от настоящей папки mods друга — см. пункт 6
// плана (безопасность): что бы ни было в чужой сборке, оно не трогает его
// собственную установку. Инстанс переиспользуется при повторном заходе в тот
// же пак (уже скачанное не качается заново).
function instanceDir(packId) { return path.join(mcRoot(), 'ponoi_instances', packId) }

async function ownModHashes(...dirs) {
  const map = new Map()   // sha1 -> filepath
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(MOD_EXT)) continue
      const fp = path.join(dir, f)
      try { map.set(await sha1File(fp), fp) } catch {}
    }
  }
  return map
}

async function downloadTo(url, destPath) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error('download failed: HTTP ' + res.status + ' ' + url)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath))
}

// pack — строка из quicklaunch_packs (camelCase-поля, см. fetchPack() в src/lib/quicklaunch.ts).
async function prepareInstance(pack, supabaseUrl, onProgress) {
  const root = mcRoot()
  const inst = instanceDir(pack.id)
  const modsOut = path.join(inst, 'mods')
  fs.mkdirSync(modsOut, { recursive: true })

  // Что уже есть у друга — в его настоящей папке mods И в этой же песочнице
  // с прошлого раза (по хешу, не по имени: одинаковое имя не значит то же содержимое).
  const known = await ownModHashes(path.join(root, 'mods'), modsOut)

  const mods = pack.mods || []
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i]
    if (!m.filename || !m.filename.toLowerCase().endsWith(MOD_EXT) || !/^[0-9a-f]{40}$/i.test(m.sha1 || '')) {
      throw new Error('Подозрительная запись в манифесте: ' + JSON.stringify(m))   // безопасность — пункт 6 плана
    }
    const dest = path.join(modsOut, m.filename)
    if (!fs.existsSync(dest)) {
      const existing = known.get(m.sha1)
      if (existing) {
        if (path.resolve(existing) !== path.resolve(dest)) fs.copyFileSync(existing, dest)
      } else {
        await downloadTo(publicUrl(supabaseUrl, m.sha1), dest)
        const got = await sha1File(dest)
        if (got.toLowerCase() !== m.sha1.toLowerCase()) {
          try { fs.unlinkSync(dest) } catch {}
          throw new Error('Хеш скачанного файла не совпал — ' + m.filename)
        }
      }
    }
    onProgress?.({ done: i + 1, total: mods.length, filename: m.filename })
  }

  // Настройки графики/управления и список серверов — чтобы игра не стартовала «голой».
  for (const f of ['options.txt', 'servers.dat']) {
    const src = path.join(root, f), dst = path.join(inst, f)
    if (fs.existsSync(src) && !fs.existsSync(dst)) { try { fs.copyFileSync(src, dst) } catch {} }
  }

  return { instanceDir: inst }
}

// ---- Запуск игры: резолв version json (Mojang piston-meta), установка Forge/
// NeoForge при необходимости, докачка библиотек/ассетов/клиент-jar-а, java -jar ----
// Это тот же алгоритм, что и у официального лаунчера (и у MultiMC/Prism): каждая
// версия описана json-файлом, у модовых версий он через inheritsFrom ссылается на
// ванильную — libraries/arguments объединяются, javaVersion/assetIndex/downloads
// берутся из ванильной. Проверено на реальной установке (см. план).

// os.name важен только для правил windows/osx/linux в version json — Ponoi
// собирается только под Windows (см. память проекта), остальные ветки не нужны.
function rulesAllow(rules) {
  if (!rules || !rules.length) return true
  let allowed = false
  for (const r of rules) {
    const osOk = !r.os || !r.os.name || r.os.name === 'windows'
    if (r.action === 'allow' && osOk) allowed = true
    if (r.action === 'disallow' && osOk) allowed = false
  }
  return allowed
}

function mavenPathFromName(name) {
  const [group, artifact, version, classifier] = name.split(':')
  const groupPath = group.replace(/\./g, '/')
  const file = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`
  return `${groupPath}/${artifact}/${version}/${file}`
}
function libraryDest(lib) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
    return { relPath: lib.downloads.artifact.path, url: lib.downloads.artifact.url }
  }
  if (lib.name) {
    const relPath = mavenPathFromName(lib.name)
    const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/$/, '')
    return { relPath, url: base + '/' + relPath }
  }
  return null
}

async function fetchVanillaVersionJson(root, mcVersion) {
  const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  const manifest = await res.json()
  const entry = (manifest.versions || []).find(v => v.id === mcVersion)
  if (!entry) throw new Error('Версия Minecraft не найдена в Mojang API: ' + mcVersion)
  const json = await (await fetch(entry.url)).json()
  const dir = path.join(root, 'versions', mcVersion)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, mcVersion + '.json'), JSON.stringify(json))
  return json
}

// Модовый json (Forge/NeoForge) + унаследованный ванильный -> один объединённый.
async function resolveVersionJson(root, versionId) {
  const own = readVersionJson(root, versionId)
  if (!own) throw new Error('Версия не установлена: ' + versionId)
  if (!own.inheritsFrom) return { merged: own, vanillaId: versionId }
  const base = readVersionJson(root, own.inheritsFrom) || await fetchVanillaVersionJson(root, own.inheritsFrom)
  const merged = {
    id: own.id,
    mainClass: own.mainClass || base.mainClass,
    javaVersion: base.javaVersion,
    assetIndex: base.assetIndex,
    downloads: base.downloads,
    libraries: [...(own.libraries || []), ...(base.libraries || [])],
    arguments: {
      game: [...((own.arguments && own.arguments.game) || []), ...((base.arguments && base.arguments.game) || [])],
      jvm: [...((own.arguments && own.arguments.jvm) || []), ...((base.arguments && base.arguments.jvm) || [])],
    },
  }
  return { merged, vanillaId: own.inheritsFrom }
}

async function ensureClientJar(root, merged, vanillaId) {
  const dest = path.join(root, 'versions', vanillaId, vanillaId + '.jar')
  if (!fs.existsSync(dest)) {
    if (!merged.downloads || !merged.downloads.client) throw new Error('Нет ссылки на client.jar для ' + vanillaId)
    await downloadTo(merged.downloads.client.url, dest)
  }
  return dest
}

async function ensureLibraries(root, libraries, onProgress) {
  const list = libraries.filter(l => rulesAllow(l.rules)).map(libraryDest).filter(Boolean)
  const out = []
  for (let i = 0; i < list.length; i++) {
    const dest = path.join(root, 'libraries', ...list[i].relPath.split('/'))
    if (!fs.existsSync(dest)) await downloadTo(list[i].url, dest)
    out.push(dest)
    onProgress?.({ stage: 'libraries', done: i + 1, total: list.length })
  }
  return out
}

async function ensureAssets(root, merged, onProgress) {
  if (!merged.assetIndex) return 'legacy'
  const indexId = merged.assetIndex.id
  const indexPath = path.join(root, 'assets', 'indexes', indexId + '.json')
  let index
  if (fs.existsSync(indexPath)) index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  else {
    index = await (await fetch(merged.assetIndex.url)).json()
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, JSON.stringify(index))
  }
  const objects = Object.values(index.objects || {})
  for (let i = 0; i < objects.length; i++) {
    const hash = objects[i].hash, sub = hash.slice(0, 2)
    const dest = path.join(root, 'assets', 'objects', sub, hash)
    if (!fs.existsSync(dest)) await downloadTo('https://resources.download.minecraft.net/' + sub + '/' + hash, dest)
    if (i % 20 === 0 || i === objects.length - 1) onProgress?.({ stage: 'assets', done: i + 1, total: objects.length })
  }
  return indexId
}

// Известные каналы Mojang-рантайма (совпадают у официального лаунчера и у
// TLauncher/подобных, живут прямо в .minecraft/runtime/<канал>/windows/<канал>/bin) —
// перебираем от новых к старым, если конкретный компонент из javaVersion не нашёлся.
const JAVA_CHANNELS = ['java-runtime-delta', 'java-runtime-gamma', 'java-runtime-beta', 'java-runtime-alpha', 'jre-legacy']
function findJava(root, component) {
  const order = component ? [component, ...JAVA_CHANNELS.filter(c => c !== component)] : JAVA_CHANNELS
  for (const name of order) {
    const exe = path.join(root, 'runtime', name, 'windows', name, 'bin', 'javaw.exe')
    if (fs.existsSync(exe)) return exe
  }
  try {
    const tlDir = path.join(path.dirname(root), '.tlauncher', 'jvms')
    for (const d of fs.readdirSync(tlDir)) {
      const exe = path.join(tlDir, d, 'bin', 'javaw.exe')
      if (fs.existsSync(exe)) return exe
    }
  } catch {}
  return null
}

function loaderVersionId(loader, mcVersion, loaderVersion) {
  return loader === 'neoforge' ? `neoforge-${loaderVersion}` : `${mcVersion}-forge-${loaderVersion}`
}
function installerUrl(loader, mcVersion, loaderVersion) {
  return loader === 'neoforge'
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
    : `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/forge-${mcVersion}-${loaderVersion}-installer.jar`
}
// Тихая установка через официальный installer.jar (--installClient <root>) — тот
// же способ, каким ставят Forge/NeoForge сторонние лаунчеры без диалоговых окон.
async function ensureLoaderInstalled(root, pack, javaExe, onProgress) {
  const versionId = loaderVersionId(pack.loader, pack.mcVersion, pack.loaderVersion)
  if (readVersionJson(root, versionId)) return versionId
  onProgress?.({ stage: 'installer' })
  const url = installerUrl(pack.loader, pack.mcVersion, pack.loaderVersion)
  const tmp = path.join(os.tmpdir(), 'ponoi-installer-' + Date.now() + '.jar')
  await downloadTo(url, tmp)
  const javaConsole = javaExe.replace(/w\.exe$/i, '.exe')
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const p = spawn(javaConsole, ['-jar', tmp, '--installClient', root], { windowsHide: true })
    let err = ''
    p.stderr.on('data', d => { err += d })
    p.on('exit', code => code === 0 ? resolve() : reject(new Error('Установка ' + pack.loader + ' не удалась: ' + err.slice(0, 400))))
    p.on('error', reject)
  })
  try { fs.unlinkSync(tmp) } catch {}
  if (!readVersionJson(root, versionId)) throw new Error('Установка ' + pack.loader + ' завершилась, но версия не появилась')
  return versionId
}

function applyVars(s, vars) { return s.replace(/\$\{([^}]+)\}/g, (_, k) => (k in vars ? vars[k] : '')) }
function substArgs(list, vars) {
  const out = []
  for (const item of list || []) {
    if (typeof item === 'string') { out.push(applyVars(item, vars)); continue }
    if (!rulesAllow(item.rules)) continue
    for (const v of Array.isArray(item.value) ? item.value : [item.value]) out.push(applyVars(v, vars))
  }
  return out
}
// UUID оффлайн-режима — тот же алгоритм, что у ванильного клиента/Bukkit:
// UUID.nameUUIDFromBytes("OfflinePlayer:<ник>") (MD5 с проставленными битами версии/варианта).
function offlineUuid(username) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + username, 'utf8').digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// pack — строка из quicklaunch_packs; instDir — из prepareInstance(); username — ник Ponoi.
async function launch(pack, instDir, username, onProgress) {
  const root = mcRoot()
  const javaProbe = findJava(root, null)
  if (!javaProbe) throw new Error('Java не найдена. Установи официальный Minecraft Launcher (или TLauncher) и запусти игру хотя бы раз.')
  const versionId = await ensureLoaderInstalled(root, pack, javaProbe, onProgress)
  const { merged, vanillaId } = await resolveVersionJson(root, versionId)
  const javaExe = findJava(root, merged.javaVersion && merged.javaVersion.component) || javaProbe
  const clientJar = await ensureClientJar(root, merged, vanillaId)
  const libPaths = await ensureLibraries(root, merged.libraries || [], onProgress)
  const assetsIndexId = await ensureAssets(root, merged, onProgress)

  const nativesDir = path.join(instDir, 'natives')
  fs.mkdirSync(nativesDir, { recursive: true })

  const vars = {
    natives_directory: nativesDir, launcher_name: 'ponoi', launcher_version: '1',
    classpath: [...libPaths, clientJar].join(';'),
    auth_player_name: username, version_name: versionId, game_directory: instDir,
    assets_root: path.join(root, 'assets'), assets_index_name: assetsIndexId,
    auth_uuid: offlineUuid(username), auth_access_token: '0', clientid: '-', auth_xuid: '-',
    user_type: 'legacy', version_type: 'release',
  }
  const jvmArgs = substArgs((merged.arguments && merged.arguments.jvm) || ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'], vars)
  const gameArgs = substArgs(merged.arguments && merged.arguments.game, vars)
  // --server/--port — легаси-флаг прямого подключения, живой во всех версиях клиента
  // (в отличие от --quickPlayMultiplayer, который есть только с 1.20) — see план, допущение 1.
  const args = [...jvmArgs, merged.mainClass, ...gameArgs, '--server', pack.serverIp, '--port', String(pack.serverPort)]

  onProgress?.({ stage: 'launch' })
  const { spawn } = require('child_process')
  const child = spawn(javaExe, args, { cwd: instDir, detached: true, stdio: 'ignore' })
  child.unref()
  return { pid: child.pid }
}

function registerQuicklaunch(ipcMain) {
  ipcMain.handle('ponoi-mc-scan-mods', () => scanMods())
  ipcMain.handle('ponoi-mc-mod-exists', (_e, { supabaseUrl, sha1 }) => modExists(supabaseUrl, sha1))
  ipcMain.handle('ponoi-mc-upload-mod', (_e, args) => uploadMod(args))
  ipcMain.handle('ponoi-mc-prepare-instance', (e, { pack, supabaseUrl }) =>
    prepareInstance(pack, supabaseUrl, p => { try { e.sender.send('ponoi-mc-progress', p) } catch {} }))
  ipcMain.handle('ponoi-mc-launch', (e, { pack, instDir, username }) =>
    launch(pack, instDir, username, p => { try { e.sender.send('ponoi-mc-progress', p) } catch {} }))
}

module.exports = {
  registerQuicklaunch, scanMods, mcRoot, sha1File, detectLoader, modExists, uploadMod,
  prepareInstance, instanceDir, findJava, resolveVersionJson, launch,
}
