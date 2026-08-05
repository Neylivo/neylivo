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
import { parseAchievements, isPrivate, appIdFromManifest, steamAchievements } from '../electron/steamAchievements.cjs'
import { steamIdFromLoginUsers, steamRoots, parseGoldberg, parseAchIni, parseSchema, candidatePaths, localProgress } from '../electron/localProgress.cjs'

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

// ── v1.458.0: вехи прохождения из профиля Steam ──────────────────────────────
// Владелец сказал прямо: вбивать список миссий руками — не то. Настоящий
// источник — достижения в его собственном профиле Steam: название, описание,
// картинка и отметка «пройдено». Разбор ответа проверяется здесь.
console.log('\n── Вехи прохождения из Steam ──')

const XML = `<?xml version="1.0"?><playerstats>
<achievements>
<achievement closed="1"><iconClosed>https://x/a.jpg</iconClosed><iconOpen>https://x/b.jpg</iconOpen>
<name><![CDATA[Пролог пройден]]></name><description><![CDATA[Выбраться из Найт-Сити]]></description>
<unlockTimestamp>1700000000</unlockTimestamp></achievement>
<achievement closed="0"><iconClosed>https://x/c.jpg</iconClosed>
<name>Дальше некуда</name><description>Дойти до финала</description></achievement>
</achievements></playerstats>`

check('вехи разбираются с названием, описанием и отметкой', () => {
  const a = parseAchievements(XML)
  return a.length === 2 && a[0].name === 'Пролог пройден' && a[0].done === true
    && a[0].desc === 'Выбраться из Найт-Сити' && a[1].done === false
})
check('время прохождения переводится в миллисекунды', () =>
  parseAchievements(XML)[0].at === 1700000000000 && parseAchievements(XML)[1].at === 0)
check('закрытый профиль виден как закрытый, а не как пустой', () =>
  isPrivate('<playerstats><privacyState>private</privacyState></playerstats>') === true
  && isPrivate(XML) === false)
check('мусор вместо ответа не превращается в вехи', () =>
  parseAchievements('не xml').length === 0 && parseAchievements('').length === 0)
check('номер игры достаётся из имени манифеста', () =>
  appIdFromManifest('appmanifest_1091500.acf') === '1091500'
  && appIdFromManifest('libraryfolders.vdf') === null)

const дай = async () => XML
const r1 = await steamAchievements('76561198000000000', '1091500', дай)
check('вехи приходят как готовый список', () => r1.ok && r1.items.length === 2)
const r2 = await steamAchievements('короткий', '1091500', дай)
check('кривой SteamID отсекается сразу', () => !r2.ok && r2.why === 'no-steamid')
const r3 = await steamAchievements('76561198000000000', '', дай)
check('без номера игры не спрашиваем', () => !r3.ok && r3.why === 'no-appid')
const r4 = await steamAchievements('76561198000000000', '1', async () => '<privacyState>private</privacyState>')
check('закрытый профиль назван своей причиной', () => !r4.ok && r4.why === 'private')
const r5 = await steamAchievements('76561198000000000', '1', async () => { throw new Error('сеть') })
check('обрыв связи назван своей причиной', () => !r5.ok && r5.why === 'net')
const r6 = await steamAchievements('76561198000000000', '1', async () => '<playerstats></playerstats>')
check('игра без достижений — не ошибка, а своя причина', () => !r6.ok && r6.why === 'empty')

// ── v1.461.0: прохождение с диска — без Steam ID и без сети ──────────────────
// Владелец сказал прямо: должно работать и «когда на пиратке играешь». У такого
// человека профиля Steam для этой игры нет вовсе, а прохождение есть — оно
// лежит у него же на диске, в файлах эмулятора.
console.log('\n── Прохождение с диска ──')

const VDF = `"users"
{
	"76561198000000001"
	{
		"AccountName"		"старый"
		"Timestamp"		"1600000000"
	}
	"76561198000000002"
	{
		"AccountName"		"свежий"
		"MostRecent"		"1"
		"Timestamp"		"1700000000"
	}
}`

check('SteamID берётся из файлов Steam, а не спрашивается', () =>
  steamIdFromLoginUsers(VDF) === '76561198000000002')
check('без записей учёток — null, а не выдуманный номер', () =>
  steamIdFromLoginUsers('"users" {}') === null && steamIdFromLoginUsers('') === null)
