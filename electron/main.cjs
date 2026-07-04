const { app, BrowserWindow, shell, session, desktopCapturer, ipcMain } = require('electron')
const path = require('path')

const isDev = !app.isPackaged

// ---- Авто-детект игр (как в Discord) ----
// Раз в 20 секунд смотрим процессы Windows (tasklist). Рендереру шлём событие ТОЛЬКО
// при старте/выходе из игры ({ name, since } | null) — таймер тикает у зрителей сам.
const GAMES = {
  'cs2.exe': 'Counter-Strike 2',
  'csgo.exe': 'CS:GO',
  'dota2.exe': 'Dota 2',
  'valorant.exe': 'VALORANT',
  'valorant-win64-shipping.exe': 'VALORANT',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends',
  'league of legends.exe': 'League of Legends',
  'rocketleague.exe': 'Rocket League',
  'gta5.exe': 'GTA V',
  'rustclient.exe': 'Rust',
  'tslgame.exe': 'PUBG',
  'overwatch.exe': 'Overwatch 2',
  'minecraft.windows.exe': 'Minecraft',
  'javaw.exe': 'Minecraft (Java)',
  'robloxplayerbeta.exe': 'Roblox',
  'eldenring.exe': 'Elden Ring',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'genshinimpact.exe': 'Genshin Impact',
  'aces.exe': 'War Thunder',
  'worldoftanks.exe': 'World of Tanks',
  'osu!.exe': 'osu!',
  'terraria.exe': 'Terraria',
  'stardewvalley.exe': 'Stardew Valley',
  'factorio.exe': 'Factorio',
  'hollowknight.exe': 'Hollow Knight',
}
let curGame = null   // { name, since } | null

function broadcastGame() {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('ponoi-game', curGame) } catch {}
  }
}

