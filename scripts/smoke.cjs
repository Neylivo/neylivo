// v1.290.0: смоук-тест собранного приложения. Запуск: npm run smoke
//
// Зачем он нужен именно такой. Типичная поломка в этом проекте — не «функция
// вернула не то», а «белый экран после сборки»: сломанный ленивый импорт,
// опечатка в имени экспорта, упавший провайдер, не подхватившийся стиль. Юнит-тесты
// такое не ловят, а замечается оно уже после выката.
//
// Поэтому тест поднимает НАСТОЯЩЕЕ окно Electron и грузит dist/index.html ровно
// тем же способом, что и боевое приложение (loadFile, см. electron/main.cjs:1350),
// а дальше смотрит, что React смонтировался, экран входа нарисован, в консоли нет
// ошибок и ни один ленивый кусок не утёк в стартовую загрузку.

const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
const WAIT_MS = 6000
// Потолок веса стартового js. Поднимать осознанно и только вместе с объяснением
// в сообщении коммита — иначе он бесшумно вернётся к прежнему полутора мегабайту.
// История: 1690 (v1.287) -> 1217 (v1.288) -> 1095 (v1.289) -> 966 (v1.291).
const ENTRY_BUDGET_KB = 1050

// Предупреждение Electron про отсутствие CSP видно только в незапакованном виде —
// оно само об этом пишет. Всё остальное считаем настоящей ошибкой.
const IGNORE = [/Electron Security Warning/i, /Content-Security-Policy/i, /unsafe-eval/i, /electronjs\.org\/docs\/tutorial\/security/i, /This warning will not show up/i, /once the app is packaged/i, /unnecessary security risks/i, /consult\s*$/i]
const ignorable = (m) => IGNORE.some(re => re.test(m))

// Куски, которых при старте быть НЕ должно: ради этого делались v1.288–v1.289,
// и без проверки один неосторожный статический импорт вернёт всё назад незаметно.
const MUST_BE_LAZY = ['livekit-client', 'Settings-', 'ServerSettings-', 'MusicPlayer-', 'CallRoom-', 'GameStatsModal-', 'WallDraw-', 'EmergencyChat-', 'DevPortal-']

const problems = []
const assets = []

if (!fs.existsSync(DIST)) {
  console.error('НЕ СОБРАНО: нет dist/index.html — сначала npm run build')
  process.exit(1)
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { backgroundThrottling: false } })

  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2 && !ignorable(msg)) problems.push(`ошибка в консоли: ${msg} (${src}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, d) => problems.push('процесс окна упал: ' + JSON.stringify(d)))
  win.webContents.on('did-fail-load', (_e, code, desc) => problems.push(`страница не загрузилась: ${desc} (${code})`))

  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*', 'file://*/*'] }, d => {
    const m = /\/assets\/([^/?#]+)/.exec(d.url)
    if (m) assets.push(m[1])
    // Supabase может быть недоступен или отвечать 401 без сессии — это не поломка
    // сборки, а среда запуска; всё остальное с кодом ошибки считаем проблемой.
    if (d.statusCode >= 400 && !/supabase|googleapis/.test(d.url)) {
      problems.push(`запрос вернул ${d.statusCode}: ${d.url}`)
    }
  })

  try {
    await win.loadFile(DIST)
  } catch (e) {
    problems.push('loadFile упал: ' + e.message)
  }
  await new Promise(r => setTimeout(r, WAIT_MS))

  let state = { mounted: 0, hasAuth: false, text: '' }
  try {
    state = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('root')
      return JSON.stringify({
        mounted: root ? root.children.length : 0,
        hasAuth: !!document.querySelector('.auth2, .auth2-card, .app'),
        text: (document.body.innerText || '').trim().slice(0, 120),
      })
    })()`))
  } catch (e) {
    problems.push('не удалось опросить страницу: ' + e.message)
  }

  if (!state.mounted) problems.push('React не смонтировался — #root пуст (белый экран)')
  if (!state.hasAuth) problems.push('не отрисован ни экран входа, ни приложение')
  if (!state.text) problems.push('на странице нет ни одного видимого символа')

  const leaked = MUST_BE_LAZY.filter(n => assets.some(a => a.includes(n)))
  if (leaked.length) {
    problems.push('в стартовую загрузку утекли куски, которые должны быть ленивыми: ' + leaked.join(', '))
  }

  console.log('--- смоук-тест ---')
  console.log('смонтировано узлов :', state.mounted)
  console.log('видимый текст      :', JSON.stringify(state.text.replace(/\s+/g, ' ')))
  console.log('файлов при старте  :', assets.length ? assets.join(', ') : '(ни одного)')
  // Проверки выше недостаточно: если ленивый импорт сделать обычным, отдельный
  // кусок просто ИСЧЕЗНЕТ, и «его нет при старте» пройдёт успешно — регресс
  // проскочит незамеченным. Поэтому ещё и потолок на вес стартового файла: он
  // ловит утяжеление любым способом. Сейчас ~1.02 МБ (v1.289.0), потолок с запасом.
  const entryName = assets.find(a => /^index-.*\.js$/.test(a))
  if (!entryName) {
    problems.push('не видно стартового js — проверка веса не отработала')
  } else {
    const kb = Math.round(fs.statSync(path.join(__dirname, '..', 'dist', 'assets', entryName)).size / 1024)
    console.log('вес стартового js  :', kb, 'КБ (потолок ' + ENTRY_BUDGET_KB + ')')
    if (kb > ENTRY_BUDGET_KB) {
      problems.push(`стартовый js вырос до ${kb} КБ при потолке ${ENTRY_BUDGET_KB} КБ — что-то попало в него зря`)
    }
  }

  console.log('')
  if (problems.length) {
    console.log('ПРОВАЛЕН, проблем: ' + problems.length)
    for (const p of problems) console.log('  • ' + p)
  } else {
    console.log('ПРОЙДЕН: приложение поднимается, ошибок нет, ленивые куски не грузятся при старте')
  }
  app.exit(problems.length ? 1 : 0)
})
