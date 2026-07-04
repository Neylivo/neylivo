
const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe bridge. Extend later if the renderer needs native features.
contextBridge.exposeInMainWorld('ponoiDesktop', {
  isDesktop: true,
  platform: process.platform,
  // Авто-детект игр: main-процесс присылает { name, since } при старте игры и null при выходе.
  // removeAllListeners — защита от дублей подписки при перелогине (v1.28.0).
  onGame: (cb) => { ipcRenderer.removeAllListeners('ponoi-game'); ipcRenderer.on('ponoi-game', (_e, g) => cb(g ?? null)) },
  // Поиск обложки игры в магазине Steam (в main-процессе, без CORS).
  findCover: (name) => ipcRenderer.invoke('ponoi-find-cover', name),
})
