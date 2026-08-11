// v1.501.0: наведение НИЧЕГО НЕ ДВИГАЕТ, но остаётся заметным.
// Запуск: npm run test:hover
//
// Две жалобы владельца подряд. Сперва: «сделай чтобы иконка при наведение не
// подскакивала» — аватарка вырастала с сорока до сорока трёх пикселей и
// уезжала вверх-влево. Я заменил рост подсветкой кольцом, и стало хуже: у
// элемента выше своей ширины круглое скругление даёт длинный овал. Вторая
// жалоба со снимком: «убери полностью все эти обводки и эффекты при
// наведении».
//
// Отсюда правило, которое стенд и стережёт:
//   у аватарки на наведение не меняется НИЧЕГО;
//   у остальных кнопок не меняется ГЕОМЕТРИЯ, но меняется ЦВЕТ.
//
// Второе не менее важно первого. Движение убиралось разом из шестидесяти пяти
// объявлений, и у сорока одного селектора оно было единственным откликом —
// без возвращённого цвета кнопки стали бы мёртвыми под курсором, а просили не
// этого. Проверка «ничего не шевелится» одна такую беду не увидит: она пройдёт
// и на стилях, где наведения нет вовсе.
//
// ПОЧЕМУ НЕ НАСТОЯЩЕЙ МЫШЬЮ. Сначала я подводил указатель через sendInputEvent
// — и проверка падала через раз с «мышь не доехала»: Chromium пересчитывает
// наведение по последнему перемещению и после смены размера окна первые
// движения иногда съедает. Это беда стенда, а не стилей. Поэтому :hover
// включается напрямую, через отладчик браузера (CSS.forcePseudoState).
//
// ПОЧЕМУ ЦВЕТ МЕРЯЕТСЯ ПИКСЕЛЯМИ. Сравнивать computed style бесполезно:
// правило может поменять свойство, которого не видно (например, яркость белого
// прямоугольника). Стенд снимает картинку до и после и считает среднюю
// яркость участка — это ровно то, что увидит человек.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-hover-test')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))

// Образцы списаны с настоящей разметки. Первый — особый: у него отклика быть
// НЕ ДОЛЖНО. Остальные обязаны меняться в цвете и стоять на месте.
const ОБРАЗЦЫ = [
  { имя: 'аватарка в сообщении', молча: true,
    html: '<span class="av-click" id="%">' +
      '<span class="av" style="width:40px;height:40px;border-radius:50%;background:#5865f2;display:block"></span></span>' },
  { имя: 'кнопка в шапке плеера',
    html: '<div class="mus-head-r"><button id="%">II</button></div>' },
  { имя: 'карточка языка',
    html: '<div class="pqs-lang" id="%"><span class="pqs-lang-flag">RU</span><span class="pqs-lang-name">Русский</span></div>' },
  { имя: 'тема тёмная', html: '<div class="pqs-theme dark" id="%">Тёмная</div>' },
  { имя: 'тема светлая', html: '<div class="pqs-theme light" id="%">Светлая</div>' },
  { имя: 'набор настроек', html: '<div class="pqs-preset" id="%">Набор</div>' },
  { имя: 'кружок цвета', html: '<button class="pqs-accent-sw" id="%" style="background:#5865f2"></button>' },
  { имя: 'образец наклейки', html: '<div class="sset-sw" id="%" style="background:#3ba55d"></div>' },
  { имя: 'плитка раздела', html: '<div class="cat-tile" id="%" style="width:160px;height:90px"></div>' },
  { имя: 'ячейка гифки', html: '<div class="gif-cell" id="%" style="width:160px"></div>' },
  { имя: 'опасная кнопка', html: '<button class="pqs-danger" id="%">Удалить</button>' },
]

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css">
<style>html,body{margin:0;background:#313338;font-family:system-ui,sans-serif;color:#dbdee1}
.probes{display:flex;flex-wrap:wrap;gap:24px;padding:24px;align-items:flex-start}</style>
<div class="probes">${ОБРАЗЦЫ.map((о, n) => о.html.replace('%', 't' + n)).join('\n')}</div>`)

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

/** Средняя яркость участка картинки. getBitmap отдаёт BGRA подряд. */
function яркость(картинка, r) {
  const { width, height } = картинка.getSize()
  const b = картинка.getBitmap()
  let сумма = 0, сколько = 0
  for (let y = Math.max(0, Math.round(r.y)); y < Math.min(height, Math.round(r.y + r.h)); y++) {
    for (let x = Math.max(0, Math.round(r.x)); x < Math.min(width, Math.round(r.x + r.w)); x++) {
      const i = (y * width + x) * 4
      сумма += (b[i] + b[i + 1] + b[i + 2]) / 3
      сколько++
    }
  }
  // Ноль пикселей — это не «цвет не изменился», это промах мимо картинки:
  // образец уехал за край окна или мерку читают не теми ключами. Я на этом
  // попался: яркость брала r.width, а в мерках лежит r.w, и стенд честно
  // показывал «цвет 0» на всех образцах разом. Пусть падает громко.
  if (!сколько) throw new Error('участок вне снимка: ' + JSON.stringify(r) + ' при ' + width + 'x' + height)
  return сумма / сколько
}

async function мерки(win) {
  return JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const из = []
    for (let n = 0; n < ${ОБРАЗЦЫ.length}; n++) {
      const r = document.getElementById('t' + n).getBoundingClientRect()
      из.push({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
                w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 })
    }
    return JSON.stringify(из)
  })()`))
}