// ---- Поиск обложки игры (магазин Steam, без ключей) ----
// Вызывается рендерером через IPC; ищем в main-процессе (Node, нет CORS).
const coverCache = new Map()   // name -> url | null (кэш на время работы приложения)
function httpJson(u) {
  return new Promise((resolve) => {
    const https = require('https')
    const req = https.get(u, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(8000, () => { try { req.destroy() } catch {} resolve(null) })
  })
}
// v1.28.0: два источника обложек. Steam покрывает ПК-игры, iTunes Search — не-стимовские
// (Roblox, Fortnite, VALORANT и т.п. — у них есть iOS-версии с квадратными иконками).
async function findCover(name) {
  if (!name) return null
  if (coverCache.has(name)) return coverCache.get(name)
  const term = name.replace(/\(.*?\)/g, '').trim()   // «Minecraft (Java)» -> «Minecraft»
  let url = null
  const st = await httpJson('https://store.steampowered.com/api/storesearch/?l=en&cc=US&term=' + encodeURIComponent(term))
  const item = ((st && st.items) || [])[0]
  if (item) url = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + item.id + '/header.jpg'
  if (!url) {
    const it = await httpJson('https://itunes.apple.com/search?media=software&limit=3&term=' + encodeURIComponent(term))
    const w = term.split(/\s+/)[0].toLowerCase()
    const app = ((it && it.results) || []).find((a) => String(a.trackName || '').toLowerCase().includes(w))
    if (app) url = app.artworkUrl512 || app.artworkUrl100 || null
  }
  coverCache.set(name, url)
  return url
}
ipcMain.handle('ponoi-find-cover', (_e, name) => findCover(String(name || '')))

// Строгий детект (v1.27.0): никакой «фейковой» активности.
// (1) javaw.exe — это любое Java-приложение: Minecraft'ом считаем только если
//    заголовок окна содержит «minecraft» (tasklist /v отдаёт заголовки окон).
// (2) Старт игры публикуем только после двух сканов подряд (~20 сек), чтобы не
//    ловить мгновенные/служебные процессы; закрытие игры гасим сразу.
let pendingGame = null   // кандидат на старт: { name, at }
function scanGames() {
  if (process.platform !== 'win32') return
  const { execFile } = require('child_process')
  execFile('tasklist.exe', ['/fo', 'csv', '/nh', '/v'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
    if (err || !out) return
    let found = null
    for (const line of String(out).split('\n')) {
      const cols = line.match(/"[^"]*"/g)
      if (!cols || cols.length < 2) continue
      const exe = cols[0].slice(1, -1).toLowerCase()
      const nm = GAMES[exe]
      if (!nm) continue
      if (exe === 'javaw.exe') {
        const title = cols[cols.length - 1].slice(1, -1).toLowerCase()
        if (!title.includes('minecraft')) continue
      }
      found = nm
      break
    }
    if (found) {
      if (curGame && curGame.name === found) { pendingGame = null; return }   // уже играет — молчим
      if (pendingGame && pendingGame.name === found) {                        // подтверждено вторым сканом
        curGame = { name: found, since: pendingGame.at }
        pendingGame = null
        broadcastGame()
      } else {
        pendingGame = { name: found, at: Date.now() }                         // ждём подтверждения вторым сканом
      }
      return
    }
    pendingGame = null
    if (curGame) { curGame = null; broadcastGame() }   // игра закрылась — гасим сразу
  })
}

// ---- Неоновый splash при запуске (компактный, как у Discord) ----
// Frameless-окно 340x320: логотип и статус запуска. Пока оно крутится,
// приложение готовится и проверяет обновления; затем схлопывается.
let splash = null
const SPLASH_MIN_MS = 1100   // v1.31.0: короче — приложение стартует заметно быстрее
let splashShownAt = 0

function createSplash() {
  splash = new BrowserWindow({
    width: 340,
    height: 320,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'ponoi',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  splashShownAt = Date.now()
  splash.on('closed', () => { splash = null })
}

let appShown = false   // v1.31.2: страховки могут дёрнуть повторно — показываем окно один раз
function closeSplashAndShow(win) {
  if (appShown) return
  appShown = true
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt))
  setTimeout(() => {
    try { splash?.webContents.send('splash-done') } catch {}
    // Даём splash-у доиграть «схлопывание» (fade из splash.html), затем показываем приложение.
    // v1.31.0: открываемся развёрнутыми на весь экран (как Discord), а не маленьким окном.
    setTimeout(() => { try { splash?.close() } catch {}; try { win.maximize(); win.show(); win.focus() } catch {} }, 300)
  }, wait)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#313338',
    autoHideMenuBar: true,
    title: 'Ponoi',
    // v1.28.0: без системной рамки — тонкий тайтлбар рисует рендерер, а нативные
    // кнопки «свернуть/развернуть/закрыть» даёт Windows-overlay в цвет темы.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1f22', symbolColor: '#b5bac1', height: 32 },
    show: false,   // показываем только после splash
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => closeSplashAndShow(win))

  // v1.31.2: страховка от «вечного» сплэша. Если ready-to-show по какой-то причине
  // не пришёл (тяжёлый первый запуск после установки, сбой отрисовки) — всё равно
  // показываем окно: после полной загрузки страницы или максимум через 10 секунд.
  win.webContents.once('did-finish-load', () => setTimeout(() => closeSplashAndShow(win), 400))
  win.webContents.once('did-fail-load', () => closeSplashAndShow(win))
  setTimeout(() => closeSplashAndShow(win), 10_000)

  // Open external (http) links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Свежеоткрытому окну сразу сообщаем текущую игру (если она уже запущена).
  win.webContents.on('did-finish-load', () => { if (curGame) { try { win.webContents.send('ponoi-game', curGame) } catch {} } })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  // Allow mic / camera / notifications (needed for LiveKit voice & video).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications'].includes(permission))
  })

  // Screen-share support: hand the first available screen to getDisplayMedia().
  session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      cb({ video: sources[0], audio: 'loopback' })
    }).catch(() => cb({}))
  }, { useSystemPicker: true })

  // Автообновления (как в Discord): проверяем GitHub Releases при запуске и
  // каждые 4 часа; обновление качается в фоне и ставится при закрытии приложения.
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater')
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      // v1.29.0: статус обновления транслируем в окно приложения — рендерер
      // показывает красивую карточку с прогрессом и кнопкой «Перезапустить».
      const bcastUpd = (data) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('ponoi-update', data) } catch {} } }
      autoUpdater.on('update-available', (info) => bcastUpd({ state: 'downloading', percent: 0, version: info && info.version }))
      autoUpdater.on('download-progress', (p) => {
        // Реальный прогресс скачивания обновления показываем в splash-окне и в карточке.
        try { splash?.webContents.send('splash-progress', { percent: p?.percent ?? 0 }) } catch {}
        bcastUpd({ state: 'downloading', percent: (p && p.percent) || 0 })
      })
      autoUpdater.on('update-downloaded', (info) => bcastUpd({ state: 'ready', version: info && info.version }))
      ipcMain.on('ponoi-apply-update', () => { try { autoUpdater.quitAndInstall() } catch {} })
      // v1.31.0: не дёргаем GitHub на каждый запуск — если проверяли меньше
      // 30 минут назад, стартовую проверку пропускаем (фон раз в 4 часа остаётся).
      const fs = require('fs')
      const stampFile = path.join(app.getPath('userData'), 'update-check.json')
      const lastCheckAt = () => { try { return JSON.parse(fs.readFileSync(stampFile, 'utf8')).at || 0 } catch { return 0 } }
      const check = () => {
        try { fs.writeFileSync(stampFile, JSON.stringify({ at: Date.now() })) } catch {}
        try { autoUpdater.checkForUpdatesAndNotify().catch(() => {}) } catch {}
      }
      if (Date.now() - lastCheckAt() > 30 * 60 * 1000) check()
      setInterval(check, 4 * 60 * 60 * 1000)
    } catch {}
  }

  // Игровая активность: первый скан сразу, дальше раз в 20 секунд.
  scanGames()
  setInterval(scanGames, 20_000)

  createSplash()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
