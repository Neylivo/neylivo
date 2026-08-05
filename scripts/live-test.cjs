// v1.473.0: живая проверка своих файлов плагина. Запуск: npm run test:live
//
// Зачем настоящий Chromium. Всё интересное в assets.ts происходит на стыке с
// IndexedDB и Blob: в Node ни того, ни другого нет, и чистыми функциями там не
// проверить главное — что байты вернулись теми же, что чужой плагин своих
// файлов не видит и что картинка правда рисуется.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

// Собранный пакет кладёт сюда предыдущий шаг npm-скрипта: вызывать esbuild
// отсюда нельзя — на Windows это .cmd, и запуск его из Electron подвисает.
const OUT = path.join(__dirname, '..', 'dist-live-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:live')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><pre id=out>идёт…</pre><script src="t.js"></script>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверки не завершились'); process.exit(2) }, 120000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