app.whenReady().then(async () => {
  // ОДНО окно и ОДНА загрузка страницы: закрытое окно уносит сессию, а переход
  // по новому адресу закрывает цель отладчика — следом всё падает с
  // «target closed».
  // ОКНО ВИДИМОЕ, и это не небрежность. Скрытое окно Chromium перерисовывает
  // лениво: capturePage отдаёт кадр, где обновлена лишь часть страницы, а то и
  // прежний целиком. Стенд из-за этого показал «цвет 0» у всех образцов на
  // ширине 412 — будто наведение перестало работать на телефоне, хотя стили
  // были в порядке. Проверял по шагам: у одного образца яркость менялась, у
  // соседнего нет, при одинаковых правилах.
  //
  // Пробовал лечить иначе: backgroundThrottling:false не помог, эмуляция
  // размера через отладчик разъехалась со снимком окна, а Page.captureScreenshot
  // на скрытом окне просто не отвечает — кадров ему взять неоткуда.
  //
  // Поэтому окно показывается на время проверки. Оно живёт секунд десять.
  const win = new BrowserWindow({ show: true, x: 40, y: 40, width: 1200, height: 900,
    backgroundColor: '#313338', webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 400))
  const d = win.webContents.debugger
  d.attach('1.3')
  await d.sendCommand('DOM.enable')
  await d.sendCommand('CSS.enable')
  await d.sendCommand('Page.enable')

  // Снимок берём ТОЖЕ отладчиком. webContents.capturePage снимает окно, а
  // ширину страницы мы меняем эмуляцией — окно при этом остаётся прежним, и
  // снимок оказывается не от той раскладки, что мерки. Page.captureScreenshot
  // снимает ровно то, что видит страница.
  const снимок = async () => {
    const { data } = await d.sendCommand('Page.captureScreenshot', { format: 'png' })
    return nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
  }

  // Номера узлов берём ОДИН раз и держим: DOM.getDocument выдаёт новые номера,
  // и снятие наведения по свежему номеру не снимает поставленное по прежнему.
  const { root } = await d.sendCommand('DOM.getDocument')
  const номера = []
  for (let n = 0; n < ОБРАЗЦЫ.length; n++) {
    const { nodeId } = await d.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#t' + n })
    номера.push(nodeId)
  }
  const навести = async включить => {
    for (const nodeId of номера) {
      await d.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: включить ? ['hover'] : [] })
    }
    // Переходы длятся до трёх десятых — ждём с запасом, иначе мерка поймает
    // середину перехода и «изменение» окажется случайной величиной.
    await new Promise(r => setTimeout(r, 500))
  }

  for (const [имя, ширина] of [['обычный', 1200], ['телефон', 412]]) {
    // Ширину меняем ОТЛАДЧИКОМ, а не win.setContentSize. setContentSize меняет
    // окно и снимок, но страница при скрытом окне не перекладывается: мерки
    // остаются от прежней ширины, снимок уже от новой — и сравнивать выходит
    // разные места. Стенд на этом соврал: на 412 он показал «цвет 0» у всех
    // образцов разом, будто наведение перестало работать на телефоне.
    win.setContentSize(ширина, 900)
    await new Promise(r => setTimeout(r, 300))
    console.log('\n══ ' + имя + ' (' + ширина + ') ══')

    await навести(false)
    const до = await мерки(win)
    const кДо = await win.webContents.capturePage()
    await навести(true)
    const после = await мерки(win)
    const кПосле = await win.webContents.capturePage()

    for (let n = 0; n < ОБРАЗЦЫ.length; n++) {
      const о = ОБРАЗЦЫ[n], a = до[n], b = после[n]
      const сдвиг = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
      const рост = Math.max(Math.abs(a.w - b.w), Math.abs(a.h - b.h))
      const разница = Math.abs(яркость(кПосле, b) - яркость(кДо, a))
      const подпись = о.имя + ': сдвиг ' + Math.round(сдвиг * 10) / 10 +
        ', размер ' + Math.round(рост * 10) / 10 + ', цвет ' + Math.round(разница * 10) / 10
      if (о.молча) {
        check('на аватарке не меняется НИЧЕГО', сдвиг < 0.6 && рост < 0.6 && разница < 1, подпись)
      } else {
        check('не двигается: ' + о.имя, сдвиг < 0.6 && рост < 0.6, подпись)
        check('но заметно: ' + о.имя, разница >= 1.5, подпись)
      }
    }
  }

  // v1.540.0: кнопка без класса не должна остаться системной.
  //
  // В разметке 103 кнопки без единого класса: они рассчитывают на правило
  // родителя, а где такого правила нет — браузер рисует свою: серый
  // прямоугольник с рамкой и чужим шрифтом. Посреди приложения это выглядит как
  // кусок другой программы, и именно это владелец называл словом «убого».
  //
  // Проверяем вычисленным видом, а не наличием строчки в css: правило можно
  // написать и перебить его же другим, а сюда приходит то, что увидит человек.
  win.setContentSize(1000, 700)
  await win.webContents.executeJavaScript(`(() => {
    const д = document.createElement('div')
    д.innerHTML = '<div class="plug-actions"><button id="голая">Открыть</button></div>'
    document.body.appendChild(д)
  })()`)
  await new Promise(r => setTimeout(r, 250))
  const голая = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('голая'), s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return JSON.stringify({ фон: s.backgroundColor, рамка: s.borderTopWidth,
      шрифт: s.fontFamily.slice(0, 20), высота: Math.round(r.height), радиус: s.borderTopLeftRadius })
  })()`))
  // Системная кнопка Windows: СПЛОШНОЙ светлый фон, рамка в пиксель, свой шрифт.
  //
  // Прозрачность считать обязательно. Первая проба ловила «rgb 255,255,255» и
  // называла системной нашу же подсветку rgba(255,255,255,.1): по цифрам белая,
  // на экране — еле заметный налёт поверх тёмной панели.
  const светлый = (() => {
    const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(голая.фон)
    if (!m) return false
    const альфа = m[4] === undefined ? 1 : Number(m[4])
    return альфа > .8 && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 120
  })()
  check('кнопка без класса не выглядит системной', !светлый && голая.рамка === '0px',
    JSON.stringify(голая))
  check('кнопка без класса ростом с остальные', голая.высота >= 28 && голая.высота <= 48,
    голая.высота + 'px')
  check('кнопка без класса скруглена как всё остальное', голая.радиус !== '0px', голая.радиус)

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
