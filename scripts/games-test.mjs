// v1.453.0: распознавание игр. Запуск: npm run test:games
//
// Зачем. Название игры собирается в electron/main.cjs — файле, который целиком
// не запустить (там Electron). Из-за этого распознавание не проверялось НИЧЕМ:
// ошибку было видно только по тому, что у друга в активности написано
// «HogwartsLegacy» или «dota 2 beta» вместо названия игры.
//
// Теперь разбор манифеста Steam вынесен отдельным файлом (electron/steamName.cjs)
// и проверяется здесь на настоящих кусках .acf — тех самых, что лежат у Steam.
import { acfField, parseManifest, steamFolder, steamAppsDir, steamNameOf } from '../electron/steamName.cjs'

let pass = 0, fail = 0
const ok = n => { pass++; console.log('  ok   ' + n) }
const bad = (n, why) => { fail++; console.log('  ПРОВАЛ ' + n + (why ? ' — ' + why : '')) }
const check = (n, fn) => { try { fn() === false ? bad(n) : ok(n) } catch (e) { bad(n, e?.message ?? String(e)) } }

// Настоящий вид манифеста Steam — отступы табами, значения в кавычках.
const ACF_DOTA = `"AppState"
{
\t"appid"\t\t"570"
\t"name"\t\t"Dota 2"
\t"StateFlags"\t\t"4"
\t"installdir"\t\t"dota 2 beta"
\t"SizeOnDisk"\t\t"49000000000"
}`
const ACF_HOG = `"AppState"
{
\t"appid"\t\t"990080"
\t"name"\t\t"Hogwarts Legacy"
\t"installdir"\t\t"Hogwarts Legacy"
}`

console.log('── Название игры из манифеста Steam ──')

check('поле достаётся из .acf', () =>
  acfField(ACF_DOTA, 'name') === 'Dota 2' && acfField(ACF_DOTA, 'installdir') === 'dota 2 beta')
check('несуществующее поле — null', () => acfField(ACF_DOTA, 'нетакого') === null)
check('манифест разбирается целиком', () => {
  const m = parseManifest(ACF_DOTA)
  return m.name === 'Dota 2' && m.installdir === 'dota 2 beta'
})
check('обрывок манифеста не притворяется целым', () =>
  parseManifest('"AppState" {') === null && parseManifest('') === null)

check('папка игры достаётся из пути', () =>
  steamFolder('D:\\Steam\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe') === 'dota 2 beta')
check('путь мимо Steam папки не даёт', () =>
  steamFolder('C:\\Games\\Something\\game.exe') === null && steamFolder('') === null)
check('корень steamapps находится', () =>
  steamAppsDir('D:\\Steam\\steamapps\\common\\dota 2 beta\\dota2.exe') === 'D:\\Steam\\steamapps')
check('косые в любую сторону — Steam ставится и на другие диски', () =>
  steamFolder('D:/SteamLibrary/steamapps/common/Hogwarts Legacy/x.exe') === 'Hogwarts Legacy')

// Подкладываем свои читалки: настоящих файлов на этой машине может не быть.
const FILES = {
  'D:\\Steam\\steamapps\\appmanifest_570.acf': ACF_DOTA,
  'D:\\Steam\\steamapps\\appmanifest_990080.acf': ACF_HOG,
}
const readDir = () => ['appmanifest_570.acf', 'appmanifest_990080.acf', 'libraryfolders.vdf']
const readFile = p => {
  const key = Object.keys(FILES).find(k => p.replace(/\//g, '\\').endsWith(k.split('\\').pop()))
  if (!key) throw new Error('нет файла')
  return FILES[key]
}

check('служебная папка превращается в настоящее название', () =>
  steamNameOf('D:\\Steam\\steamapps\\common\\dota 2 beta\\dota2.exe', readDir, readFile) === 'Dota 2')
check('название без пробелов тоже исправляется', () =>
  steamNameOf('D:\\Steam\\steamapps\\common\\Hogwarts Legacy\\x.exe', readDir, readFile) === 'Hogwarts Legacy')
check('незнакомая папка — null, распознавание работает по-старому', () =>
  steamNameOf('D:\\Steam\\steamapps\\common\\НетТакой\\x.exe', readDir, readFile) === null)
check('не Steam — даже не читаем диск', () => {
  let читали = false
  const r = steamNameOf('C:\\Games\\X\\x.exe', () => { читали = true; return [] }, readFile)
  return r === null && !читали
})
check('нечитаемая папка не роняет распознавание', () =>
  steamNameOf('D:\\Steam\\steamapps\\common\\dota 2 beta\\x.exe', () => { throw new Error('отказ') }, readFile) === null)
check('битый манифест пропускается, а не ломает поиск', () => {
  const rf = p => (p.includes('570') ? 'мусор' : ACF_HOG)
  return steamNameOf('D:\\Steam\\steamapps\\common\\Hogwarts Legacy\\x.exe', readDir, rf) === 'Hogwarts Legacy'
})

console.log('\n── Ломаем нарочно ──')
check('проверка ловит возврат к имени папки', () => {
  // Ровно это и видели друзья: служебное имя папки вместо названия игры.
  const папка = steamFolder('D:\\Steam\\steamapps\\common\\dota 2 beta\\dota2.exe')
  return папка === 'dota 2 beta' && steamNameOf('D:\\Steam\\steamapps\\common\\dota 2 beta\\dota2.exe', readDir, readFile) !== папка
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
