const { contextBridge } = require('electron')

// Minimal, safe bridge. Extend later if the renderer needs native features.
contextBridge.exposeInMainWorld('ponoiDesktop', {
  isDesktop: true,
  platform: process.platform,
})
