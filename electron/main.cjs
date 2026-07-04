const { app, BrowserWindow, shell, session, desktopCapturer, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')

const isDev = !app.isPackaged

// ---- v1.55.0: приложение живёт в фоне (трей + автозапуск с Windows) ----
// Закрытие окна сворачивает в трей: активность, звонки и уведомления работают,
// даже когда окно «выключено». Полный выход — через меню трея.
let tray = null
let quitting = false
const startHidden = process.argv.includes('--hidden')   // автозапуск стартует скрыто, сразу в трей
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')
function readPrefs() { try { return JSON.parse(require('fs').readFileSync(prefsFile(), 'utf8')) } catch { return {} } }
function writePrefs(p) { try { require('fs').writeFileSync(prefsFile(), JSON.stringify(p)) } catch {} }

// Вторая копия приложения не запускается — просто показывает уже работающую.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
}

function showMainWindow() {
  const w = BrowserWindow.getAllWindows().find(x => x !== splash)
  if (w) { try { if (w.isMinimized()) w.restore(); w.show(); w.focus() } catch {}; return }
  const nw = createWindow()
  nw.once('ready-to-show', () => { try { nw.show(); nw.focus() } catch {} })
}

// ---- Авто-детект игр (как в Discord) ----
// Раз в 4 секунды (как в Discord) смотрим ОКНА Windows (PowerShell Get-Process). Рендереру шлём событие ТОЛЬКО
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

// v1.56.0: управление окном из нашего тайтлбара (нативные кнопки убраны).
ipcMain.on('win-minimize', (e) => { try { BrowserWindow.fromWebContents(e.sender)?.minimize() } catch {} })
ipcMain.on('win-toggle-max', (e) => { try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.isMaximized() ? w.unmaximize() : w.maximize() } catch {} })
ipcMain.on('win-close', (e) => { try { BrowserWindow.fromWebContents(e.sender)?.close() } catch {} })

