// v1.192.0: «Поделиться игрой» — Terraria. В отличие от Roblox, у Terraria нет
// своего диплинк-протокола, поэтому вместо простой ссылки сами находим
// Terraria.exe на диске и запускаем с -connect/-port (тот же стиль, что и
// launch() в electron/quicklaunch.cjs, только без загрузки модов/библиотек —
// у ванильной Terraria качать нечего).
const fs = require('fs')
const path = require('path')

// Путь к Steam — единственный надёжный реестровый ключ (HKCU, не требует прав).
function steamPath() {
  try {
    const { execFileSync } = require('child_process')
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' })
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i)
    return m ? m[1].trim().replace(/\//g, '\\') : null
  } catch { return null }
}

// libraryfolders.vdf — простой построчный парсинг, без VDF-библиотеки: нужны
// только значения "path" (остальные диски со Steam-библиотеками).
function steamLibraries(steam) {
  const libs = [steam]
  try {
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    const re = /"path"\s+"([^"]+)"/gi
    let m
    while ((m = re.exec(vdf))) libs.push(m[1].replace(/\\\\/g, '\\'))
  } catch {}
  return libs
}

function findTerrariaExe() {
  const steam = steamPath()
  if (!steam) return null
  for (const lib of steamLibraries(steam)) {
    const exe = path.join(lib, 'steamapps', 'common', 'Terraria', 'Terraria.exe')
    if (fs.existsSync(exe)) return exe
  }
  return null
}

function launch(ip, port) {
  const exe = findTerrariaExe()
  if (!exe) return { error: 'Terraria не найдена — установи через Steam' }
  try {
    const { spawn } = require('child_process')
    const child = spawn(exe, ['-connect', String(ip), '-port', String(port)], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' })
    child.unref()
    return { pid: child.pid }
  } catch (e) { return { error: String((e && e.message) || e) } }
}

function registerTerraria(ipcMain) {
  ipcMain.handle('ponoi-terraria-launch', (_e, { ip, port }) => launch(ip, port))
}

module.exports = { registerTerraria, findTerrariaExe, launch }
