// По каждой кнопке можно попасть. Запуск: npm run test:reach
//
// Владелец: «проверка всего приложения на ошибки, некрасивости, кривое, что
// пользователь нажать не может».
//
// Последнее — самое опасное и самое незаметное. Кнопка может быть на экране,
// быть нужного размера и всё равно не нажиматься: её накрыл соседний слой,
// её вынесло за край, у неё нулевая прозрачность или ноль пикселей размера.
// Глазами это не ловится вовсе — накрывший слой обычно прозрачный.
//
// Здесь по КАЖДОМУ экрану и КАЖДОЙ нажимаемой вещи проверяется четыре вещи:
//   1. она видна (размер, прозрачность, display);
//   2. она внутри экрана;
//   3. в её середине лежит она сама, а не чужой слой;
//   4. на телефоне она не мельче пальца.
//
// Третье — главное. Именно так выглядит «нажимаю, а ничего не происходит».
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { экраны } = require('./screens.cjs')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
if (!fs.existsSync(DIST)) {
  console.error('нет собранного приложения — сперва npm run build')
  process.exit(1)
}

const ПАЛЕЦ = 44

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

const ОБХОД = `(ТЕЛЕФОН => {
  const имя = el => el.tagName.toLowerCase()
    + (typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
    + (el.textContent && el.textContent.trim()
      ? ' «' + el.textContent.trim().slice(0, 14) + '»' : '')

  const цели = [...document.querySelectorAll('button, a[href], [role="button"], input, select, textarea, summary')]
  const невидимые = [], заКраем = [], перекрытые = [], мелкие = []

  for (const el of цели) {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()

    // Нарочно спрятанное не считается поломкой: это не «нельзя нажать», это
    // «сейчас не показывают». Отличаем по display/visibility и нулевому размеру.
    if (s.display === 'none' || s.visibility === 'hidden') continue
    if (r.width < 1 || r.height < 1) { невидимые.push(имя(el) + ' 0 пикселей'); continue }
    // Прозрачное и не ловящее нажатия — это «сейчас не показывают», а не
    // «нельзя нажать»: кнопка отправки прозрачна, пока не набран текст, а
    // ряд над сообщением появляется по наведению. Жаловаться на них —
    // значит хоронить проверку под ложными тревогами.
    if (Number(s.opacity) === 0 || s.pointerEvents === 'none') continue

    // Полностью за краем — тоже нажать нельзя. Частично торчащее пропускаем:
    // это может быть прокручиваемая лента.
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) {
      // Уехало за край ВМЕСТЕ С ПАНЕЛЬЮ — это закрытая шторка, а не потерянная
      // кнопка: её вернёт то же движение, каким её убрали. Отличаем по
      // сдвигу у предка: припаркованная панель стоит с transform.
      let припаркована = false
      for (let p = el.parentElement; p; p = p.parentElement) {
        const t = getComputedStyle(p).transform
        if (t && t !== 'none') { припаркована = true; break }
      }
      if (!припаркована) заКраем.push(имя(el) + ' при экране ' + innerWidth + 'x' + innerHeight)
      continue
    }

    // Кто лежит в середине цели. Если это не она и не её потомок — сверху
    // что-то есть, и нажатие уйдёт туда.
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
    const сверху = document.elementFromPoint(x, y)
    if (сверху && сверху !== el && !el.contains(сверху) && !сверху.contains(el)) {
      перекрытые.push(имя(el) + ' накрыта ' + имя(сверху))
    }

    // У поля ввода цель — вся его ширина, и по строке в триста пикселей
    // промахнуться нельзя. Меряем по площади: она честнее для широких целей.
    const узкое = el.matches('input, textarea, select') ? r.width * r.height < 44 * 44 : false
    // Настоящая цель бывает шире вида: прозрачное поле вокруг ловит палец,
    // не двигая соседей. Меряем не рамку, а то, куда правда попадаешь:
    // щупаем точки по бокам и сверху-снизу.
    const попадает = (dx, dy) => {
      const t = document.elementFromPoint(
        Math.min(Math.max(r.left + r.width / 2 + dx, 1), innerWidth - 1),
        Math.min(Math.max(r.top + r.height / 2 + dy, 1), innerHeight - 1))
      return !!t && (t === el || el.contains(t) || t.contains(el))
    }
    const шире = (() => {
      let л = r.width / 2, п = r.width / 2
      while (л < 24 && попадает(-(л + 2), 0)) л += 2
      while (п < 24 && попадает(п + 2, 0)) п += 2
      return л + п
    })()
    const выше = (() => {
      let в = r.height / 2, н = r.height / 2
      while (в < 24 && попадает(0, -(в + 2))) в += 2
      while (н < 24 && попадает(0, н + 2)) н += 2
      return в + н
    })()
    if (ТЕЛЕФОН && (узкое || (!el.matches('input, textarea, select')
      && (шире < ${ПАЛЕЦ} - 0.5 || выше < ${ПАЛЕЦ} - 0.5)))) {
      мелкие.push(имя(el) + ' цель ' + Math.round(шире) + 'x' + Math.round(выше))
    }
  }
  return JSON.stringify({ всего: цели.length, невидимые, заКраем, перекрытые, мелкие })
})`

app.commandLine.appendSwitch('touch-events', 'enabled')
app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 300000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1000, height: 900,
    backgroundColor: '#1e1f22', webPreferences: { backgroundThrottling: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))

  for (const экран of экраны()) {
    // Витрина кнопок — не экран приложения, а очная ставка: в ней кнопки
    // нарочно вынуты из своих мест и составлены в один столбец. Жаловаться
    // на то, что там что-то вылезло, — значит жаловаться на саму витрину.
    // Размеры целей на ней всё равно меряются: их проверяет обход телефона
    // (npm run test:mobile) по той же разметке.
    if (/витрина/.test(экран.имя)) continue
    const телефон = экран.ш <= 500
    win.setContentSize(экран.ш, Math.min(экран.в, 900))
    await new Promise(r => setTimeout(r, 220))
    await win.webContents.executeJavaScript(`(() => {
      document.body.className = 'no-anim'
      document.body.innerHTML = ${JSON.stringify(экран.html)}
      const s = document.createElement('style')
      s.textContent = 'html,body{height:100%;margin:0} .app-viewport,.app{height:100%}'
        + ' .channels,.servers,.chat,.dm-side{height:100%} .ch-list,.msgs{flex:1}'
        + ' .av-wrap{width:32px;height:32px;border-radius:50%;background:#5865f2;display:inline-block}'
      document.head.appendChild(s)
    })()`)
    await new Promise(r => setTimeout(r, 320))

    const м = JSON.parse(await win.webContents.executeJavaScript(
      ОБХОД + '(' + (телефон ? 'true' : 'false') + ')'))

    console.log('\n── ' + экран.имя + ' (' + экран.ш + '), нажимаемых: ' + м.всего + ' ──')
    check('ничего не спрятано нулём или прозрачностью', м.невидимые.length === 0,
      м.невидимые.slice(0, 5).join(' | '))
    check('ничего не вынесено за край экрана', м.заКраем.length === 0,
      м.заКраем.slice(0, 5).join(' | '))
    check('ничто не накрыто чужим слоем', м.перекрытые.length === 0,
      м.перекрытые.slice(0, 5).join(' | '))
    if (телефон) {
      check('всё не мельче пальца', м.мелкие.length === 0, м.мелкие.slice(0, 6).join(' | '))
    }
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
