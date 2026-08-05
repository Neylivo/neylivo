// v1.478.0: живая проверка звука. npm run test:play
//
// Окно ПОКАЗЫВАЕМ и звук НЕ выводим наружу: анализатор в проверке висит на
// узле, который никуда дальше не подключён, — иначе прогон пищал бы в динамики.
// Autoplay в Electron разрешён (проверено отдельно), поэтому нажатие человека
// здесь не нужно; в браузере без нажатия звук бы не пошёл, и это не поломка
// приложения, а правило браузера.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-play-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:play')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><style>body{margin:0;font:12px monospace;background:#111;color:#ddd}'
  + '#out{white-space:pre}</style><pre id=out>идёт…</pre><script src="t.js"></script>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 120000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 800, height: 700, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
