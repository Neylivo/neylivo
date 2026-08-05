// v1.489.0: «назад» на телефоне закрывает окно плагина. Запуск: npm run test:mobback
//
// Окно Electron здесь представляется Android НАРОЧНО: IS_MOBILE считается один
// раз при загрузке по опознавателю браузера, и без этого проверка молча пошла
// бы по ветке «компьютер» — то есть не проверила бы ничего.
//
// Стережёт эта проверка последний выход: у безрамочного окна плагина не
// осталось ни шапки, ни крестика, а клавиатуры с Esc на телефоне нет.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-mobback-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:mobback')
  process.exit(1)
}
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><link rel=stylesheet href="styles.css">'
  + '<style>html,body{margin:0;height:100%;font:12px monospace;background:#111;color:#ddd}'
  + '#out{white-space:pre;position:relative;z-index:1;pointer-events:none}</style>'
  + '<div id=root></div><pre id=out>идёт…</pre><script src="t.js"></script>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  // Размер телефона и его же опознаватель: IS_MOBILE смотрит на оба.
  const win = new BrowserWindow({
    show: false, width: 412, height: 915, backgroundColor: '#111',
    webPreferences: { partition: 'mobback-' + Date.now() },
  })
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/126.0.0.0 Mobile Safari/537.36')
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
