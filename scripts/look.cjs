// Снимки настоящих экранов приложения. Запуск: npm run look
//
// Зачем. Про вид нельзя рассуждать по исходнику: «красиво» и «удобно» видно
// только глазами, и только на настоящих стилях. Этот стенд поднимает собранное
// приложение (dist), подставляет разметку главных экранов — ровно ту, что
// рисуют компоненты, — и складывает снимки в dist-look/.
//
// Это не проверка: она ничего не утверждает и никогда не падает. Это глаза.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
const OUT = path.join(__dirname, '..', 'dist-look')
fs.mkdirSync(OUT, { recursive: true })

// Разметка экранов — общая, из scripts/screens.cjs: ими же меряется
// читаемость на обеих темах (npm run test:contrast). Копия здесь означала бы,
// что снимки показывают одно, а проверка меряет другое.
const { экраны } = require('./screens.cjs')

const ЭКРАНЫ = экраны().map(э => ({ имя: э.имя.replace(/\s+/g, '-'), html: э.html, ш: э.ш, в: э.в }))

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1440, height: 900,
    backgroundColor: '#313338',
    // nodeIntegration нужен только затем, чтобы стенд мог нарисовать настоящий
    // QR той же библиотекой, что и приложение.
    webPreferences: { backgroundThrottling: false, nodeIntegration: true, contextIsolation: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))

  for (const э of ЭКРАНЫ) {
    win.setContentSize(э.ш, э.в)
    await new Promise(r => setTimeout(r, 350))
    await win.webContents.executeJavaScript(`(() => {
      if (${JSON.stringify(э.html !== null)}) {
        document.body.className = ''
        document.body.innerHTML = ${JSON.stringify(э.html || '')}
      }
      // Настоящее приложение живёт в #root на всю высоту окна. При подмене
      // разметки этого не остаётся, и всё съезжает наверх — сужденное по такому
      // снимку было бы суждением о стенде, а не о приложении.
      const s = document.createElement('style')
      s.textContent = 'html,body{height:100%;margin:0} .app-viewport{height:100%}'
        // Колонки на всю высоту: иначе панель профиля висит посередине
        // экрана, и о нижней кромке по снимку судить нельзя.
        + ' .app{height:100%} .channels,.servers,.dm-side,.chat{height:100%}'
        + ' .ch-list,.dm-list,.msgs{flex:1} .me{margin-top:auto}'
        + ' .av-wrap{width:40px;height:40px;border-radius:50%;background:#5865f2;display:inline-block;flex:none}'
        + ' .member .av,.dm-item .av,.pfr-row .av-wrap{width:32px;height:32px}'
        + ' .me-av{width:32px;height:32px;border-radius:50%;background:#3ba55d;display:inline-block}'
      document.head.appendChild(s)
    })()`)
    // Настоящий QR: пустой холст на снимке ничего бы не сказал о размере.
    await win.webContents.executeJavaScript(`(() => {
      const c = document.getElementById('qr-here')
      if (!c) return
      const qr = require(${JSON.stringify('qrcode-generator')})
      const т = qr(0, 'M')
      т.addData('NEYLIVO1:' + 'A'.repeat(26) + ':' + 'B'.repeat(104), 'Alphanumeric')
      т.make()
      const n = т.getModuleCount(), поле = 4
      const пиксель = Math.max(2, Math.floor(240 / (n + поле * 2)))
      const сторона = (n + поле * 2) * пиксель
      c.width = сторона; c.height = сторона
      const g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, сторона, сторона)
      g.fillStyle = '#000'
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
        if (т.isDark(r, k)) g.fillRect((k + поле) * пиксель, (r + поле) * пиксель, пиксель, пиксель)
      }
    })()`).catch(() => {})
    await new Promise(r => setTimeout(r, 450))
    const к = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, э.имя + '.png'), к.toPNG())
    console.log('снято: ' + э.имя + '.png')
  }
  process.exit(0)
})
