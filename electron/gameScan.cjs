// v1.482.0: «Прохождения» — приложение смотрит, во что человек играет, по его
// же диску.
//
// Зачем. Владелец попросил систему отслеживания прогресса, как у WeMod: тот
// сам находит игры на компьютере, а не просит вводить их руками. У нас до сих
// пор было только про ЗАПУЩЕННУЮ игру (localProgress.cjs, v1.461.0): пока
// играешь — видно вехи, закрыл — и ничего.
//
// ЧТО ЧИТАЕМ И ГДЕ. Только там, где данные лежат сами и в понятном виде:
//
//   1. Steam. `libraryfolders.vdf` — где стоят библиотеки, `appmanifest_*.acf`
//      в каждой — что установлено (название, папка, размер, когда последний
//      раз запускали). `userdata/<id>/config/localconfig.vdf` — сколько минут
//      наиграно в каждую игру.
//   2. Сохранения. Обычные места для них — «Документы/My Games», «Документы/
//      Saved Games», `%APPDATA%` и `%LOCALAPPDATA%`. Оттуда берём только два
//      числа: сколько файлов сохранения и когда последнее.
//   3. Вехи. Их уже умеет localProgress.cjs — и для лицензии, и для
//      нелицензионных копий (эмуляторы пишут свои файлы).
//
// ЧЕГО МЫ НЕ ДЕЛАЕМ, и это важно.
//
//   • НЕ обходим весь диск. Обход «всего» — это минуты работы, греющийся
//     вентилятор и чтение чужих папок без спроса. Смотрим известные места.
//   • НЕ читаем содержимое сохранений. Формат у каждой игры свой, и «глава 4
//     из 12» без знания формата взять неоткуда. Врать про сюжет мы не будем:
//     показываем то, что правда известно — часы, дату, число сохранений, вехи.
//   • НЕ отправляем ничего на сервер. Список остаётся на этом компьютере, пока
//     человек сам не решит им поделиться.
//
// Проверки: npm run test:games (разбор форматов) и живой прогон на настоящей
// машине.
const fs = require('fs')
const path = require('path')

// ── Разбор форматов Valve ───────────────────────────────────────────────────

/**
 * Пути библиотек из libraryfolders.vdf.
 *
 * Формат менялся: раньше это были "1" "D:\\Games", теперь блок с "path". Ловим
 * оба — на машине человека может стоять Steam любой давности.
 */
function parseLibraryFolders(text) {
  const s = String(text || '')
  const out = []
  for (const m of s.matchAll(/"path"\s*"([^"]+)"/gi)) out.push(m[1].replace(/\\\\/g, '\\'))
  if (out.length === 0) {
    for (const m of s.matchAll(/"\d+"\s*"([A-Za-z]:\\\\[^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'))
  }
  return [...new Set(out)]
}

/** Одна установленная игра из appmanifest_*.acf. */
function parseAcf(text) {
  const s = String(text || '')
  const поле = (k) => (s.match(new RegExp('"' + k + '"\\s*"([^"]*)"', 'i')) || [])[1] || ''
  const appId = поле('appid')
  if (!appId) return null
  const число = (k) => Number(поле(k)) || 0
  return {
    appId,
    name: поле('name'),
    installDir: поле('installdir'),
    sizeBytes: число('SizeOnDisk'),
    lastPlayed: число('LastPlayed'),       // секунды, 0 — ни разу
    lastUpdated: число('LastUpdated'),
  }
}

/**
 * Сколько минут наиграно, по номеру игры — из localconfig.vdf.
 *
 * Идём не регуляркой по всему файлу, а по блокам «"<appid>" { … }» внутри
 * раздела Apps: числа Playtime встречаются и в других местах файла, и без
 * привязки к блоку они склеились бы с чужими.
 */
function parsePlaytime(text) {
  const s = String(text || '')
  const out = {}
  const i = s.search(/"Apps"\s*\n?\s*\{/i)
  if (i < 0) return out

  // Идём ПО СКОБКАМ, а не по отступам. Первая попытка ловила конец блока по
  // «пять табов и закрывающая», и на настоящем файле половина игр оставалась с
  // нулевыми часами: у разных записей разная вложенность. Поймано живым
  // прогоном на машине владельца, а не рассуждением.
  const начало = s.indexOf('{', i)
  let глубина = 0, j = начало
  for (; j < s.length; j++) {
    if (s[j] === '{') глубина++
    else if (s[j] === '}') { глубина--; if (глубина === 0) { j++; break } }
  }
  const тело = s.slice(начало + 1, j - 1)

  // Внутри — блоки «"<appid>" { … }» первого уровня.
  let k = 0
  while (k < тело.length) {
    const m = /"(\d+)"\s*\n?\s*\{/g
    m.lastIndex = k
    const нашли = m.exec(тело)
    if (!нашли) break
    let г = 0, e = нашли.index + нашли[0].length - 1
    for (; e < тело.length; e++) {
      if (тело[e] === '{') г++
      else if (тело[e] === '}') { г--; if (г === 0) break }
    }
    const кусок = тело.slice(нашли.index, e + 1)
    const мин = Number((кусок.match(/"Playtime"\s*"(\d+)"/i) || [])[1] || 0)
    const посл = Number((кусок.match(/"LastPlayed"\s*"(\d+)"/i) || [])[1] || 0)
    if (мин || посл) {
      const было = out[нашли[1]]
      out[нашли[1]] = {
        minutes: Math.max(мин, было ? было.minutes : 0),
        lastPlayed: Math.max(посл, было ? было.lastPlayed : 0),
      }
    }
    k = e + 1
  }
  return out
}

/** Человеческое время игры. Минуты — это то, что отдаёт Steam. */
function hoursLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return m + ' мин'
  const ч = Math.floor(m / 60)
  const ост = m % 60
  return ост ? ч + ' ч ' + ост + ' мин' : ч + ' ч'
}

// ── Обход известных мест ────────────────────────────────────────────────────

const читать = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const есть = (p) => { try { return fs.existsSync(p) } catch { return false } }
const список = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }) } catch { return [] } }

