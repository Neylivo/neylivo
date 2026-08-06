// v1.499.0: значки при наведении НЕ ПРЫГАЮТ. Запуск: npm run test:hover
//
// Владелец прислал снимок: аватарка подскакивала под курсором.
//
// По исходнику такое не видно: правило наведения выглядит безобидно
// (scale 1.08), и понять, что значок при этом УЕЗЖАЕТ, можно только измерив.
// Поэтому здесь настоящая мышь: подводим её к значку и меряем прямоугольник до
// и после. На сломанной версии выходит 40×42 -> 43.2×45.4 со сдвигом −1.6,−1.7.
//
// Проверка меряет ДВА размера экрана нарочно: правила аватарки на телефоне и на
// компьютере разные, и прыгало только на компьютере. Своё предположение
// («виноват чужой transform в чате») этот же стенд и опроверг.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-hover-test')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))

// Разметка списана с MessageList.tsx: аватарка стоит в msg-gutter.
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css">
<style>html,body{margin:0;height:100%;background:#313338;font-family:system-ui,sans-serif;color:#dbdee1}
.msgs{padding:40px 16px}</style>
<div class="msgs">
  <div class="msg">
    <div class="msg-gutter">
      <span class="av-click" id="ava" title="Профиль">
        <span class="av" style="width:40px;height:40px;border-radius:50%;background:#5865f2;display:block"></span>
      </span>
    </div>
    <div class="msg-body"><b>Ваня</b><div>Привет</div></div>
  </div>
</div>`)

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

async function мерка(win) {
  return JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('ava').getBoundingClientRect()
    const el = document.getElementById('ava')
    return JSON.stringify({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      // Держим и это: без «hover: true» проверка могла бы пройти просто потому,
      // что мышь до значка не доехала, — и молча не проверить ничего.
      hover: el.matches(':hover'), tr: getComputedStyle(el).transform })
  })()`))
}

app.whenReady().then(async () => {
  // ОДНО окно на оба размера: закрытое окно уносит с собой сессию, и следующее
  // берётся за file:// раньше, чем она поднимется (ERR_FAILED). Ровно на это я
  // уже попадался в обходе телефона.
  const win = new BrowserWindow({ show: true, width: 1200, height: 700, backgroundColor: '#313338' })
  for (const [имя, ширина] of [['обычный', 1200], ['телефон', 412]]) {
    win.setContentSize(ширина, 700)
    await win.loadFile(path.join(OUT, 'index.html'))
    await new Promise(r => setTimeout(r, 400))

    // Мышь в сторону — исходное положение.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 600 })
    await new Promise(r => setTimeout(r, 250))
    const до = await мерка(win)

    // И наводим НА значок.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(до.x + до.w / 2), y: Math.round(до.y + до.h / 2) })
    await new Promise(r => setTimeout(r, 350))
    const после = await мерка(win)

    console.log('\n── ' + имя + ' (' + ширина + ') ──')
    console.log('   до: ' + JSON.stringify(до) + '\n   после: ' + JSON.stringify(после))
    check('значок не уезжает под курсором',
      Math.abs(до.x - после.x) < 0.6 && Math.abs(до.y - после.y) < 0.6,
      `сдвиг ${Math.round((после.x - до.x) * 10) / 10}, ${Math.round((после.y - до.y) * 10) / 10}`)
    check('мышь правда доехала до значка', после.hover === true,
      'иначе проверка выше не значит ничего')
    check('и не меняет размера',
      Math.abs(до.w - после.w) < 0.6 && Math.abs(до.h - после.h) < 0.6,
      `${до.w}x${до.h} -> ${после.w}x${после.h}`)
  }
  win.destroy()

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
