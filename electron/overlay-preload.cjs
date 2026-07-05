
const { contextBridge, ipcRenderer } = require('electron')

// v1.99.0: мост для окна-оверлея «Пригласите друзей поиграть» (поверх игры).
contextBridge.exposeInMainWorld('ponoiOverlay', {
  invite: (id, game) => ipcRenderer.send('ponoi-overlay-invite', { id, game }),
  openApp: () => ipcRenderer.send('ponoi-overlay-open'),
  close: () => ipcRenderer.send('ponoi-overlay-close'),
})
