const { contextBridge, ipcRenderer } = require('electron')

// v1.196.0: оверлей поверх игры со списком собеседников звонка — отдельный
// preload (по образцу overlay-preload.cjs), никакого доступа к обычному ponoiDesktop.
contextBridge.exposeInMainWorld('ponoiCallOverlay', {
  onUpdate: (cb) => { ipcRenderer.removeAllListeners('ponoi-call-overlay-data'); ipcRenderer.on('ponoi-call-overlay-data', (_e, list) => cb(list)) },
})