/** Где может стоять Steam. Тот же список, что и у чтения вех. */
function steamRoots(env = process.env) {
  const out = []
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const pf = env.ProgramFiles || 'C:\\Program Files'
  const local = env.LOCALAPPDATA || ''
  out.push(path.join(pf86, 'Steam'), path.join(pf, 'Steam'))
  if (local) out.push(path.join(local, 'Steam'))
  return out.filter(есть)
}

/** Все библиотеки Steam: и та, что рядом с ним, и вынесенные на другие диски. */
function steamLibraries(roots) {
  const out = []
  for (const r of roots) {
    const sa = path.join(r, 'steamapps')
    if (есть(sa)) out.push(sa)
    const lf = path.join(sa, 'libraryfolders.vdf')
    for (const p of parseLibraryFolders(читать(lf))) {
      const x = path.join(p, 'steamapps')
      if (есть(x)) out.push(x)
    }
  }
  return [...new Set(out)]
}

/** Сколько сохранений в папке и когда последнее. Вглубь — не больше трёх слоёв:
 *  сохранения лежат близко, а бесконечный обход — это чужие файлы и минуты. */
function saveStats(dir, глубина = 3) {
  let count = 0, last = 0
  const очередь = [{ dir, d: 0 }]
  while (очередь.length) {
    const { dir: d, d: у } = очередь.shift()
    for (const e of список(d)) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (у < глубина) очередь.push({ dir: p, d: у + 1 })
        continue
      }
      if (!/\.(sav|save|dat|json|bin|slot|profile|ess|es3|sl2|zip)$/i.test(e.name)) continue
      count++
      try {
        const t = fs.statSync(p).mtimeMs
        if (t > last) last = t
      } catch { /* файл занят игрой — не беда */ }
      if (count > 400) return { count, last }   // хватит: нам нужно «есть и когда»
    }
  }
  return { count, last }
}

/** Обычные места сохранений. Игра сама решает, куда писать, — вариантов немного. */
function saveRoots(env = process.env) {
  const home = env.USERPROFILE || ''
  const out = []
  if (home) {
    out.push(path.join(home, 'Documents', 'My Games'))
    out.push(path.join(home, 'Documents', 'Saved Games'))
    out.push(path.join(home, 'Saved Games'))
    out.push(path.join(home, 'Documents'))
  }
  if (env.APPDATA) out.push(env.APPDATA)
  if (env.LOCALAPPDATA) out.push(env.LOCALAPPDATA)
  return out.filter(есть)
}

/** Сопоставление «игра ↔ папка сохранений» по названию. Точного способа нет:
 *  игры называют папки как хотят, поэтому сравниваем по упрощённому имени. */
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .replace(/[^a-zа-я0-9]+/gi, '')
}

function findSaves(gameName, roots) {
  const цель = normName(gameName)
  if (цель.length < 3) return null
  for (const r of roots) {
    for (const e of список(r)) {
      if (!e.isDirectory()) continue
      const имя = normName(e.name)
      if (имя !== цель && !(имя.length > 4 && цель.includes(имя)) && !(цель.length > 4 && имя.includes(цель))) continue
      const st = saveStats(path.join(r, e.name))
      if (st.count > 0) return { dir: path.join(r, e.name), ...st }
    }
  }
  return null
}

