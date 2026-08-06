// v1.494.0: озвучка сообщений на НАСТОЯЩЕМ синтезе. Запуск: npm run test:speak
//
// Зачем стенд. Всё смысловое (выбор голоса, пределы, текст) — чистые функции, и
// они проверяются в test:ui без единого звука. Но три вещи чистой функцией не
// проверить никак, а сломаться они могут молча:
//
//   1. Список голосов приезжает НЕ СРАЗУ. Первый getVoices() в браузере часто
//      пуст, настоящий приходит событием voiceschanged. Спроси один раз — и в
//      настройках будет «голосов нет» на пустом месте.
//   2. Синтез должен ПРАВДА заговорить: событие start у произнесения.
//   3. Настройки должны доехать до произнесения — голос, скорость, высота.
//
// Звук наружу не идёт: громкость ставим в ноль, а событий это не отменяет.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-speak-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:speak')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8>'
  + '<style>html,body{margin:0;font:13px monospace;background:#111;color:#ddd}</style>'
  + '<pre id=out>идёт…</pre><script src="t.js"></script>')

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 700, height: 500 })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
