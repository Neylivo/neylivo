
const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe bridge. Extend later if the renderer needs native features.
contextBridge.exposeInMainWorld('ponoiDesktop', {
  isDesktop: true,
  platform: process.platform,
  // Авто-детект игр: main-процесс присылает { name, since } при старте игры и null при выходе.
  // removeAllListeners — защита от дублей подписки при перелогине (v1.28.0).
  onGame: (cb) => { ipcRenderer.removeAllListeners('ponoi-game'); ipcRenderer.on('ponoi-game', (_e, g) => cb(g ?? null)) },
  // v1.150.0: конец матча (CS2 через GSI) — { game, mode, map, score, result }.
  onMatchEnd: (cb) => { ipcRenderer.removeAllListeners('ponoi-match-end'); ipcRenderer.on('ponoi-match-end', (_e, m) => cb(m)) },
  // Поиск обложки игры в магазине Steam (в main-процессе, без CORS).
  findCover: (name) => ipcRenderer.invoke('ponoi-find-cover', name),
  // Авто-обновление (v1.29.0): статус скачивания и команда «Перезапустить и обновить».
  onUpdate: (cb) => { ipcRenderer.removeAllListeners('ponoi-update'); ipcRenderer.on('ponoi-update', (_e, d) => cb(d)) },
  applyUpdate: () => ipcRenderer.send('ponoi-apply-update'),
  // v1.56.0: управление окном для своего тайтлбара (нативные кнопки убраны).
  winMinimize: () => ipcRenderer.send('win-minimize'),
  winToggleMax: () => ipcRenderer.send('win-toggle-max'),
  winClose: () => ipcRenderer.send('win-close'),
  onMaximize: (cb) => { ipcRenderer.removeAllListeners('win-maximized'); ipcRenderer.on('win-maximized', (_e, m) => cb(!!m)) },
  // v1.91.0: надёжное копирование — текст и картинки через системный буфер (main-процесс).
  copyText: (t) => ipcRenderer.invoke('ponoi-clip-text', t),
  copyImage: (dataUrl) => ipcRenderer.invoke('ponoi-clip-image', dataUrl),
  // v1.98.0: плашка-оверлей поверх игры «друг начал играть в ту же игру» (как оверлей Discord).
  gameToast: (p) => ipcRenderer.send('ponoi-game-toast', p),
  // v1.99.0: стартовый оверлей при входе в игру — «Пригласите друзей поиграть».
  gameOverlay: (p) => ipcRenderer.send('ponoi-game-overlay', p),
  // v1.100.0: красный кружок с числом непрочитанного на иконке в панели задач.
  setBadge: (dataUrl, count) => ipcRenderer.send('ponoi-badge', { dataUrl, count }),
  // v1.160.0: свой логотип приложения — иконка окна/трея сразу; dataUrl===null
  // сбрасывает к стандартной. Файл на диске (для сплэш-экрана) и id в prefs.json
  // main-процесс ведёт сам, см. 'ponoi-set-icon'.
  setAppIcon: (dataUrl) => ipcRenderer.invoke('ponoi-set-icon', { dataUrl }),
  onOverlayInvite: (cb) => { ipcRenderer.removeAllListeners('ponoi-overlay-invite'); ipcRenderer.on('ponoi-overlay-invite', (_e, p) => cb(p)) },
  // v1.161.0: диплинк на сообщение (ponoi://msg/...), пришедший запуском .exe с URL.
  onDeepLink: (cb) => { ipcRenderer.removeAllListeners('ponoi-deep-link'); ipcRenderer.on('ponoi-deep-link', (_e, url) => cb(url)) },
  // v1.180.0: «Игровой Экспресс» — скан папки mods текущей сборки Minecraft (версия/Forge/список модов с sha1).
  mcScanMods: () => ipcRenderer.invoke('ponoi-mc-scan-mods'),
  mcModExists: (supabaseUrl, sha1) => ipcRenderer.invoke('ponoi-mc-mod-exists', { supabaseUrl, sha1 }),
  mcUploadMod: args => ipcRenderer.invoke('ponoi-mc-upload-mod', args),
  mcPrepareInstance: (pack, supabaseUrl) => ipcRenderer.invoke('ponoi-mc-prepare-instance', { pack, supabaseUrl }),
  onMcProgress: (cb) => { ipcRenderer.removeAllListeners('ponoi-mc-progress'); ipcRenderer.on('ponoi-mc-progress', (_e, p) => cb(p)) },
  mcLaunch: (pack, instDir, username) => ipcRenderer.invoke('ponoi-mc-launch', { pack, instDir, username }),
  // v1.184.0: «Поделиться игрой» — открыть join-ссылку (roblox://…) в системном обработчике.
  openExternal: (url) => ipcRenderer.send('ponoi-open-external', url),
})
