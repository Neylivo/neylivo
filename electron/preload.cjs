
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
  onOverlayInvite: (cb) => { ipcRenderer.removeAllListeners('ponoi-overlay-invite'); ipcRenderer.on('ponoi-overlay-invite', (_e, p) => cb(p)) },
})
