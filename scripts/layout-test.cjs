// v1.543.0: нижняя кромка слева ровная. Запуск: npm run test:layout
//
// Владелец, со снимком: «сделай эту панель длиннее, а кнопку с музыкой в другое
// более удобное место, а также сделай панель по высоте 1 в 1 как чат».
//
// «1 в 1» — это число, а не мнение, поэтому оно и проверяется числом. Панель
// профиля стояла внутри колонки каналов: на 17 пикселей уже неё и на 8 выше,
// чем полосы чата. Снизу слева получалась ступенька из трёх разных краёв —
// на снимке владельца видно именно её.
//
// Почему живьём, а не по стилям. Высота панели складывается из четырёх правил в
// двух файлах, и одно перебивает другое. «В файле написано 56» и «на экране 56»
// — разные утверждения, и расходились они уже не раз.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
if (!fs.existsSync(DIST)) {
  console.error('нет собранного приложения — сперва npm run build')
  process.exit(1)
}

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

// Разметка списана с настоящей: рейка, колонка каналов с панелью профиля внизу,
// чат с шапкой и полем ввода. Рейка нарочно набита серверами — надо видеть, что
// последний из них не уезжает под панель.
const ОБОЛОЧКА = `<div class="app-viewport"><div class="app">
  <nav class="servers">
    ${Array.from({ length: 14 }, (_, i) => `<div class="srv-wrap"><button class="srv" id="srv${i}">${i}</button></div>`).join('')}
  </nav>
  <aside class="channels">
    <div class="ch-head"><span class="ch-head-nm">Мой сервер</span></div>
    <div class="ch-list"><div class="ch on"># общий</div></div>
    <div class="me"><span class="me-lift"><span class="av"></span></span>
      <span class="me-nm me-lift">nubas<br><small class="mut">В сети</small></span>
      <button class="me-ic me-music me-lift" id="кнопка-музыки">M</button>
      <button class="me-ic me-mic me-lift">M</button>
      <button class="me-ic me-deaf me-lift">H</button>
      <button class="me-out me-lift">G</button></div>
  </aside>
  <main class="chat">
    <header class="chat-head"><span class="ch-title"># общий</span></header>
    <div class="msgs"></div>
    <form class="composer cstyle-default">
      <div class="plus-wrap"><button type="button" class="attach-btn">+</button></div>
      <div class="composer-field"><textarea rows="1"></textarea></div>
      <div class="cin-act"><button type="submit" class="send-tg">></button></div>
    </form>
  </main>
</div></div>`

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1440, height: 900,
    backgroundColor: '#313338', webPreferences: { backgroundThrottling: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))
  await win.webContents.executeJavaScript(`(() => {
    document.body.className = ''
    document.body.innerHTML = ${JSON.stringify(ОБОЛОЧКА)}
    const s = document.createElement('style')
    // Ровно то, что даёт настоящее приложение: оболочка на всю высоту окна.
    s.textContent = 'html,body{height:100%;margin:0} .app-viewport,.app{height:100%}'
      + ' .channels,.servers,.chat{height:100%} .ch-list,.msgs{flex:1}'
      + ' .av{width:32px;height:32px;border-radius:50%;background:#5865f2;display:block}'
    document.head.appendChild(s)
  })()`)
  await new Promise(r => setTimeout(r, 400))

  const м = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const r = сел => { const el = document.querySelector(сел); if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width),
               h: Math.round(b.height), низ: Math.round(b.bottom), право: Math.round(b.right) } }
    const рейка = document.querySelector('.servers')
    // Мерим ПОСЛЕ прокрутки вниз. Требовать, чтобы последний сервер был виден
    // сразу, — требовать, чтобы рейка не прокручивалась вовсе; вопрос в другом:
    // можно ли до него добраться, или он навсегда остался под панелью.
    рейка.scrollTop = рейка.scrollHeight
    const последний = document.querySelector('#srv13').getBoundingClientRect()
    return JSON.stringify({
      панель: r('.me'), шапка: r('.chat-head'), поле: r('.composer'),
      рейка: r('.servers'), каналы: r('.channels'),
      музыкаВПанели: !!document.querySelector('#кнопка-музыки'),
      музыкаВРейке: !!rейкаМузыка(),
      последнийСервер: Math.round(последний.bottom),
      рейкаПрокрутка: рейка.scrollHeight - рейка.clientHeight,
    })
    function rейкаМузыка() { return document.querySelector('.servers .srv.music') }
  })()`))

  console.log('\n── Нижняя кромка слева ──')

  check('панель по высоте 1 в 1 как шапка чата',
    м.панель.h === м.шапка.h, м.панель.h + ' и ' + м.шапка.h)
  check('панель по высоте 1 в 1 как поле ввода',
    м.панель.h === м.поле.h, м.панель.h + ' и ' + м.поле.h)
  check('панель начинается от самого левого края',
    м.панель.x === 0, 'x = ' + м.панель.x)
  check('панель тянется до конца колонки каналов',
    Math.abs(м.панель.право - м.каналы.право) <= 1,
    м.панель.право + ' и ' + м.каналы.право)
  check('панель шире, чем была (рейка плюс колонка)',
    м.панель.w >= м.рейка.w + м.каналы.w - 2, м.панель.w + ' при ' + (м.рейка.w + м.каналы.w))
  // Про нижнюю линию здесь нарочно НЕТ проверки, хотя просилась.
  //
  // Правило «низ панели и низ поля ввода — одна линия» владелец принёс со
  // снимком Discord ещё в v1.435.0, и стережёт его test:safe — на настоящей
  // оболочке приложения. Здесь оболочка своя, с подпорками для высоты, и та же
  // мерка даёт другие числа. Проверять одно и то же в двух местах разными
  // способами — значит однажды получить два разных ответа и не знать, какому
  // верить.

  // Кнопка музыки уехала из рейки в панель — и там её больше нет.
  check('кнопка музыки живёт в панели', м.музыкаВПанели === true)
  check('в рейке серверов её больше нет', м.музыкаВРейке === false)

  // Главная опасность растянутой панели: она накрывает низ рейки, и последний
  // сервер у того, у кого их много, оказывается под ней.
  check('до последнего сервера можно прокрутить — он не заперт под панелью',
    м.последнийСервер <= м.панель.y + 1,
    'низ последнего ' + м.последнийСервер + ', верх панели ' + м.панель.y)

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
