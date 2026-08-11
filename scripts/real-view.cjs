// Снимки НАСТОЯЩИХ компонентов на экране телефона. Запуск: npm run look:real
//
// Владелец: «у тебя на примерах красивей чем в реальности». Так и было: снимки
// делались с разметки, написанной руками по мотивам компонентов, — а она всегда
// чуть аккуратнее настоящей. Здесь на страницу монтируется настоящий React со
// своими обёртками и классами, и снимок показывает то, что увидит человек.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-real-view')
const LOOK = path.join(__dirname, '..', 'dist-look')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(LOOK, { recursive: true })
for (const f of ['styles.css', 'ponoi-ui.css']) {
  fs.copyFileSync(path.join(__dirname, '..', 'src', f), path.join(OUT, f))
}
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css"><link rel=stylesheet href="ponoi-ui.css">
<style>html,body{height:100%;margin:0;background:#1e1f22}#root{height:100%}</style>
<div id="root"></div><script src="app.js"></script>`)

app.commandLine.appendSwitch('touch-events', 'enabled')
app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 412, height: 915,
    backgroundColor: '#1e1f22', webPreferences: { backgroundThrottling: false } })
  // Приложение решает «это телефон» по опознавателю браузера, и решает это ОДИН
  // РАЗ при загрузке. Без подмены стенд рисовал настольный вид в узком окне:
  // ни стрелок справа, ни полноэкранных настроек — то есть опять не то, что
  // видит человек.
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/126.0.0.0 Mobile Safari/537.36')
  const d = win.webContents.debugger
  await win.loadFile(path.join(OUT, 'index.html'))
  if (!d.isAttached()) d.attach('1.3')
  // Телефон — это не только узкое окно: раскладка спрашивает и про сенсор.
  await d.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }],
  })
  await new Promise(r => setTimeout(r, 1500))

  const ошибки = []
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) ошибки.push(msg.slice(0, 200)) })

  const кадр = await win.webContents.capturePage()
  fs.writeFileSync(path.join(LOOK, 'настоящие-настройки-412.png'), кадр.toPNG())
  console.log('снято: настоящие-настройки-412.png')

  const сколько = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.pqs2-item').length + ' разделов, ' + document.querySelectorAll('.pqs2-item-sub').length + ' подписей'`)
  console.log('на экране: ' + сколько)
  if (ошибки.length) console.log('ошибки в консоли: ' + ошибки.slice(0, 3).join(' | '))
  process.exit(0)
})
