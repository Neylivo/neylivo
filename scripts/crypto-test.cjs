// v1.292.0: прогон проверок криптоядра. Запуск: npm run test:crypto
//
// Криптография — единственное место в проекте, где ошибка означает не «кнопка не
// нажимается», а «переписку можно прочитать». Поэтому проверки гоняются в
// настоящем Chromium (WebCrypto нет в Node в том же виде) и проверяют не только
// что шифрование работает, но и что оно ОТКАЗЫВАЕТ там, где должно: подменённый
// шифротекст, чужой ключ, ключ от другого назначения.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

// Собранный пакет кладёт сюда предыдущий шаг npm-скрипта: вызывать esbuild отсюда
// нельзя — на Windows это .cmd, и запуск его из процесса Electron подвисает.
const OUT = path.join(__dirname, '..', 'dist-crypto-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:crypto')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><pre id=out>идёт…</pre><script src="t.js"></script>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверки не завершились'); process.exit(2) }, 90000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
