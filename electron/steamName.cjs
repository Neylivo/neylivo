// v1.453.0: точное название игры из манифеста Steam.
//
// Что было. Название бралось из ПАПКИ, в которой лежит exe: путь вида
// `steamapps\common\Cyberpunk 2077\bin\x64\game.exe` давал «Cyberpunk 2077», и
// это часто совпадало с настоящим названием. Но не всегда: у половины игр папка
// называется иначе, чем игра. `Wolcen`, `NewWorld`, `HogwartsLegacy`,
// `dota 2 beta`, `PUBG` — папки, а в магазине это «Wolcen: Lords of Mayhem»,
// «New World: Aeternum», «Hogwarts Legacy», «Dota 2», «PUBG: BATTLEGROUNDS».
// Друзья видели «dota 2 beta» и «HogwartsLegacy» — то есть служебные имена.
//
// Откуда берём. Steam сам держит рядом файл `appmanifest_<id>.acf` на каждую
// установленную игру, и в нём написаны и папка (`installdir`), и настоящее имя
// (`name`). Это не догадка и не сеть — это файл на диске, положенный самим
// Steam. Ищем манифест, у которого installdir совпадает с папкой из пути.
//
// Чего не делаем: не ходим в интернет и не выдумываем. Не нашли манифест —
// возвращаем null, и распознавание работает как раньше, по папке.
//
// Проверки: npm run test:games.
const fs = require('fs')
const path = require('path')

/** Достать значение поля из .acf (это key-value в кавычках, не JSON). */
function acfField(text, field) {
  // Формат строки: \t"name"\t\t"Dota 2"
  const re = new RegExp('"' + field + '"\\s*"([^"]*)"', 'i')
  const m = String(text || '').match(re)
  return m ? m[1] : null
}

/** Разобрать манифест: папка установки и настоящее имя. */
function parseManifest(text) {
  const installdir = acfField(text, 'installdir')
  const name = acfField(text, 'name')
  if (!installdir || !name) return null
  return { installdir, name }
}

/** Папка игры из пути к exe: …\steamapps\common\<ПАПКА>\… */
function steamFolder(exePath) {
  const m = String(exePath || '').match(/[\\/]steamapps[\\/]common[\\/]([^\\/]+)/i)
  return m ? m[1] : null
}

/** Корень steamapps из пути к exe — рядом с ним лежат манифесты. */
function steamAppsDir(exePath) {
  const m = String(exePath || '').match(/^(.*[\\/]steamapps)[\\/]common[\\/]/i)
  return m ? m[1] : null
}

/**
 * Настоящее имя игры по пути к exe. null — не Steam или манифеста нет.
 *
 * Читаем только манифесты (это мелкие текстовые файлы) и только в той же папке
 * steamapps, откуда запущена игра: по чужим дискам не ходим.
 */
function steamNameOf(exePath, readDir = fs.readdirSync, readFile = fs.readFileSync) {
  const folder = steamFolder(exePath)
  const dir = steamAppsDir(exePath)
  if (!folder || !dir) return null
  let files
  try { files = readDir(dir) } catch { return null }
  for (const f of files) {
    if (!/^appmanifest_\d+\.acf$/i.test(f)) continue
    let text
    try { text = String(readFile(path.join(dir, f), 'utf8')) } catch { continue }
    const m = parseManifest(text)
    if (!m) continue
    if (m.installdir.toLowerCase() === folder.toLowerCase()) return m.name
  }
  return null
}

module.exports = { acfField, parseManifest, steamFolder, steamAppsDir, steamNameOf }
