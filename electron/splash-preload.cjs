const { contextBridge, ipcRenderer } = require('electron')

// Мост для неонового splash-окна: реальный прогресс апдейта + сигнал «готово».
contextBridge.exposeInMainWorld('ponoiSplash', {
  onProgress: (cb) => ipcRenderer.on('splash-progress', (_e, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('splash-done', () => cb()),
})
