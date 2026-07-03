const { app, BrowserWindow, shell, session, desktopCapturer } = require('electron')
const path = require('path')

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#313338',
    autoHideMenuBar: true,
    title: 'Ponoi',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Open external (http) links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

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
      const check = () => { try { autoUpdater.checkForUpdatesAndNotify().catch(() => {}) } catch {} }
      check()
      setInterval(check, 4 * 60 * 60 * 1000)
    } catch {}
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
