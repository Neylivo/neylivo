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
    <div class="plug-sub">Описание плагина одной строкой</div>
    <!-- v1.465.0: что плагин делает в фоне. Строка длинная нарочно: адрес
         соединения и подпись задачи легко выталкивают кнопку «Остановить»
         за край экрана, а по ней надо попадать пальцем. -->
    <div class="plug-bg">
      <div class="plug-bg-row"><span class="plug-bg-t">Проверка почты каждую минуту</span>
        <span class="plug-bg-d">раз в 60 с · сработала 1387 раз</span>
        <button class="pqs2-btn ghost">Остановить</button></div>
      <div class="plug-bg-row"><span class="plug-bg-t">Соединение</span>
        <span class="plug-bg-d">wss://очень-длинный-адрес-чужого-сервиса.example/socket/v2/stream</span></div>
    </div></div>
  <!-- Холст плагина: он тянется на всю ширину и не должен выталкивать панель. -->
  <div class="plugpanel"><div class="plugpanel-h"><span class="plugpanel-tag">плагин</span><b>Визуализатор</b></div>
    <div class="plugpanel-cbox" style="height:160px"><canvas class="plugpanel-canvas" width="600" height="160"></canvas></div>
  </div>
  <!-- v1.468.0: личная передача. Код крупный и длинный, поле ввода кода и
       кнопка «Получить» стоят в строку — на 390 пикселях это первое, что
       выталкивается за край. -->
  <div class="grant-claim"><input class="modal-in" value="ABCD-EFGH-2345"><button class="pqs2-btn">Получить</button></div>
  <div class="grant-list"><div class="grant-item">
    <div class="grant-item-h"><b>Плагин с длинным названием для проверки</b>
      <span class="grant-badge">можно забрать 1</span></div>
    <div class="grant-item-code"><code>ABCD-EFGH-2345</code><button class="pqs2-btn ghost">к</button></div>
    <div class="grant-item-d">именная · до 31.12.2026 · забрали: 1</div>
    <div class="grant-item-a"><button class="pqs2-btn ghost">Отозвать</button>
      <button class="pqs2-btn ghost danger">Удалить</button></div>
  </div></div>
  <div class="grant-code">ABCD-EFGH-2345</div>
  <div class="pqs-sec-t">Настройки</div>
  <div class="pqs-optrow"><div><div class="pqs-optt">Переключатель с длинным названием</div>
    <div class="pqs-optd">Пояснение под ним, тоже не короткое</div></div>
    <div><button class="pqs-toggle on"><span></span></button></div></div>
  <div class="pqs-optrow"><div><div class="pqs-optt">Выбор</div></div>
    <div><select class="modal-in"><option>Вариант</option></select></div></div>
  <div class="pqs-optrow"><div><div class="pqs-optt">Кнопка</div></div>
    <div><button class="pqs2-btn ghost">Нажать</button></div></div>
  <!-- v1.467.0: выбор сочетания клавиш. Кнопка длинная («Нажми сочетание…»)
       и на 390 пикселях легко выталкивает строку за край. -->
  <div class="pqs-optrow"><div><div class="pqs-optt">Горячая клавиша вызова</div>
    <div class="pqs-optd">Нужны два модификатора</div></div>
    <div class="plug-keybind"><button class="pqs2-btn ghost">Нажми сочетание…</button>
      <button class="pqs2-btn ghost danger">×</button></div></div>
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
  let tapH = 0, tapWhy = ''
  const tg = document.querySelector('.pqs-toggle')
  if (tg) {
    // v1.465.0: сперва подводим переключатель к середине экрана.
    //
    // Зона нажатия меряется через elementFromPoint, а он видит ТОЛЬКО то, что
    // сейчас в окне. Стоило добавить на стенд ещё один блок сверху — и
    // переключатель уехал за нижний край, замер оборвался на полпути и показал
    // 38 вместо 43. То есть замер зависел от длины страницы, а не от того, что
    // проверяется. Такой «провал» хуже пропущенной поломки: он учит не верить
    // проверкам.
    tg.scrollIntoView({ block: 'center' })
    const b = tg.getBoundingClientRect()
    if (b.top < 0 || b.bottom > innerHeight) tapWhy = 'переключатель не помещается в окно'
    const x = Math.round(b.left + b.width / 2)
    const hit = y => { const e = document.elementFromPoint(x, y); return !!e && (e === tg || tg.contains(e) || e.parentElement === tg) }
    let top = Math.round(b.top), bottom = Math.round(b.bottom)
    while (hit(top - 1) && top > b.top - 20) top--
    while (hit(bottom + 1) && bottom < b.bottom + 20) bottom++
    tapH = bottom - top
  }
  return JSON.stringify({ win: innerWidth, out,
    cols: getComputedStyle(document.querySelector('.cat-grid')).gridTemplateColumns.trim().split(/\s+/).length,
    btns, small, tapH, tapWhy, scroll: document.body.scrollWidth })
}</script>`)
  const plug = new BrowserWindow({ show: false, useContentSize: true, width: 390, height: 844,
    backgroundColor: '#313338', webPreferences: { partition: 'safe-plug-' + Date.now() } })
  await plug.loadFile(path.join(OUT, 'plug.html'))
  await new Promise(r => setTimeout(r, 400))
  const pm = JSON.parse(await plug.webContents.executeJavaScript('window.__p()'))

  // ── v1.470.0: до всего ли можно долистать ────────────────────────────────────
  //
  // Владелец: «настройки на телефоне не листаются, дальше плагинов не видно» — и
  // это было буквально так. Список разделов вырастал во всё своё содержимое
  // (2081 пиксель в области на 748), собственная прокрутка при этом не
  // включалась — элемент ведь не ограничен по высоте, — а родитель не
  // прокручивается вовсе. Половина разделов, включая «Выйти», была недостижима.
  //
  // Обычная проверка на переполнение такое не ловит: элементы «влезают» в свой
  // же раздутый контейнер. Ловить надо иначе — попыткой ДОЛИСТАТЬ до последнего.
  fs.writeFileSync(path.join(OUT, 'scroll.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles-safe.css">
<style>*{animation:none!important;transition:none!important}html,body{margin:0;height:100%;background:#313338}</style>
<div class="pqs2-overlay"><div class="pqs2 mob-nav">
  <div class="pqs2-head"><button class="pqs2-back">‹</button><b>Настройки</b></div>
  <div class="pqs2-body">
    <div class="pqs2-side"><div class="pqs2-nav">
      ${Array.from({ length: 9 }, (_, g) => '<div>' + Array.from({ length: 4 }, (_, i) =>
        '<div class="pqs2-item"><span class="pqs2-item-ic">o</span>Раздел ' + (g * 4 + i + 1) + '</div>').join('') + '</div>').join('')}
      <div class="pqs2-item danger" id="последний">Выйти</div></div></div>
  </div>
</div></div>
<script>window.__s = () => {
  const out = {}
  for (const [имя, sel, хвост] of [['список разделов', '.pqs2-side', '#последний']]) {
    const box = document.querySelector(sel), tail = document.querySelector(хвост)
    box.scrollTop = 0
    const до = box.scrollTop
    box.scrollTop = 99999
    const r = tail.getBoundingClientRect()
    out[имя] = { двигается: box.scrollTop - до, виден: r.top >= 0 && r.bottom <= innerHeight,
                 низ: Math.round(r.bottom), окно: innerHeight,
                 высота: Math.round(box.clientHeight) }
  }
  return JSON.stringify(out)
}</script>`)
  const scr = new BrowserWindow({ show: false, useContentSize: true, width: 390, height: 844,
    backgroundColor: '#313338', webPreferences: { partition: 'safe-scroll-' + Date.now() } })
  await scr.loadFile(path.join(OUT, 'scroll.html'))
  await new Promise(r => setTimeout(r, 300))
  const sm = JSON.parse(await scr.webContents.executeJavaScript('window.__s()'))

  console.log('\n── До всего ли можно долистать ──')
  for (const [имя, d] of Object.entries(sm)) {
    // Признак «надо прокручивать» тут не годится: при поломке список
    // раздувается во всё содержимое, scrollHeight сравнивается с clientHeight, и
    // признак становится ложным — проверка успокаивала бы ровно там, где сломано.
    // Настоящий признак: сама область не выше экрана.
    check(имя + ': область не выше экрана', d.высота <= d.окно,
      'высота области ' + d.высота + ' при экране ' + d.окно)
    check(имя + ': до последней строки можно добраться', d.виден,
      'низ последней строки ' + d.низ + ' при экране ' + d.окно)
  }
  scr.destroy()

  console.log('\n── Плагины и боты на телефоне ──')
  check('ничего не вылезает за край экрана', pm.out.length === 0, pm.out.join('; '))
  check('страница не ездит вбок', pm.scroll <= pm.win, 'ширина ' + pm.scroll + ' при экране ' + pm.win)
  check('каталог в одну колонку', pm.cols === 1, 'колонок ' + pm.cols)
  check('по кнопкам можно попасть пальцем', pm.btns.length > 0 && pm.btns.every(h => h >= 40),
    'высоты: ' + pm.btns.join(', '))
  // v1.445.0: переключатель настроек был 44×25, а кнопки в строках — 32 пикселя.
  // Попасть по такому можно, промахнуться проще.
  check('в настройках нет мелких кнопок и полей', pm.small.length === 0, pm.small.join('; '))
  check('по переключателю можно попасть пальцем', pm.tapH >= 40 && !pm.tapWhy, 'зона нажатия ' + pm.tapH + ' пикселей' + (pm.tapWhy ? ' — ' + pm.tapWhy : ''))

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

  // ── v1.454.0: сплошной обход экранов на телефоне ────────────────────────────
  // Раньше телефонный вид проверялся точечно — там, где владелец уже споткнулся.
  // Здесь наоборот: берётся десяток настоящих кусков разметки и каждый меряется
  // на предмет трёх бед сразу — вылезло за край, мелко для пальца, нечитаемо
  // мелкий шрифт. Так первым спотыкается стенд, а не человек.
  //
  // Что нашлось этим обходом в первый же запуск: кнопки в шапке чата 23×21,
  // реакции 50×30, ячейки эмодзи 34×23, переключатели прав 28×24.
  const БЛОКИ = {"чат: сообщение и поле ввода": "<div class=\"app\"><div class=\"chat\"><div class=\"msgs\"><div class=\"msg\"><div class=\"msg-gutter\"><span class=\"av-click\"></span></div><div class=\"msg-body\"><div class=\"msg-hdr\"><span class=\"nm\">ОченьДлинныйНик</span><span class=\"msg-time\">12:34</span></div><div class=\"msg-txt\">Обычное сообщение с длинным текстом, чтобы проверить края</div><div class=\"rx-bar\"><button class=\"rx\">A 3</button><button class=\"rx\">B 12</button></div></div></div></div><form class=\"composer cstyle-default\"><button class=\"attach-btn\">+</button><textarea></textarea><button class=\"ctool\">G</button><button class=\"send-tg\">^</button></form></div></div>", "чат: шапка": "<div class=\"app\"><div class=\"chat\"><div class=\"chat-head\"><button class=\"mob-burger\">=</button><span class=\"ph2-hash\">#</span><span class=\"ph2-name\">очень-длинное-название-канала</span><div class=\"ph2-btns\"><button>1</button><button>2</button><button>3</button><button>4</button></div></div></div></div>", "профиль: активность": "<div class=\"app\"><div class=\"pqs2-main\"><div class=\"pqs2-inner\"><div class=\"act-card fp-cur clickable\"><div class=\"act-head\"><span class=\"mpg-kind\">i</span>Играет в</div><div class=\"act-row\"><span class=\"act-cover act-cover-lg act-cover-ph\">i</span><div class=\"act-info\"><div class=\"act-name act-name-lg\">Игра с длинным названием издания</div><div class=\"act-mode\">режим</div><div class=\"act-meta\"><span class=\"act-time\">2 ч</span><span>x5 д. подряд</span><span>Миссия 8 из 24 · 29%</span></div></div></div></div></div></div></div>", "плеер": "<div class=\"app\"><div class=\"mus2\"><div class=\"mus2-now\"><div class=\"mus2-nowt\">Название трека, довольно длинное</div><div class=\"mus2-nowsub\">Исполнитель</div><div class=\"mus2-ctl\"><button>1</button><button class=\"big\">2</button><button>3</button><button>4</button></div></div></div></div>", "окно с полями и правами": "<div class=\"modal-overlay\"><div class=\"modal\"><div class=\"modal-title\">Настройки</div><label class=\"modal-lbl\">Название</label><input class=\"modal-in\" value=\"текст\"><div class=\"cset-tri\"><button class=\"deny\">x</button><button class=\"def\">/</button><button class=\"allow\">v</button></div><div class=\"modal-foot\"><button class=\"modal-ghost\">Отмена</button><button class=\"modal-primary\">Сохранить</button></div></div></div>", "выбор эмодзи": "<div class=\"ep2\"><div class=\"ep2-head\"><input class=\"ep2-search\"></div><div class=\"emoji-scroll\"><div class=\"ep2-grid\"><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button></div></div></div>", "участники и диалоги": "<div class=\"app\" data-open=\"1\"><div class=\"dm-side\"><div class=\"dm-item\"><span class=\"dm-av\"></span><div class=\"dm-tx\"><div class=\"dm-nm\">Собеседник с длинным именем</div><div class=\"dm-sub\">последнее сообщение</div></div><span class=\"dm-badge\">9</span></div></div><div class=\"members\"><div class=\"mem-grp\">В СЕТИ</div><div class=\"mem\"><span class=\"mem-av\"></span><span class=\"mem-nm\">Участник с очень длинным именем</span></div></div></div>", "звонок: панель кнопок": "<div class=\"app\"><div class=\"c2-wrap\"><div class=\"c2-bar\"><button class=\"c2-btn\">1</button><button class=\"c2-btn\">2</button><button class=\"c2-btn\">3</button><button class=\"c2-btn\">4</button><button class=\"c2-btn leave\">5</button></div></div></div>", "форум: карточка обсуждения": "<div class=\"app\"><div class=\"forum\"><div class=\"forum-card\"><div class=\"forum-card-body\"><div class=\"forum-card-t\">Обсуждение с довольно длинным заголовком, который не влезает в строку</div><div class=\"forum-card-sub\">автор · 12 сообщений</div></div><div class=\"forum-card-act\"><button>1</button><button>2</button></div></div></div></div>", "ветка обсуждения": "<div class=\"app\"><div class=\"thread-view\"><div class=\"thread-view-head\"><div class=\"thread-view-t\">Ветка с длинным названием</div><button class=\"modal-x\">x</button></div><div class=\"thread-view-msgs\"></div></div></div>", "настройки сервера": "<div class=\"app\"><div class=\"cset sset\"><div class=\"cset-main\"><div class=\"cset-h\">Обзор</div><label class=\"cset-lbl\">Название</label><input class=\"cset-in\" value=\"Сервер\"><div class=\"cset-hint\">Пояснение к настройке</div><div class=\"cset-foot\"><button class=\"cset-reset\">Сбросить</button><button class=\"cset-save\">Сохранить</button></div></div></div></div>", "выбор сообщений": "<div class=\"app\"><div class=\"chat\"><div class=\"msgs\"><div class=\"bulk-bar\"><button class=\"bulk-x\">x</button><div class=\"bulk-tx\"><b>Выбрано: 3 сообщения</b><span>2 чужих удалить нельзя</span></div><button class=\"bulk-go\">Удалить 3 сообщения</button></div><div class=\"msg picking picked\"><div class=\"msg-gutter\"><span class=\"msg-pick on\"></span></div><div class=\"msg-body\"><div class=\"msg-txt\">выбранное сообщение</div></div></div></div></div></div>", "меню сообщения (шторка)": "<div class=\"ctxmenu\"><div class=\"ctxmenu-item\">Ответить</div><div class=\"ctxmenu-item\">Копировать текст</div><div class=\"ctxmenu-item\">Выбрать сообщения</div><div class=\"ctxmenu-item danger\">Удалить сообщение</div></div>", "прохождение игры": "<div class=\"modal-overlay\"><div class=\"modal cmp\"><div class=\"modal-title\" style=\"margin:0\">Игра</div><div class=\"cmp-sub\">Миссия 8 из 24 · 29%</div><div class=\"cmp-bar\"><div class=\"cmp-bar-fill\" style=\"width:29%\"></div><span class=\"cmp-bar-tx\">29%</span></div><div class=\"cmp-list\"><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">1</span><span class=\"cmp-nm\">Миссия 1 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">2</span><span class=\"cmp-nm\">Миссия 2 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">3</span><span class=\"cmp-nm\">Миссия 3 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">4</span><span class=\"cmp-nm\">Миссия 4 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">5</span><span class=\"cmp-nm\">Миссия 5 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">6</span><span class=\"cmp-nm\">Миссия 6 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">7</span><span class=\"cmp-nm\">Миссия 7 с длинным названием задания</span></div><div class=\"cmp-row\"><button class=\"cmp-tick\"></button><span class=\"cmp-num\">8</span><span class=\"cmp-nm\">Миссия 8 с длинным названием задания</span></div></div><div class=\"cmp-ask\"><div class=\"cmp-ask-row\"><input class=\"modal-in\"><button class=\"pqs2-btn\">Спросить</button></div></div></div></div>", "вход в приложение": "<div class=\"auth2\"><div class=\"auth2-card\"><div class=\"auth2-fields\"><div class=\"auth2-field\"><input class=\"modal-in\" placeholder=\"Почта\"></div><div class=\"auth2-field\"><input class=\"modal-in\" type=\"password\" placeholder=\"Пароль\"></div></div><button class=\"auth2-btn\">Войти</button><button class=\"auth2-btn ghost\">Регистрация</button><div class=\"auth2-sub\">Нужен аккаунт?</div></div></div>", "просмотр картинки": "<div class=\"lb\"><div class=\"lb-tools\"><button>1</button><button>2</button><button>3</button><button>4</button><button>5</button></div><div class=\"lb-cap\">подпись к картинке</div></div>", "каталог ботов": "<div class=\"app\"><div class=\"pqs2-main\"><div class=\"pqs2-inner\"><div class=\"cat-grid\"><div class=\"cat-tile\"><div class=\"cat-tile-bg plain\"></div><div class=\"cat-tile-ic\"><span class=\"cat-emoji\">B</span></div><div class=\"cat-tile-body\"><div class=\"cat-nm\"><span class=\"cat-nm-t\">Бот с длинным именем</span><span class=\"cat-badge audit warn\">Не проверен</span></div><div class=\"cat-sum\">Что умеет этот бот</div><div class=\"cat-meta\"><span class=\"cat-author\">Автор</span></div><div class=\"cat-acts\"><button class=\"pqs2-btn\">Добавить</button><button class=\"pqs2-btn ghost danger\">x</button></div></div></div></div></div></div></div>", "мини-профиль": "<div class=\"mini\"><div class=\"mini-banner\"></div><div class=\"mini-body\"><div class=\"mini-avrow\"><span class=\"mini-av\"></span></div><div class=\"mini-about\">О себе, довольно длинная строка</div><button class=\"mini-addrole\">+ роль</button></div></div>", "история активностей": "<div class=\"app\"><div class=\"pqs2-main\"><div class=\"pqs2-inner\"><div class=\"fp-sect\">Недавняя активность</div><div class=\"fp-recent clickable\"><span class=\"act-cover act-cover-sm act-cover-ph\">i</span><div class=\"act-info\"><div class=\"act-name\">Игра с очень длинным названием издания</div><div class=\"act-meta\"><span>2 дня назад</span><span>Популярное</span></div><div class=\"act-meta\"><span>Марафон в 8 ч.</span><span>Новый игрок</span></div><div class=\"act-meta\"><span>Прохождение</span></div></div></div></div></div></div>", "схема прохождения": "<div class=\"modal-overlay\"><div class=\"modal cmp\"><div class=\"modal-title\" style=\"margin:0\">Игра</div><div class=\"cmp-sub\">Пройдено 6 из 14 · 43%</div><div class=\"cmp-bar\"><div class=\"cmp-bar-fill\" style=\"width:43%\"></div><span class=\"cmp-bar-tx\">43%</span></div><div class=\"flow-wrap\"><div class=\"flow-tools\"><button>-</button><button>+</button></div><div class=\"flow-box\"><div class=\"flow-canvas\" style=\"width:900px;height:300px\"><div class=\"flow-node cur\" style=\"left:28px;top:28px;width:190px;height:62px\"><span class=\"flow-ic ph\">7</span><span class=\"flow-nm\">Веха с длинным названием</span><span class=\"flow-here\">сейчас здесь</span></div></div></div></div><div class=\"cmp-ask\"><div class=\"cmp-ask-row\"><input class=\"modal-in\"><button class=\"pqs2-btn\">Спросить</button></div></div></div></div>", "выбор эмодзи и гифок": "<div class=\"emoji-pop\"><div class=\"ep2-head\"><input class=\"ep2-search\"></div><div class=\"emoji-scroll\"><div class=\"ep2-grid\"><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button><button class=\"ep2-e\">A</button></div></div><div class=\"ep2-hint\">:blue_square:</div></div>", "мои темы": "<div class=\"app\"><div class=\"pqs2-main\"><div class=\"pqs2-inner\"><div class=\"pqs-custom\"><div class=\"pqs-custom-h\">Мои темы</div><div class=\"pqs-theme-save\"><input class=\"pqs-in\" placeholder=\"Название\"><button class=\"pqs-save\">Сохранить тему</button></div><div class=\"pqs-theme-list\"><div class=\"pqs-theme-row\"><span class=\"pqs-theme-dots\"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class=\"pqs-theme-nm\">Тема с длинным названием</span><button class=\"pqs-code-copy\">Включить</button><button class=\"pqs-code-copy\">Код</button><button class=\"pqs-custom-x\">x</button></div></div></div></div></div></div>"}
  fs.writeFileSync(path.join(OUT, 'sweep.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles-safe.css">
<style>*{animation:none!important;transition:none!important}html,body{margin:0;height:100%;background:#313338}
#stage{position:fixed;inset:0;overflow:hidden}</style>
<div id="stage"></div>
<script>window.__sweep = (БЛОКИ) => {
  const stage = document.getElementById('stage')
  const плохо = []
  for (const [имя, разметка] of Object.entries(БЛОКИ)) {
    stage.innerHTML = разметка
    document.body.classList.toggle('mob-nav-open', разметка.includes('data-open'))
    document.querySelectorAll('#stage *').forEach(e => {
      const b = e.getBoundingClientRect()
      if (b.width <= 0 || b.height <= 0) return
      const cls = (typeof e.className === 'string' ? e.className : '') || e.tagName
      // Содержимое ПРОКРУЧИВАЕМОЙ области шире экрана — это норма, а не беда:
      // схема прохождения и списки для того и возят пальцем. Ругаться на них
      // значит приучить себя не смотреть на замечания.
      let вПрокрутке = false
      for (let a = e.parentElement; a && a.id !== 'stage'; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowX
        if (ov === 'auto' || ov === 'scroll') { вПрокрутке = true; break }
      }
      if (!вПрокрутке && (b.right > innerWidth + 1 || b.left < -1)) плохо.push(имя + ': вылез ' + cls)
      if (/^(BUTTON|SELECT)$/.test(e.tagName) && b.height < 34) плохо.push(имя + ': мелкая кнопка ' + cls + ' ' + Math.round(b.width) + 'x' + Math.round(b.height))
      // v1.455.0: кнопка вплотную к краю экрана. На телефоне с закруглённым
      // стеклом крайние пиксели нажимаются плохо, а свайп от края (v1.453.0)
      // начинается ровно оттуда — то есть попытка нажать открывала бы шторку.
      if (/^BUTTON$/.test(e.tagName) && (b.left < 6 || b.right > innerWidth - 6)) плохо.push(имя + ': кнопка у самого края ' + cls)
      const fz = parseFloat(getComputedStyle(e).fontSize)
      if (e.children.length === 0 && e.textContent.trim() && fz < 11) плохо.push(имя + ': мелкий текст ' + cls + ' ' + fz)
    })
    // v1.455.0: соседние кнопки вплотную. Промах по такой паре — это не «не
    // попал», а «нажал не то»: отменил вместо отправки, удалил вместо ответа.
    const кнопки = [...document.querySelectorAll('#stage button')]
      .map(b => b.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0)
    for (let i = 0; i < кнопки.length; i++) {
      for (let j = i + 1; j < кнопки.length; j++) {
        const a = кнопки[i], b2 = кнопки[j]
        const рядомПоВертикали = a.top < b2.bottom && b2.top < a.bottom
        if (!рядомПоВертикали) continue
        const зазор = a.right <= b2.left ? b2.left - a.right : (b2.right <= a.left ? a.left - b2.right : -1)
        // Слитный переключатель (три сегмента одной настройки) — законный вид,
        // и зазора там быть не должно. Опасно другое: МЕЛКИЕ кнопки вплотную —
        // там промах означает не «не попал», а «нажал соседнее».
        const узкая = Math.min(a.width, b2.width) < 44
        if (зазор >= 0 && зазор < 4 && узкая) плохо.push(имя + ': мелкие кнопки вплотную, зазор ' + Math.round(зазор) + 'px')
      }
    }
    if (document.documentElement.scrollWidth > innerWidth) плохо.push(имя + ': страница ездит вбок')
  }
  return JSON.stringify([...new Set(плохо)])
}</script>`)
  const sw = new BrowserWindow({ show: false, useContentSize: true, width: 390, height: 844,
    backgroundColor: '#313338', webPreferences: { partition: 'safe-sweep-' + Date.now() } })
  await sw.loadFile(path.join(OUT, 'sweep.html'))
  await new Promise(r => setTimeout(r, 350))
  const беды = JSON.parse(await sw.webContents.executeJavaScript(
    'window.__sweep(' + JSON.stringify(БЛОКИ) + ')'))

  console.log('\n── Сплошной обход экранов (390×844) ──')
  check('экранов проверено: ' + Object.keys(БЛОКИ).length, Object.keys(БЛОКИ).length >= 7)
  check('ничего не вылезает и не мелко для пальца', беды.length === 0, беды.slice(0, 4).join(' | '))

  console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nИТОГ: все проверки пройдены')
  process.exit(failed ? 1 : 0)
})
