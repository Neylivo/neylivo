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

  // ── v1.445.0: плагины и боты на телефоне ─────────────────────────────────────
  // Экраны управления плагинами рисовались теми же правилами, что и на большом
  // окне: ряд кнопок стоял в одной строке с названием и занимал её почти
  // целиком, а ярлыки рядом с названием уезжали за правый край — «стоит» на
  // телефоне просто не было видно. Здесь проверяется то, что видно глазом:
  // ничего не вылезает за экран, а по кнопкам можно попасть пальцем.
  fs.writeFileSync(path.join(OUT, 'plug.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles-safe.css">
<style>*{animation:none!important;transition:none!important}html,body{margin:0;height:100%;background:#313338}</style>
<div class="pqs2-overlay"><div class="pqs2 mob-content"><div class="pqs2-body">
 <div class="pqs2-main"><div class="pqs2-inner">
  <div class="cat-grid">
    <div class="cat-tile"><div class="cat-tile-bg plain"></div>
      <div class="cat-tile-ic"><span class="cat-emoji">A</span></div>
      <div class="cat-tile-body">
        <div class="cat-nm"><span class="cat-nm-t">Очень длинное название плагина, которое не влезает</span><span class="cat-badge audit warn">Не проверен</span><span class="cat-badge on">стоит</span></div>
        <div class="cat-sum">Короткое описание</div>
        <div class="cat-meta"><span class="cat-author">Автор</span></div>
        <div class="cat-acts"><button class="pqs2-btn">Установить</button><button class="pqs2-btn ghost danger">x</button></div>
      </div></div>
  </div>
  <div class="plug-card"><div class="plug-head">
      <div class="plug-ic ph">A</div>
      <div class="plug-name">Плагин с длинным именем <span class="plug-ver">1.0.0</span></div>
      <div class="plug-dot on"></div>
      <div class="plug-actions"><button class="pqs2-btn ghost">Настройки</button><button class="pqs2-btn ghost">Журнал</button><button class="pqs2-btn ghost danger">Удалить</button></div>
    </div>
    <div class="plug-sub">Описание плагина одной строкой</div></div>
  <div class="pqs-sec-t">Настройки</div>
  <div class="pqs-optrow"><div><div class="pqs-optt">Переключатель с длинным названием</div>
    <div class="pqs-optd">Пояснение под ним, тоже не короткое</div></div>
    <div><button class="pqs-toggle on"><span></span></button></div></div>
  <div class="pqs-optrow"><div><div class="pqs-optt">Выбор</div></div>
    <div><select class="modal-in"><option>Вариант</option></select></div></div>
  <div class="pqs-optrow"><div><div class="pqs-optt">Кнопка</div></div>
    <div><button class="pqs2-btn ghost">Нажать</button></div></div>
 </div></div>
</div></div></div>
<script>window.__p = () => {
  const out = []
  document.querySelectorAll('*').forEach(e => { const b = e.getBoundingClientRect()
    if (b.width > 0 && (b.right > innerWidth + 1 || b.left < -1)) out.push((e.className || e.tagName) + ' ' + Math.round(b.left) + '..' + Math.round(b.right)) })
  const btns = [...document.querySelectorAll('.plug-actions > button, .cat-acts > button')]
    .map(b => Math.round(b.getBoundingClientRect().height))
  // Всё, по чему надо попадать пальцем, — не мельче сорока пикселей.
  const small = []
  document.querySelectorAll('button, select, input').forEach(e => {
    if (e.classList.contains('pqs-toggle')) return   // у него меряется зона нажатия, см. ниже
    const b = e.getBoundingClientRect()
    if (b.width > 0 && b.height < 40) small.push((e.className || e.tagName) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height))
  })
  // Переключатель растягивать нельзя — получится полоса с кружком у края.
  // Поэтому меряем не его размер, а то, куда попадёт палец: тыкаем на 5 пикселей
  // выше и ниже видимых границ и смотрим, попали ли по переключателю.
  let tapH = 0
  const tg = document.querySelector('.pqs-toggle')
  if (tg) {
    const b = tg.getBoundingClientRect()
    const x = Math.round(b.left + b.width / 2)
    const hit = y => { const e = document.elementFromPoint(x, y); return !!e && (e === tg || tg.contains(e) || e.parentElement === tg) }
    let top = Math.round(b.top), bottom = Math.round(b.bottom)
    while (hit(top - 1) && top > b.top - 20) top--
    while (hit(bottom + 1) && bottom < b.bottom + 20) bottom++
    tapH = bottom - top
  }
  return JSON.stringify({ win: innerWidth, out,
    cols: getComputedStyle(document.querySelector('.cat-grid')).gridTemplateColumns.trim().split(/\s+/).length,
    btns, small, tapH, scroll: document.body.scrollWidth })
}</script>`)
  const plug = new BrowserWindow({ show: false, useContentSize: true, width: 390, height: 844,
    backgroundColor: '#313338', webPreferences: { partition: 'safe-plug-' + Date.now() } })
  await plug.loadFile(path.join(OUT, 'plug.html'))
  await new Promise(r => setTimeout(r, 400))
  const pm = JSON.parse(await plug.webContents.executeJavaScript('window.__p()'))

  console.log('\n── Плагины и боты на телефоне ──')
  check('ничего не вылезает за край экрана', pm.out.length === 0, pm.out.join('; '))
  check('страница не ездит вбок', pm.scroll <= pm.win, 'ширина ' + pm.scroll + ' при экране ' + pm.win)
  check('каталог в одну колонку', pm.cols === 1, 'колонок ' + pm.cols)
  check('по кнопкам можно попасть пальцем', pm.btns.length > 0 && pm.btns.every(h => h >= 40),
    'высоты: ' + pm.btns.join(', '))
  // v1.445.0: переключатель настроек был 44×25, а кнопки в строках — 32 пикселя.
  // Попасть по такому можно, промахнуться проще.
  check('в настройках нет мелких кнопок и полей', pm.small.length === 0, pm.small.join('; '))
  check('по переключателю можно попасть пальцем', pm.tapH >= 40, 'зона нажатия ' + pm.tapH + ' пикселей')

  // ── v1.450.0: окно подтверждения поверх всего ────────────────────────────────
  // Владелец принёс: «Закрыть конструктор?» появляется ПОД меню плагинов, и
  // нажать нечем. Причина: #root у нас position: fixed — это отдельный слой, и
  // z-index 390 у подтверждения считался только среди своих, а большие экраны
  // выносятся порталом прямо в <body> и рисуются после #root целиком.
  // Проверяется не порядок в разметке, а то, что видно глазом: попадёт ли
  // нажатие в кнопку.
  fs.writeFileSync(path.join(OUT, 'layer.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles-safe.css">
<style>*{animation:none!important;transition:none!important}html,body{margin:0;height:100%;background:#313338}</style>
<div id="root"><div class="app"></div></div>
<div class="ped-screen"><div class="ped-sheet">конструктор</div></div>
<div class="cfm-overlay"><div class="cfm-box"><div class="cfm-btns">
  <button class="cfm-cancel">Отмена</button><button class="cfm-ok danger" id="ok">Закрыть</button></div></div></div>
<div class="toasts"><div class="toast toast-err" id="tst">отказ</div></div>
<script>window.__hit = () => {
  const at = el => { const b = el.getBoundingClientRect()
    const t = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2))
    return !!t && (t === el || el.contains(t)) }
  return JSON.stringify({ ok: at(document.getElementById('ok')), toast: at(document.getElementById('tst')) })
}</script>`)
  const lay = new BrowserWindow({ show: false, useContentSize: true, width: 1200, height: 800,
    backgroundColor: '#313338', webPreferences: { partition: 'safe-layer-' + Date.now() } })
  await lay.loadFile(path.join(OUT, 'layer.html'))
  await new Promise(r => setTimeout(r, 300))
  const lm = JSON.parse(await lay.webContents.executeJavaScript('window.__hit()'))

  console.log('\n── Что поверх чего ──')
  check('по кнопке подтверждения можно нажать поверх большого экрана', lm.ok,
    'нажатие уходит не в кнопку')
  check('плашка отказа видна поверх большого экрана', lm.toast, 'плашка под экраном')
  // Проверка выше стережёт СТИЛИ (390 против 150). А то, что подтверждение и
  // плашки вообще оказываются на уровне <body>, держится на портале — уберут
  // его, и стили снова ничего не решат, потому что #root свой отдельный слой.
  for (const [что, файл] of [['подтверждение', 'src/lib/confirm.tsx'], ['плашки', 'src/lib/toast.tsx']]) {
    const src = fs.readFileSync(path.join(__dirname, '..', файл), 'utf8')
    check(что + ' выносится порталом в <body>', /<Portal>/.test(src) && /from '\.\.\/components\/Portal'/.test(src),
      'портала нет в ' + файл)
  }

  console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nИТОГ: все проверки пройдены')
  process.exit(failed ? 1 : 0)
})
