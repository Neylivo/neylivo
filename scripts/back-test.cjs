// v1.427.0: окно для проверки кнопки «назад». Запуск: npm run test:back
//
// Ловушка «назад» держится на настоящей истории браузера (pushState, popstate,
// порядок записей) — поэтому и проверяется в настоящем окне, а не заглушками в
// Node: подделанная история проверяла бы саму подделку.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-back-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:back')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><body><script src="t.js"></script></body>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверка не завершилась'); process.exit(2) }, 60000)

app.whenReady().then(async () => {
  // Раздел памяти без «persist:» — история и хранилище живут только этот прогон.
  const win = new BrowserWindow({ show: false, width: 600, height: 400,
    webPreferences: { partition: 'back-test-' + Date.now() } })
  win.webContents.on('console-message', (_e, _lvl, msg) => console.log(msg))
  await win.loadFile(path.join(OUT, 'index.html'))

  for (let i = 0; i < 60; i++) {
    const done = await win.webContents.executeJavaScript('window.__done || ""')
    if (done) {
      app.exit(done === 'ОК' ? 0 : 1)
      return
    }
    await new Promise(r => setTimeout(r, 200))
  }
  console.log('ЗАВИС — проверка не доложила результат')
  app.exit(2)
})
