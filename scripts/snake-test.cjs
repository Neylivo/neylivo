// v1.474.0: живая проверка настоящего плагина «Змейка». npm run test:snake
//
// Что здесь и почему это не делается со страницы.
//
//   • НАЖАТИЕ КЛАВИШИ. sendInputEvent — это ввод от системы, а не вызов
//     обработчика из кода. Позови мы обработчик сами, проверялось бы «функция
//     работает, если её позвать», а не «клавиша доходит до плагина». Ровно так
//     и выяснилось, что до v1.474.0 не доходила ни одна.
//
//   • ЧТО НАРИСОВАНО. Пиксели холста плагина со страницы НЕ прочитать:
//     управление им отдано воркеру (в этом и смысл — плагин рисует в свой
//     холст, а не в чужой). Единственный способ увидеть картинку — снимок
//     окна, и он же самый честный: так её видит человек.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-snake-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:snake')
  process.exit(1)
}
// Окно плагина ставим в угол и держим страницу простой: снимок должен
// содержать холст целиком и ничего лишнего.
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><style>body{margin:0;font:12px monospace;background:#111;color:#ddd}'
  + '.plugapp{position:fixed;left:0;top:0;background:#222}'
  + '.plugapp-h{display:flex;gap:6px;align-items:center;height:24px}'
  + '#out{position:fixed;left:0;top:520px;white-space:pre}</style>'
  + '<div id=root></div><pre id=out>идёт…</pre><script src="t.js"></script>')

let бед = 0
const ok = (name, cond, extra) => {
  if (!cond) бед++
  console.log(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
}

/** Снимок окна как сырые пиксели (BGRA). */
async function снимок(win) {
  const img = await win.webContents.capturePage()
  const size = img.getSize()
  return { data: img.toBitmap(), w: size.width, h: size.height }
}

/** Где на снимке голова змейки (её цвет #7aa2ff). Возвращает средний y. */
function голова(сн) {
  let сумма = 0, n = 0
  for (let y = 0; y < сн.h; y++) {
    for (let x = 0; x < сн.w; x++) {
      const i = (y * сн.w + x) * 4
      const b = сн.data[i], g = сн.data[i + 1], r = сн.data[i + 2]
      // Цвет может слегка поплыть от масштабирования окна — берём с допуском.
      if (Math.abs(r - 0x7a) < 14 && Math.abs(g - 0xa2) < 14 && Math.abs(b - 0xff) < 14) {
        сумма += y; n++
      }
    }
  }
  return n ? { y: сумма / n, точек: n } : null
}

function разница(a, b) {
  if (a.w !== b.w || a.h !== b.h) return -1
  let d = 0
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) d++
  return d
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 180000)
app.whenReady().then(async () => {
  // Окно ПОКАЗЫВАЕМ: у спрятанного не идут кадры и нечего снимать.
  const win = new BrowserWindow({ show: true, width: 700, height: 700, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))

  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await win.webContents.executeJavaScript("window.__этап === 'играет' || !!window.__done")) break
  }

  if (await win.webContents.executeJavaScript("window.__этап === 'играет'")) {
    const a = await снимок(win)
    await new Promise(r => setTimeout(r, 600))
    const b = await снимок(win)
    ok('картинка в окне меняется сама — игра идёт', разница(a, b) > 50, 'разных пикселей: ' + разница(a, b))

    const до = голова(b)
    ok('голова змейки видна на снимке', !!до, до ? 'точек ' + до.точек + ', y≈' + Math.round(до.y) : 'не нашлась')

    // Настоящее нажатие: окно в фокусе, событие идёт от системы.
    win.focus()
    win.webContents.focus()
    await new Promise(r => setTimeout(r, 200))
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
    await new Promise(r => setTimeout(r, 700))

    // Сначала — дошло ли нажатие вообще. Без этого «змейка не повернула»
    // читается двусмысленно: то ли клавиша не дошла, то ли плагин её не понял.
    const дошло = await win.webContents.executeJavaScript('window.__клавиш || 0')
    const фокус = await win.webContents.executeJavaScript("(document.activeElement && document.activeElement.className) + ''")
    ok('нажатие дошло до окна плагина, и фокус там же', дошло === 1 && /plugapp/.test(фокус),
      'событий ' + дошло + ', фокус: ' + фокус)
    const после = голова(await снимок(win))
    ok('после настоящего нажатия «вверх» змейка пошла вверх',
      !!до && !!после && после.y < до.y - 5,
      до && после ? `y ${Math.round(до.y)} → ${Math.round(после.y)}` : 'голова потерялась')
    await win.webContents.executeJavaScript('window.__ключиГотово = true')
  } else {
    ok('страница дошла до играющего окна', false)
    await win.webContents.executeJavaScript('window.__ключиГотово = true')
  }

  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = (await win.webContents.executeJavaScript('window.__failed || 0')) + бед
  console.log(`\nИТОГ: провалено ${failed}`)
  process.exit(failed ? 1 : 0)
})