// Строгий детект (v1.49.1): спрашиваем у Windows ТОЛЬКО процессы с настоящим
// главным окном (MainWindowHandle ≠ 0 и непустой заголовок) через PowerShell —
// ровно так запущенную игру отличает от фоновой службы и Discord.
// tasklist для этого не годился: он пишет заголовок и у фоновых процессов
// (RobloxPlayerBeta, висящий в диспетчере после закрытия игры, детектился зря).
// javaw.exe — это любое Java-приложение: Minecraft'ом считаем только если
// заголовок окна содержит «minecraft». Старт игры публикуем после двух сканов
// подряд (~8 сек), чтобы не ловить мигающие процессы; закрытие гасим сразу.
const GAME_BY_PROC = {}
for (const [exe, nm] of Object.entries(GAMES)) GAME_BY_PROC[exe.replace(/\.exe$/, '')] = nm
// v1.55.0: универсальный детект ЛЮБЫХ игр (в т.ч. инди), как в Discord.
// PowerShell отдаёт процесс + путь exe + заголовок окна. Игра распознаётся:
// 1) по известному имени процесса (словарь GAMES выше), или
// 2) по расположению exe в папках игровых магазинов (Steam steamapps\common,
//    Epic Games, GOG, XboxGames, Riot Games, itch, Roblox) — имя игры берём
//    из папки игры. Лаунчеры и служебные процессы отсекает чёрный список.
const PS_SCAN = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + '|' + $_.Path + '|' + $_.MainWindowTitle }"
const NOT_GAMES = new Set([
  'steam', 'steamwebhelper', 'epicgameslauncher', 'epicwebhelper', 'galaxyclient', 'gog galaxy',
  'riot client', 'riotclientservices', 'riotclientux', 'leagueclientux', 'battle.net', 'agent',
  'launcher', 'robloxstudiobeta', 'itch', 'ubisoftconnect', 'upc', 'origin', 'eadesktop',
  'eabackgroundservice', 'crashhandler', 'unitycrashhandler32', 'unitycrashhandler64',
  'crashreportclient', 'easyanticheat', 'setup', 'unins000',
])
const GAME_DIRS = [
  [/steamapps[\\/]common[\\/]([^\\/]+)/i, 1],
  [/epic games[\\/]([^\\/]+)/i, 1],
  [/gog galaxy[\\/]games[\\/]([^\\/]+)/i, 1],
  [/gog games[\\/]([^\\/]+)/i, 1],
  [/xboxgames[\\/]([^\\/]+)/i, 1],
  [/riot games[\\/]([^\\/]+)/i, 1],
  [/itch[\\/]apps[\\/]([^\\/]+)/i, 1],
  [/roblox[\\/]versions[\\/]/i, 0],
]
function detectGame(proc, exePath, title) {
  const nm = GAME_BY_PROC[proc]
  if (nm) {
    if (proc === 'javaw' && !title.toLowerCase().includes('minecraft')) return null
    return nm
  }
  if (!exePath || NOT_GAMES.has(proc)) return null
  for (const [re, grp] of GAME_DIRS) {
    const m = exePath.match(re)
    if (!m) continue
    if (grp === 0) return 'Roblox'
    let name = m[grp]
    if (!name || NOT_GAMES.has(name.toLowerCase())) return null
    // exe бывает зарыт в служебную папку — тогда лучше заголовок окна
    if (/^(binaries|bin|win64|win32|shipping|game|live|retail|content)$/i.test(name)) name = title || name
    return name.replace(/[-_]+/g, ' ').trim()
  }
  return null
}
let pendingGame = null   // кандидат на старт: { name, at }
let scanBusy = false     // не пускаем сканы внахлёст
function scanGames() {
  if (process.platform !== 'win32' || scanBusy) return
  scanBusy = true
  const { execFile } = require('child_process')
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCAN], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    scanBusy = false
    if (err || !out) return
    let found = null
    for (const line of String(out).split('\n')) {
      const parts = line.split('|')
      if (parts.length < 3) continue
      const proc = parts[0].trim().toLowerCase()
      const exePath = parts[1].trim()
      const title = parts.slice(2).join('|').trim()
      if (!title) continue
      const nm = detectGame(proc, exePath, title)
      if (!nm) continue
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
  if (startHidden) { try { splash?.close() } catch {}; return }   // v1.55.0: автозапуск — сидим в трее, окно не показываем
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
    // v1.56.0: без системной рамки и БЕЗ нативного Windows-overlay — тайтлбар и
    // кнопки окна рисует рендерер (как в Discord). Overlay убрали: он рисовался
    // поверх приложения и ломался, когда его что-то перекрывало.
    titleBarStyle: 'hidden',
    show: false,   // показываем только после splash
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // v1.55.0: в трее/фоне активность, звонки и уведомления работают без замедления
    },
  })

  // v1.55.0: закрытие окна = свернуть в трей (как в Discord). Полный выход — из меню трея.
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide() }
  })

  win.once('ready-to-show', () => closeSplashAndShow(win))

  // v1.56.0: транслируем рендереру состояние окна (развёрнуто/восстановлено),
  // чтобы кнопка разворачивания в нашем тайтлбаре меняла иконку.
  const sendMax = () => { try { win.webContents.send('win-maximized', win.isMaximized()) } catch {} }
  win.on('maximize', sendMax)
  win.on('unmaximize', sendMax)
  win.webContents.on('did-finish-load', sendMax)

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
  return win
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
      // v1.47.1: «жёсткая» установка обновления. Обычный quitAndInstall закрывает окна
      // мягко, и beforeunload (например, предупреждение при активном голосе) не даёт
      // приложению выйти — установщик писал «Не удалось закрыть Ponoi. Закройте вручную».
      // destroy() обходит beforeunload, а снятие window-all-closed не даёт app.quit()
      // вклиниться раньше установки.
      const forceQuitAndInstall = () => {
        quitting = true
        try { tray?.destroy() } catch {}
        try { app.removeAllListeners('window-all-closed') } catch {}
        for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
        try { autoUpdater.quitAndInstall(true, true) } catch {}
      }
      autoUpdater.on('update-available', (info) => bcastUpd({ state: 'downloading', percent: 0, version: info && info.version }))
      autoUpdater.on('download-progress', (p) => {
        // Реальный прогресс скачивания обновления показываем в splash-окне и в карточке.
        try { splash?.webContents.send('splash-progress', { percent: p?.percent ?? 0 }) } catch {}
        bcastUpd({ state: 'downloading', percent: (p && p.percent) || 0 })
      })
      autoUpdater.on('update-downloaded', (info) => {
        // Обновление скачалось, пока мы на сплэше — сразу ставим его «жёстко».
        // v1.47.1: страховка от зависания на «100%»: если через 4 секунды мы почему-то
        // всё ещё живы — показываем приложение, обновление доставится при выходе.
        if (!appShown) {
          try { splash?.webContents.send('splash-progress', { percent: 100 }) } catch {}
          setTimeout(() => { try { const w = BrowserWindow.getAllWindows().find(x => x !== splash); if (w) closeSplashAndShow(w) } catch {} }, 4000)
          forceQuitAndInstall()
          return
        }
        bcastUpd({ state: 'ready', version: info && info.version })
      })
      // v1.47.1: ошибка обновления больше не подвешивает сплэш/карточку — прячем
      // прогресс и запускаемся как обычно; попробуем снова через 30 минут.
      autoUpdater.on('error', () => {
        try { splash?.webContents.send('splash-done') } catch {}
        bcastUpd({ state: 'error' })
      })
      ipcMain.on('ponoi-apply-update', () => forceQuitAndInstall())
      // v1.37.1: обновления прилетают быстро — проверяем GitHub при каждом
      // запуске и дальше каждые 30 минут (было: пропуск на старте + раз в 4 часа).
      const check = () => { try { autoUpdater.checkForUpdatesAndNotify().catch(() => {}) } catch {} }
      check()
      setInterval(check, 30 * 60 * 1000)
    } catch {}
  }

  // Игровая активность: первый скан сразу, дальше раз в 4 секунды (как в Discord).
  scanGames()
  setInterval(scanGames, 4_000)

  // v1.37.1: после обновления версии один раз чистим HTTP- и код-кэш старой
  // версии, чтобы ничего не лагало. Логин и настройки (localStorage) не трогаем.
  try {
    const fsv = require('fs')
    const verFile = path.join(app.getPath('userData'), 'last-version.json')
    let prev = null
    try { prev = JSON.parse(fsv.readFileSync(verFile, 'utf8')).v } catch {}
    if (prev !== app.getVersion()) {
      try { fsv.writeFileSync(verFile, JSON.stringify({ v: app.getVersion() })) } catch {}
      const { session } = require('electron')
      try { session.defaultSession.clearCache().catch(() => {}) } catch {}
      try { session.defaultSession.clearCodeCaches({}).catch(() => {}) } catch {}
    }
  } catch {}

  // v1.55.0: иконка в трее — приложение живёт в фоне даже с закрытым окном.
  try {
    let icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'))
    if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, '..', 'dist', 'icon.png'))
    tray = new Tray(icon)
    tray.setToolTip('Ponoi')
    const auto = readPrefs().autostart !== false
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть Ponoi', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Автозапуск с Windows', type: 'checkbox', checked: auto,
        click: (mi) => {
          writePrefs({ ...readPrefs(), autostart: mi.checked })
          try { app.setLoginItemSettings({ openAtLogin: mi.checked, args: ['--hidden'] }) } catch {}
        },
      },
      { type: 'separator' },
      {
        label: 'Выйти из Ponoi',
        click: () => {
          quitting = true
          try { tray?.destroy() } catch {}
          for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
          app.quit()
        },
      },
    ]))
    tray.on('click', () => showMainWindow())
    tray.on('double-click', () => showMainWindow())
  } catch {}

  // v1.55.0: автозапуск с Windows (скрыто, в трей). Включён по умолчанию,
  // выключается галочкой в меню трея — выбор запоминается в prefs.json.
  if (!isDev && process.platform === 'win32' && readPrefs().autostart !== false) {
    try { app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }) } catch {}
  }

  if (!startHidden) createSplash()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { quitting = true })

app.on('window-all-closed', () => {
  // v1.55.0: окна закрыты, но приложение живёт в трее (активность, звонки,
  // уведомления). Полностью выходим только через «Выйти из Ponoi» в трее.
  if (process.platform !== 'darwin' && quitting) app.quit()
})
