// v1.511.0: бережный режим на настоящих кадрах. Запуск: npm run test:save
//
// Окно НЕ показывается, но и не душится: backgroundThrottling выключен, иначе
// браузер сам урежет кадры, и проверка «кадров нет» пройдёт по чужой причине.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-save-test')
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><body><script src="t.js"></script></body>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 500, height: 400,
    webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 120; i++) {
    const готово = await win.webContents.executeJavaScript('window.__saveTestDone ? JSON.stringify(window.__saveTestDone) : ""')
    if (готово) {
      const r = JSON.parse(готово)
      console.log(r.text)
      process.exit(r.fail ? 1 : 0)
    }
    await new Promise(r => setTimeout(r, 250))
  }
  console.log('проверка не отчиталась')
  process.exit(2)
})
