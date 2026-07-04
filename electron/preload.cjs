
const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe bridge. Extend later if the renderer needs native features.
contextBridge.exposeInMainWorld('ponoiDesktop', {
  isDesktop: true,
  platform: process.platform,
  // Авто-детект игр: main-процесс присылает { name, since } при старте игры и null при выходе.
  onGame: (cb) => { ipcRenderer.on('ponoi-game', (_e, g) => cb(g ?? null)) },
})
