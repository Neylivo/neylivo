// v1.499.0: значки при наведении НЕ ПРЫГАЮТ. Запуск: npm run test:hover
//
// Владелец прислал снимок: аватарка подскакивала под курсором.
//
// По исходнику такое не видно: правило наведения выглядит безобидно
// (scale 1.08), и понять, что значок при этом УЕЗЖАЕТ, можно только измерив.
// На сломанной версии выходило 40×42 -> 43.2×45.4 со сдвигом −1.6, −1.7.
//
// ПОЧЕМУ НЕ НАСТОЯЩЕЙ МЫШЬЮ. Сначала я подводил указатель через sendInputEvent
// — и проверка падала через раз с «мышь не доехала»: Chromium пересчитывает
// наведение по последнему перемещению и после смены размера окна первые
// движения иногда съедает. Это беда стенда, а не стилей, и лечить её сном да
// повторами значит получить проверку, которой нельзя верить.
//
// Поэтому :hover включается НАПРЯМУЮ, через отладчик браузера
// (CSS.forcePseudoState). Состояние ровно то же, что от мыши, только приходит
// оно наверняка.
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
    const el = document.getElementById('ava')
    const r = el.getBoundingClientRect()
    return JSON.stringify({
      x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      tr: getComputedStyle(el).transform,
      тень: getComputedStyle(el).boxShadow,
    })
  })()`))
}

/**
 * Включить или снять :hover у значка через отладчик браузера.
 *
 * nodeId берём ОДИН раз и держим: DOM.getDocument выдаёт новые номера, и снятие
 * по свежему номеру не снимает состояние, поставленное по прежнему. Из-за этого
 * наведение с первого прохода оставалось включённым на втором, и «до» уже было
 * с подсветкой.
 */
let номерЗначка = 0
async function навести(win, включить) {
  const d = win.webContents.debugger
  if (!номерЗначка) {
    const { root } = await d.sendCommand('DOM.getDocument')
    const { nodeId } = await d.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#ava' })
    номерЗначка = nodeId
  }
  await d.sendCommand('CSS.forcePseudoState', {
    nodeId: номерЗначка, forcedPseudoClasses: включить ? ['hover'] : [],
  })
  // Ждём, пока это ПРАВДА применится: у подсветки есть переход, и мерка,
  // снятая сразу, поймала бы его середину.
  for (let i = 0; i < 20; i++) {
    const м = await мерка(win)
    const есть = м.тень.includes('255, 255, 255')
    if (есть === включить) return
    await new Promise(r => setTimeout(r, 60))
  }
}

app.whenReady().then(async () => {
  // ОДНО окно на оба размера: закрытое окно уносит с собой сессию, и следующее
  // берётся за file:// раньше, чем она поднимется (ERR_FAILED).
  const win = new BrowserWindow({ show: false, width: 1200, height: 700, backgroundColor: '#313338' })
  // Страницу открываем ОДИН раз, до отладчика: переход по новому адресу закрывает
  // его цель, и следующая же команда падает с «target closed». Содержимое
  // страницы не меняется — между размерами достаточно поменять ширину окна.
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 300))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('DOM.enable')
  await win.webContents.debugger.sendCommand('CSS.enable')

  for (const [имя, ширина] of [['обычный', 1200], ['телефон', 412]]) {
    win.setContentSize(ширина, 700)
    await new Promise(r => setTimeout(r, 300))

    await навести(win, false)
    const до = await мерка(win)
    await навести(win, true)
    const после = await мерка(win)

    console.log('\n── ' + имя + ' (' + ширина + ') ──')
    console.log('   до: ' + JSON.stringify(до) + '\n   после: ' + JSON.stringify(после))
    check('значок не уезжает под курсором',
      Math.abs(до.x - после.x) < 0.6 && Math.abs(до.y - после.y) < 0.6,
      `сдвиг ${Math.round((после.x - до.x) * 10) / 10}, ${Math.round((после.y - до.y) * 10) / 10}`)
    check('и не меняет размера',
      Math.abs(до.w - после.w) < 0.6 && Math.abs(до.h - после.h) < 0.6,
      `${до.w}x${до.h} -> ${после.w}x${после.h}`)
    // Без этой строки проверки выше не значат НИЧЕГО: они прошли бы и на
    // невключённом наведении. Раз движение убрали — что-то должно остаться,
    // иначе наведение просто перестало быть заметным.
    check('но наведение видно — подсветкой', до.тень !== после.тень,
      'тень: ' + до.тень + ' -> ' + после.тень)
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
