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

  // ── v1.443.0: экранная клавиатура ────────────────────────────────────────────
  // На Android окно приложения, нарисованного во весь экран, при появлении
  // клавиатуры не уменьшается — она ложится поверх, и поле ввода оказывается под
  // ней. Высоту меряет src/lib/keyboardInset.ts и кладёт в --kb; здесь
  // проверяется, что вёрстка на неё правда реагирует и поднимает поле ввода
  // ровно на эту высоту — не меньше (иначе поле под клавиатурой) и не больше
  // (иначе над клавиатурой пустая полоса).
  // Пустышка панели звонка в стенде растягивается на треть экрана (в ней нет
  // содержимого, только кнопка) и сама переполняет колонку — для замера
  // клавиатуры её убираем, иначе меряли бы не то.
  await win.webContents.executeJavaScript("document.querySelector('.c2-wrap').style.display='none'; 1")
  const KB = 320
  const kbSet = async v => {
    await win.webContents.executeJavaScript(
      `document.documentElement.style.setProperty('--kb', ${JSON.stringify(v + 'px')});` +
      `document.body.classList.toggle('kb-open', ${v > 0}); 1`)
    await new Promise(r => setTimeout(r, 60))
  }
  const bottomOf = async sel => JSON.parse(await win.webContents.executeJavaScript(
    `JSON.stringify({ b: Math.round(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().bottom) })`)).b
  const winH = await win.webContents.executeJavaScript('window.innerHeight')

  console.log('\n── Экранная клавиатура ──')
  await kbSet(0)
  const compClosed = await bottomOf('.composer')
  await kbSet(KB)
  const compOpen = await bottomOf('.composer')
  check('поле ввода поднимается над клавиатурой', winH - compOpen >= KB,
    'от низа окна ' + (winH - compOpen) + ', клавиатура ' + KB)
  // Пока клавиатура открыта, полосу навигации она закрывает собой: держать под
  // неё ещё и отступ значит оставить пустую щель над клавиатурой. Мерить надо
  // не от края окна (там всегда есть собственный отступ поля ввода), а от
  // нижней границы оболочки: она обязана быть одинаковой и с клавиатурой, и без.
  const appEdge = async () => {
    const r = JSON.parse(await win.webContents.executeJavaScript(
      `(function(){var a=document.querySelector('.app'),s=getComputedStyle(a);`
      + `return JSON.stringify({b:a.getBoundingClientRect().bottom,p:parseFloat(s.paddingBottom)})})()`))
    return Math.round(r.b - r.p)
  }
  const edgeOpen = await appEdge()
  await kbSet(0)
  const edgeClosed = await appEdge()
  await kbSet(KB)
  check('над клавиатурой нет лишней пустоты',
    (edgeOpen - compOpen) === (edgeClosed - compClosed),
    'зазор с клавиатурой ' + (edgeOpen - compOpen) + ', без неё ' + (edgeClosed - compClosed))
  check('поднялось ровно на высоту клавиатуры', compClosed - compOpen === KB - BOT,
    'сдвиг ' + (compClosed - compOpen) + ', ожидалось ' + (KB - BOT))
  await kbSet(0)
  check('клавиатура спряталась — вёрстка вернулась', await bottomOf('.composer') === compClosed,
    'низ ' + (await bottomOf('.composer')) + ', было ' + compClosed)

  console.log('\n── Ломаем нарочно (клавиатура) ──')
  // Если бы отступ стоял на поле ввода, а не на оболочке, поднялось бы только
  // оно — переписка осталась бы под клавиатурой.
  await kbSet(KB)
  const msgsOpen = await bottomOf('.msgs')
  check('переписка тоже уходит из-под клавиатуры', winH - msgsOpen >= KB,
    'низ ленты от края ' + (winH - msgsOpen))
  await kbSet(0)

  // ── Большой экран: нижняя полоса ────────────────────────────────────────────
  // v1.434.0. Владелец дважды приносил одно и то же: внизу окна полоса пустоты,
  // приложение кончается раньше края. В v1.430.0 я «закрыл класс» вслепую, не
  // воспроизведя, — и не закрыл: полосу давал нижний отступ самого поля ввода.
  // Проверяется то, что видно глазом: низ поля ввода, низ панели с аватаркой и
  // низ окна — это одна линия.
  fs.writeFileSync(path.join(OUT, 'wide.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles-safe.css">
<style>*{animation:none!important;transition:none!important}html,body{margin:0;height:100%;background:#313338}</style>
<div id="root"><div class="app-viewport"><div class="app">
  <div class="dm-side"><div style="flex:1"></div>
    <div class="me"><span class="me-nm">я</span><button class="me-ic">m</button></div></div>
  <div class="chat"><div class="chat-head">ч</div><div class="msgs"></div>
    <form class="composer cstyle-default"><textarea></textarea><button class="send-tg">↑</button></form></div>
</div></div></div>
<script>window.__b = s => { const b = document.querySelector(s).getBoundingClientRect()
  return JSON.stringify({ top: Math.round(b.top), bottom: Math.round(b.bottom) }) }</script>`)
  const wide = new BrowserWindow({ show: false, useContentSize: true, width: 1600, height: 900,
    backgroundColor: '#313338', webPreferences: { partition: 'safe-wide-' + Date.now() } })
  await wide.loadFile(path.join(OUT, 'wide.html'))
  await new Promise(r => setTimeout(r, 400))
  const box = async s => JSON.parse(await wide.webContents.executeJavaScript(`window.__b(${JSON.stringify(s)})`))
  const wideH = await wide.webContents.executeJavaScript('window.innerHeight')
  const meW = await box('.me'), compW = await box('.composer'), chatW = await box('.chat')

  console.log('\n── Большой экран: низ окна ──')
  // v1.435.0: правило уточнено по снимку Discord, который принёс владелец: обе
  // плашки кончаются на ОДНОЙ высоте и обе отступают от низа одинаково. В
  // v1.434.0 я прижал их к самому краю — это было не то.
  const gapMe = wideH - meW.bottom, gapComp = wideH - compW.bottom
  check('колонка чата доходит до края окна', chatW.bottom === wideH, 'низ ' + chatW.bottom)
  check('низ поля и низ панели — одна линия', compW.bottom === meW.bottom,
    'поле ' + compW.bottom + ', панель ' + meW.bottom)
  check('отступ от низа у обеих одинаковый', gapMe === gapComp, 'панель ' + gapMe + ', поле ' + gapComp)
  check('отступ есть, но небольшой', gapMe > 0 && gapMe <= 16, 'отступ ' + gapMe)

  console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nИТОГ: все проверки пройдены')
  process.exit(failed ? 1 : 0)
})
