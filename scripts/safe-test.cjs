// v1.433.0: отступы под системные полосы телефона. Запуск: npm run test:safe
//
// Зачем. С v1.425.0 приложение рисуется под часами и кнопками навигации, а
// отступы под них с v1.429.0 даёт ОБОЛОЧКА (.app), один раз на всё. Правило
// простое, но ломается тихо: элемент внутри оболочки добавляет такой же отступ
// от себя — и получается двойной. Так и было: под полем ввода на телефоне
// оставалось около семидесяти пикселей пустоты вместо тридцати, а кнопки
// звонка в обычном (не полноэкранном) виде отодвигали сообщения на пустую
// полосу посреди экрана. Глазами это выглядит как «просто много воздуха».
//
// Как проверяется. Берётся НАСТОЯЩИЙ src/styles.css; env(safe-area-inset-*) в
// стенде не работает вовсе, поэтому те же значения подставляются текстом. Дальше
// в окне 390×844 читаются вычисленные отступы: у оболочки они обязаны быть, у
// того, что лежит внутри неё, — нет, а у шторок поверх всего (position: fixed)
// снова обязаны, потому что до края экрана они достают сами.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-safe-test')
const CSS = path.join(__dirname, '..', 'src', 'styles.css')
const TOP = 44, BOT = 34, SIDE = 12

fs.mkdirSync(OUT, { recursive: true })
let css = fs.readFileSync(CSS, 'utf8')
  .replace(/env\(safe-area-inset-top\)/g, TOP + 'px')
  .replace(/env\(safe-area-inset-bottom\)/g, BOT + 'px')
  .replace(/env\(safe-area-inset-left\)/g, SIDE + 'px')
  .replace(/env\(safe-area-inset-right\)/g, SIDE + 'px')
// Подстановка убила и условие @supports — возвращаем ему истинность.
css = css.replace(/@supports \(padding: \d+px\)/g, '@supports (padding: 1px)')
fs.writeFileSync(path.join(OUT, 'styles-safe.css'), css)

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles-safe.css">
<style>*{animation:none!important;transition:none!important}html,body{margin:0;height:100%;background:#313338}</style>
<div class="app">
  <div class="servers"><div class="srv"></div></div>
  <div class="dm-side"></div>
  <div class="app-viewport">
    <div class="chat">
      <div class="chat-head"><span class="ph2-name">Собеседник</span></div>
      <div class="c2-wrap"><div class="c2-bar"><button>1</button></div></div>
      <div class="msgs"></div>
      <form class="composer cstyle-default"><textarea></textarea><button class="send-tg">↑</button></form>
    </div>
  </div>
  <div class="members"></div>
</div>
<div class="c2-wrap fs" id="fs"><div class="c2-bar"><button>1</button></div></div>
<script>
window.__pad = (sel) => {
  const el = sel === '#fs .c2-bar' ? document.querySelector('#fs .c2-bar') : document.querySelector(sel)
  if (!el) return null
  const s = getComputedStyle(el)
  return JSON.stringify({ t: parseFloat(s.paddingTop), b: parseFloat(s.paddingBottom),
    l: parseFloat(s.paddingLeft), r: parseFloat(s.paddingRight) })
}
</script>`)

let failed = 0
function check(name, ok, extra) {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверка не завершилась'); process.exit(2) }, 60000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 390, height: 844, backgroundColor: '#313338',
    webPreferences: { partition: 'safe-test-' + Date.now() } })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 500))
  const pad = async sel => JSON.parse(await win.webContents.executeJavaScript(`window.__pad(${JSON.stringify(sel)})`))

  console.log('\n── Оболочка даёт отступы один раз ──')
  const app_ = await pad('.app')
  check('оболочка отступает от часов', app_.t === TOP, 'сверху ' + app_.t)
  check('оболочка отступает от кнопок навигации', app_.b === BOT, 'снизу ' + app_.b)
  check('оболочка учитывает боковые вырезы', app_.l === SIDE && app_.r === SIDE, app_.l + '/' + app_.r)

  console.log('\n── Внутри оболочки отступ не повторяется ──')
  const comp = await pad('.composer')
  check('поле ввода не отодвигается второй раз', comp.b < BOT, 'снизу ' + comp.b)
  check('поле ввода не отодвигается от вырезов второй раз', comp.l < SIDE && comp.r < SIDE, comp.l + '/' + comp.r)
  const head = await pad('.chat-head')
  check('шапка чата не отодвигается второй раз', head.t < TOP && head.l < SIDE, 'сверху ' + head.t + ', слева ' + head.l)
  const bar = await pad('.c2-bar')
  check('кнопки звонка в чате не отодвигаются от полосы', bar.b < BOT, 'снизу ' + bar.b)

  console.log('\n── Что лежит поверх оболочки — отступает само ──')
  const fsbar = await pad('#fs .c2-bar')
  check('в полном экране звонок полосу учитывает', fsbar.b >= BOT, 'снизу ' + fsbar.b)
  const srv = await pad('.servers')
  check('рейка серверов ниже часов и выше кнопок', srv.t > TOP && srv.b > BOT, srv.t + '/' + srv.b)
  const side = await pad('.dm-side')
  check('шторка диалогов ниже часов', side.t === TOP && side.b === BOT, side.t + '/' + side.b)
  const mem = await pad('.members')
  check('список участников ниже часов и выше кнопок', mem.t > TOP && mem.b > BOT, mem.t + '/' + mem.b)

  console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nИТОГ: все проверки пройдены')
  process.exit(failed ? 1 : 0)
})