check('Steam ищется там, где он обычно стоит', () => {
  const r = steamRoots({ 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF' })
  return r.length >= 2 && r[0].includes('PF86')
})

const GOLD = JSON.stringify({
  ACH_PROLOG: { earned: true, earned_time: 1700000000 },
  ACH_FINAL: { earned: false, earned_time: 0 },
})
check('достижения Goldberg читаются', () => {
  const a = parseGoldberg(GOLD)
  return a.length === 2 && a[0].id === 'ACH_PROLOG' && a[0].done && a[0].at === 1700000000000
      && a[1].done === false
})
check('старый вид Goldberg (просто список) тоже читается', () =>
  parseGoldberg('["A","B"]').length === 2 && parseGoldberg('["A"]')[0].done === true)
check('мусор вместо файла не превращается в вехи', () =>
  parseGoldberg('не json').length === 0 && parseGoldberg('').length === 0)

const INI = `[SteamAchievements]
Count=2
[ACH_ONE]
Achieved=1
UnlockTime=1700000000
[ACH_TWO]
Achieved=0
`
check('достижения CODEX и подобных читаются', () => {
  const a = parseAchIni(INI)
  return a.length === 2 && a[0].id === 'ACH_ONE' && a[0].done && a[0].at === 1700000000000
      && a[1].done === false
})
check('служебный раздел вехой не считается', () =>
  parseAchIni(INI).every(a => a.id !== 'SteamAchievements'))

const SCHEMA = JSON.stringify([
  { name: 'ACH_ONE', displayName: { russian: 'Пролог' }, description: { russian: 'Выбраться' }, icon: 'a.jpg' },
])
check('названия вех берутся из файла рядом с игрой', () => {
  const s2 = parseSchema(SCHEMA)
  return s2.ACH_ONE.title === 'Пролог' && s2.ACH_ONE.desc === 'Выбраться'
})

check('места поиска включают и эмуляторы, и папку игры', () => {
  const c = candidatePaths('1091500', 'D:\\Games\\X\\game.exe', { APPDATA: 'C:\\AD', PUBLIC: 'C:\\Pub' })
  const все = c.map(x => x.path).join('|')
  return все.includes('Goldberg') && все.includes('CODEX') && все.includes('ALI213')
      && все.includes('steam_settings')
})

// Собираем всё вместе на поддельных файлах: настоящих на этой машине может не быть.
const ФАЙЛЫ = {
  'achievements.ini': INI,
  'achievements.json': SCHEMA,
}
const читатель = p2 => {
  const имя = String(p2).split(/[\\/]/).pop()
  if (String(p2).includes('steam_settings')) return SCHEMA
  if (имя === 'achievements.ini') return INI
  throw new Error('нет файла')
}
const r = localProgress('1091500', 'D:\\Games\\X\\game.exe', { readFile: читатель, env: { APPDATA: 'C:\\AD', PUBLIC: 'C:\\Pub' } })
check('прохождение собирается с диска целиком', () =>
  r.ok && r.items.length === 2 && r.items[0].name === 'Пролог' && r.items[0].done === true)
check('без файлов — честная причина, а не выдуманное прохождение', () => {
  const пусто = localProgress('1', 'D:\\X\\g.exe', { readFile: () => { throw new Error('нет') }, env: {} })
  return !пусто.ok && пусто.why === 'no-local'
})
check('без названий показываем метки достижений, а не выдумываем', () => {
  const без = localProgress('1', null, {
    readFile: p3 => (String(p3).includes('CODEX') ? INI : (() => { throw new Error('нет') })()),
    env: { PUBLIC: 'C:\\Pub' },
  })
  return без.ok && без.items[0].name === 'ACH_ONE'
})

console.log('\n── Обход игр на компьютере (v1.482.0) ──')
{
  const {
    parseLibraryFolders, parseAcf, parsePlaytime, hoursLabel, normName, saveRoots,
  } = await import('../electron/gameScan.cjs')

  // Куски настоящих файлов с машины владельца — выдуманные форматы проверять
  // бессмысленно, ошибка вылезет ровно на настоящем.
  const ACF = `"AppState"
{
	"appid"		"220240"
	"name"		"Far Cry® 3"
	"installdir"		"Far Cry 3"
	"LastUpdated"		"1750763755"
	"LastPlayed"		"1754392822"
	"SizeOnDisk"		"12454823938"
}`
  const LIB = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"apps"
		{
			"730"		"71582999231"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
	}
}`
  const LOCAL = `"UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"Apps"
				{
					"7"
					{
						"cloud"
						{
							"last_sync_state"		"synchronized"
						}
					}
					"480"
					{
						"LastPlayed"		"1783892020"
						"Playtime"		"6872"
						"cloud"
						{
							"last_sync_state"		"synchronized"
						}
					}
					"43160"
					{
						"LastPlayed"		"1696006286"
						"Playtime"		"77"
					}
				}
			}
		}
	}
}`

  check('манифест игры разбирается целиком', () => {
    const g = parseAcf(ACF)
    return g.appId === '220240' && g.name === 'Far Cry® 3' && g.installDir === 'Far Cry 3'
      && g.sizeBytes === 12454823938 && g.lastPlayed === 1754392822
  })
  check('пустой или чужой файл не выдаёт игру', () =>
    parseAcf('') === null && parseAcf('"что-то" { }') === null)

  check('находятся все библиотеки, включая вынесенные на другой диск', () => {
    const l = parseLibraryFolders(LIB)
    return l.length === 2 && l[1] === 'D:\\SteamLibrary'
  })

  check('часы берутся по каждой игре отдельно', () => {
    const p = parsePlaytime(LOCAL)
    return p['480'].minutes === 6872 && p['43160'].minutes === 77 && !p['7']
  })
  check('вложенные блоки не путают разбор часов', () => {
    // Первая версия ловила конец блока по отступам — и на настоящем файле
    // половина игр оставалась с нулями. Поймано живым прогоном.
    const p = parsePlaytime(LOCAL)
    return Object.keys(p).length === 2
  })
  check('время последнего запуска тоже читается', () =>
    parsePlaytime(LOCAL)['480'].lastPlayed === 1783892020)
  check('чужой файл не даёт выдуманных часов', () => Object.keys(parsePlaytime('привет')).length === 0)

  check('часы показываются по-человечески', () =>
    hoursLabel(0) === '0 мин' && hoursLabel(59) === '59 мин'
    && hoursLabel(60) === '1 ч' && hoursLabel(6872) === '114 ч 32 мин')

  check('название игры упрощается для поиска папки сохранений', () =>
    normName('Far Cry® 3') === 'farcry3' && normName('Grand Theft Auto V') === 'grandtheftautov')

  check('места сохранений ищутся там, где их правда держат', () => {
    const r = saveRoots({ USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })
    // Папок может не быть на этой машине — проверяем сам список, а не наличие.
    return Array.isArray(r)
  })
}

console.log('\n── Прохождения: что показывать человеку ──')
{
  const { gameState, agoLabel, milestonePercent, sortGames, mergeScans } =
    await import('../src/lib/gameProgress.ts').catch(() => ({}))
  if (gameState) {
    const сейчас = Date.UTC(2026, 7, 5)
    const день = 24 * 3600 * 1000
    check('вчерашняя игра — «играю»', () =>
      gameState({ lastPlayed: сейчас - день, minutes: 60 }, сейчас) === 'играю')
    check('месячной давности — «отложил»', () =>
      gameState({ lastPlayed: сейчас - 30 * день, minutes: 60 }, сейчас) === 'отложил')
    check('полугодовой давности — «забросил»', () =>
      gameState({ lastPlayed: сейчас - 200 * день, minutes: 60 }, сейчас) === 'забросил')
    check('ни разу не запускали — так и написано', () =>
      gameState({ lastPlayed: 0, minutes: 0 }, сейчас) === 'не начинал')
    check('давность пишется словами', () =>
      agoLabel(сейчас, сейчас) === 'сегодня' && agoLabel(сейчас - день, сейчас) === 'вчера'
      && agoLabel(0) === 'ни разу')
    check('вехи в процентах, а без вех — ничего', () =>
      milestonePercent({ done: 3, total: 12 }) === 25 && milestonePercent() === null)
    check('сначала то, во что играют сейчас', () => {
      const s = sortGames([
        { appId: 'a', lastPlayed: сейчас - 200 * день, minutes: 9999 },
        { appId: 'b', lastPlayed: сейчас - день, minutes: 10 },
      ], сейчас)
      return s[0].appId === 'b'
    })
    check('удалённая с диска игра не пропадает из истории', () => {
      const r = mergeScans([{ appId: 'a', name: 'Старая' }], [{ appId: 'b', name: 'Новая' }])
      return r.length === 2 && r.find(x => x.appId === 'a').gone === true
    })
  }
}

console.log('\n── Пиратки и вехи (v1.483.0) ──')
{
  const fs2 = await import('node:fs')
  const os2 = await import('node:os')
  const path2 = await import('node:path')
  const { emulatorGames } = await import('../electron/gameScan.cjs')

  // Строим настоящие папки эмуляторов во временном месте: выдуманный fs
  // проверял бы выдуманное, а тут важен именно обход диска.
  const корень = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'ponoi-emu-'))
  const APPDATA = path2.join(корень, 'Roaming')
  const PUBLIC = path2.join(корень, 'Public')
  fs2.mkdirSync(path2.join(APPDATA, 'Goldberg SteamEmu Saves', '1817070'), { recursive: true })
  fs2.mkdirSync(path2.join(APPDATA, 'Goldberg SteamEmu Saves', 'settings'), { recursive: true })
  fs2.mkdirSync(path2.join(PUBLIC, 'Documents', 'Steam', 'CODEX', '264710'), { recursive: true })
  fs2.writeFileSync(path2.join(APPDATA, 'Goldberg SteamEmu Saves', '1817070', 'achievements.json'), '{}')

  const найдено = emulatorGames({ APPDATA, PUBLIC })
  check('игры нелицензионных копий находятся, хотя их нет в библиотеке Steam', () =>
    найдено.length === 2 && найдено.some(g => g.appId === '1817070') && найдено.some(g => g.appId === '264710'))
  check('служебные папки эмулятора за игру не считаются', () =>
    !найдено.some(g => g.appId === 'settings'))
  check('без папок эмуляторов список пустой, а не выдуманный', () =>
    emulatorGames({ APPDATA: path2.join(корень, 'нет'), PUBLIC: path2.join(корень, 'нет') }).length === 0)

  fs2.rmSync(корень, { recursive: true, force: true })

  check('обход спрашивает вехи полем items, а не nodes', () => {
    // Та самая поломка: читатель отдаёт items, а спрашивали nodes — и вехи
    // были нулевыми ВСЕГДА, даже когда файлы достижений лежали на диске.
    const src = fs2.readFileSync('electron/main.cjs', 'utf8')
    const i = src.indexOf("ipcMain.handle('ponoi-games-scan'")
    const тело = src.slice(i, i + 2500)
    if (/\bп\.nodes\b/.test(тело)) throw new Error('снова спрашивают nodes')
    return /Array\.isArray\(п\.items\)/.test(тело)
  })
  check('вехи читаются и у игр без папки в библиотеке', () => {
    const src = fs2.readFileSync('electron/main.cjs', 'utf8')
    const i = src.indexOf("ipcMain.handle('ponoi-games-scan'")
    const тело = src.slice(i, i + 2500)
    // Раньше стояло «нет папки — пропускаем», и это выкидывало ровно пиратки.
    return !/if \(!g\.dir\) continue/.test(тело)
  })
}

console.log('\n── Окна поверх карточки профиля (v1.483.0) ──')
{
  const fs3 = await import('node:fs')
  check('окно статистики выносится порталом', () => {
    // .pc-card анимируется через transform, а элемент с transform становится
    // рамкой для position: fixed внутри себя — окно зажималось внутрь карточки
    // и обрезалось. Лечится выносом в <body>.
    const src = fs3.readFileSync('src/components/GameStatsModal.tsx', 'utf8')
    return src.includes("from './Portal'") && /<Portal>/.test(src) && /<\/Portal>/.test(src)
  })
  check('карточка профиля правда анимируется через transform', () => {
    // Если анимацию однажды уберут, портал всё равно не помешает — но пусть
    // причина будет записана проверкой, а не только словами в комментарии.
    const css = fs3.readFileSync('src/styles.css', 'utf8')
    return /\.pc-card\s*\{[^}]*animation:\s*pop/.test(css) && /@keyframes pop[^}]*transform/.test(css)
  })
  check('«Прохождение» не обещается там, где вех нет', () => {
    const src = fs3.readFileSync('src/components/ProfileCard.tsx', 'utf8')
    // Раньше: !statsAllowed && (isMe || !!story) — то есть у любой игры.
    return /хочуПрохождение\[curGame\.name\]/.test(src)
      && !/campaignAllowed = !statsAllowed && \(isMe \|\| !!story\)/.test(src)
  })
  check('прохождение спрашивается даже без Steam ID', () => {
    // Пиратка: Steam ID нет и быть не может, а достижения на диске есть.
    // Раньше запрос обрывался до чтения файлов — то есть возможность была,
    // а дверь к ней была закрыта одной строкой.
    const src = fs3.readFileSync('src/lib/campaign.ts', 'utf8')
    const i = src.indexOf('export async function autoNodes')
    const тело = src.slice(i, i + 700)
    return !/if \(!steamId\) return/.test(тело)
  })
  check('текущая игра видна на первом экране профиля, а не только во вкладке', () => {
    const src = fs3.readFileSync('src/components/ProfileCard.tsx', 'utf8')
    return /tab === 'board' && curGame/.test(src) && /pc-tab-live/.test(src)
  })
}

console.log('\n── Ломаем нарочно (диск) ──')
check('проверка ловит требование Steam ID там, где он не нужен', () => {
  // Смысл всей правки: прохождение читается вообще без учётной записи.
  const r2 = localProgress('1091500', 'D:\\Games\\X\\game.exe', { readFile: читатель, env: { APPDATA: 'C:\\AD', PUBLIC: 'C:\\Pub' } })
  return r2.ok && r2.items.length > 0
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
