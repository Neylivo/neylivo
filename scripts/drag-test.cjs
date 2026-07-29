// v1.391.0: проверка мини-плашки плеера. Запуск: npm run test:drag
//
// Плашку жаловались «неудобно двигать и невозможно попасть по паузе»: тащить её
// начинало любое нажатие, в котором рука дрогнула на пиксель, и плашка при этом
// мгновенно меняла размер прямо под курсором. Проверка гоняет её настоящими
// событиями мыши: дрожь должна оставаться щелчком, перетаскивание — двигать,
// а пауза — срабатывать с первого раза.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-drag-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:drag')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8>' +
  '<link rel=stylesheet href="../src/styles.css">' +
  '<style>*{animation:none!important}html,body{margin:0;height:100%;background:#313338}</style>' +
  '<div id=root></div><script src="t.js"></script>')

let failed = 0
function check(name, ok, extra) {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверка не завершилась'); process.exit(2) }, 60000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 600, backgroundColor: '#313338' })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 700))
  const wc = win.webContents
  const st = () => wc.executeJavaScript('JSON.stringify(window.__st())').then(JSON.parse)
  const pause = () => new Promise(r => setTimeout(r, 30))
  const move = async (x, y) => { wc.sendInputEvent({ type: 'mouseMove', x, y }); await pause() }
  const down = async (x, y) => { wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause() }
  const up = async (x, y) => { wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await new Promise(r => setTimeout(r, 70)) }

  const before = await st()

  console.log('\n── Нажатие с дрожью в три пикселя ──')
  await down(120, 120); await move(122, 121); await move(123, 122); await up(123, 122)
  let s = await st()
  check('засчитано щелчком, а не перетаскиванием', s.opens === 1, 'открытий плеера: ' + s.opens)
  check('плашка осталась на месте', Math.abs(s.rect.x - before.rect.x) < 1 && Math.abs(s.rect.y - before.rect.y) < 1,
    'x=' + Math.round(s.rect.x) + ' y=' + Math.round(s.rect.y))

  console.log('\n── Настоящее перетаскивание ──')
  await down(120, 120)
  for (let i = 1; i <= 10; i++) await move(120 + i * 20, 120 + i * 10)
  await up(320, 220)
  s = await st()
  const movedBy = s.rect.x - before.rect.x
  check('плашка переехала', Math.abs(movedBy - 200) < 3, 'сдвиг по x: ' + Math.round(movedBy))
  check('щелчок при этом не засчитан', s.opens === 1, 'открытий плеера: ' + s.opens)
  check('размер плашки не менялся', Math.abs(s.rect.width - before.rect.width) < 1,
    'ширина: было ' + Math.round(before.rect.width) + ', стало ' + Math.round(s.rect.width))

  console.log('\n── Целимся в паузу ──')
  const r = await wc.executeJavaScript("JSON.stringify(document.getElementById('play').getBoundingClientRect().toJSON())").then(JSON.parse)
  const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2)
  await down(cx, cy); await move(cx + 2, cy + 1); await up(cx + 2, cy + 1)
  s = await st()
  check('пауза сработала с первого раза', s.plays === 1, 'нажатий паузы: ' + s.plays)
  check('от нажатия на паузу плашка не поехала', Math.abs(s.rect.x - (before.rect.x + 200)) < 3, 'x=' + Math.round(s.rect.x))
  check('кнопка паузы не меньше 32px', r.width >= 32 && r.height >= 32,
    Math.round(r.width) + '×' + Math.round(r.height))

  // Ломаем нарочно: без порога дрожь в три пикселя стала бы перетаскиванием.
  console.log('\n── Ломаем нарочно ──')
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'music', 'useDragBar.ts'), 'utf8')
  check('порог задан и он не нулевой', /const THRESHOLD = ([1-9]\d*)/.test(src),
    (src.match(/const THRESHOLD = \d+/) || ['нет'])[0])

  console.log('\nИТОГ: ' + (failed ? 'ПРОВАЛЕНО проверок: ' + failed : 'все проверки пройдены'))
  app.exit(failed ? 1 : 0)
})