/**
 * Игры, которых нет в библиотеке Steam, но прохождение по ним записано.
 *
 * v1.483.0. Владелец принёс: «сюжет ничего не показывает, особенно когда
 * пиратка». Причина оказалась простой и обидной: список игр строился ТОЛЬКО по
 * манифестам Steam, а нелицензионная копия в них не значится вовсе — то есть
 * достижения на диске лежали, а спросить про них было некому.
 *
 * Эмуляторы держат их по номеру игры в своих папках: Goldberg, CODEX, RUNE,
 * SmartSteamEmu. Каждая подпапка — это appid, то есть игра, в которую человек
 * играл.
 */
function emulatorGames(env = process.env) {
  const места = []
  if (env.APPDATA) {
    места.push(path.join(env.APPDATA, 'Goldberg SteamEmu Saves'))
    места.push(path.join(env.APPDATA, 'SmartSteamEmu'))
  }
  if (env.PUBLIC) {
    места.push(path.join(env.PUBLIC, 'Documents', 'Steam', 'CODEX'))
    места.push(path.join(env.PUBLIC, 'Documents', 'Steam', 'RUNE'))
  }
  const out = new Map()
  for (const м of места) {
    for (const e of список(м)) {
      if (!e.isDirectory() || !/^\d+$/.test(e.name)) continue
      let когда = 0
      try { когда = fs.statSync(path.join(м, e.name)).mtimeMs } catch { /* нет доступа */ }
      const было = out.get(e.name)
      if (!было || когда > было.lastPlayed) out.set(e.name, { appId: e.name, lastPlayed: когда, from: path.basename(м) })
    }
  }
  return [...out.values()]
}

/**
 * Всё, что удалось узнать про игры на этом компьютере.
 *
 * `progressOf` — та самая функция чтения вех (localProgress). Отдаём её
 * доводом, чтобы обход можно было проверить без неё.
 */
function scanGames(io = {}) {
  const env = io.env || process.env
  const roots = steamRoots(env)
  const libs = steamLibraries(roots)
  const saves = saveRoots(env)

  // Часы: берём из учётной записи, под которой играли последней.
  let playtime = {}
  for (const r of roots) {
    for (const u of список(path.join(r, 'userdata'))) {
      if (!u.isDirectory()) continue
      const p = path.join(r, 'userdata', u.name, 'config', 'localconfig.vdf')
      const прочитано = parsePlaytime(читать(p))
      for (const [id, v] of Object.entries(прочитано)) {
        const было = playtime[id]
        if (!было || v.minutes > было.minutes) playtime[id] = v
      }
    }
  }

  const игры = []
  for (const lib of libs) {
    for (const e of список(lib)) {
      if (!e.isFile() || !/^appmanifest_\d+\.acf$/i.test(e.name)) continue
      const g = parseAcf(читать(path.join(lib, e.name)))
      if (!g || !g.name) continue
      const pt = playtime[g.appId] || { minutes: 0, lastPlayed: 0 }
      const где = path.join(lib, 'common', g.installDir)
      игры.push({
        appId: g.appId,
        name: g.name,
        dir: есть(где) ? где : null,
        sizeBytes: g.sizeBytes,
        minutes: pt.minutes,
        hours: hoursLabel(pt.minutes),
        lastPlayed: Math.max(g.lastPlayed, pt.lastPlayed) * 1000,
        saves: null,
        source: 'steam',
      })
    }
  }

  // Сохранения — по названию игры. Медленная часть, поэтому только для тех, во
  // что правда играли: у игры, которую ни разу не запускали, сохранений нет.
  for (const g of игры) {
    if (!g.lastPlayed && !g.minutes) continue
    g.saves = findSaves(g.name, saves)
  }

  // Игры вне Steam: они есть у каждого, кто играет в нелицензионные копии, и
  // раньше их не было видно вовсе. Название взять неоткуда — показываем номер,
  // а приложение подставит настоящее имя, когда узнает его из магазина.
  const известные = new Set(игры.map(g => g.appId))
  for (const e of emulatorGames(env)) {
    if (известные.has(e.appId)) continue
    игры.push({
      appId: e.appId,
      name: 'Игра ' + e.appId,
      dir: null,
      sizeBytes: 0,
      minutes: 0,
      hours: '—',
      lastPlayed: e.lastPlayed,
      saves: null,
      source: 'emu:' + e.from,
    })
  }

  игры.sort((a, b) => (b.lastPlayed - a.lastPlayed) || (b.minutes - a.minutes))
  return { games: игры, libraries: libs, checkedAt: Date.now() }
}

module.exports = {
  parseLibraryFolders, parseAcf, parsePlaytime, hoursLabel,
  steamRoots, steamLibraries, saveRoots, findSaves, normName, saveStats, scanGames, emulatorGames,
}
