// v1.555.0: живая проверка сцены мастерской. Запуск: npm run test:scene
//
// Зачем настоящий Chromium: путь модели идёт через base64, GLTFLoader, Box3 и
// WebGL — в Node ни одного из этих звеньев нет.
//
// Про ускорение: отключать его здесь НЕЛЬЗЯ. Движок сцены первым делом создаёт
// WebGLRenderer, и без графики он падает ещё до того, как дойдёт до модели, —
// проверка мерила бы не модель, а отсутствие видеокарты. Electron умеет
// software-рендеринг (SwiftShader), и его достаточно; поэтому здесь стоит
// use-gl=swiftshader, а не disableHardwareAcceleration.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-scene-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:scene')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  // Модулем: в проверке есть await на верхнем уровне (сцена грузится не сразу),
  // а в обычном теге script это синтаксическая ошибка.
  '<!doctype html><meta charset=utf-8><pre id=out>идёт…</pre><script type="module" src="t.js"></script>')

app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

setTimeout(() => { console.log('ЗАВИС — проверки не завершились'); process.exit(2) }, 180000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 340; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
