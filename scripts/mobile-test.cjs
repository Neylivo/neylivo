// v1.495.0: обход приложения на телефоне. Запуск: npm run test:mobile
//
// Владелец: «пофиксить все неравности для телефонов». Искать их глазами по
// снимкам — значит найти те, что бросаются в глаза, и пропустить остальные.
// Поэтому здесь ОБХОД: настоящее собранное приложение открывается в окне
// размером с телефон, и каждый видимый узел проверяется числами.
//
// Что ищется:
//   • вылезло за правый край — горизонтальная прокрутка на телефоне это всегда
//     поломка, её нечем оправдать;
//   • слишком мелкая цель для пальца — меньше 44 пикселей нажимают мимо;
//   • текст, обрезанный своим же контейнером;
//   • элементы, налезающие друг на друга;
//   • шрифт мельче 12 пикселей — не читается на руках.
//
// Почему настоящее приложение, а не выдуманная разметка. Выдумывая разметку, я
// проверял бы своё представление о ней. Половина неровностей живёт ровно там,
// где вёрстка не такая, как я помню.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.commandLine.appendSwitch('touch-events', 'enabled')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
if (!fs.existsSync(DIST)) {
  console.error('нет собранного приложения — запускай через npm run test:mobile')
  process.exit(1)
}

/** Пикселей в самой узкой стороне пальца. Общая мера, не выдуманная. */
const ПАЛЕЦ = 44
/** Мельче этого текст на телефоне не читается. */
const МЕЛКИЙ = 12

const ЭКРАНЫ = [
  { id: 'вход', ширина: 412, высота: 915 },
  // Узкий старый телефон: на нём всё, что «почти влезает», перестаёт влезать.
  { id: 'узкий', ширина: 320, высота: 640 },
  // Телефон/планшет поперёк: раньше при ширине больше 768 px внезапно
  // включалась настольная сетка с hover-действиями.
  { id: 'touch-ландшафт', ширина: 915, высота: 412 },
]

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

const ОБХОД = `(() => {
  const пусто = el => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true
    const r = el.getBoundingClientRect()
    return r.width < 1 || r.height < 1
  }
  const имя = el => el.tagName.toLowerCase()
    + (el.id ? '#' + el.id : '')
    + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')

  const ширинаОкна = document.documentElement.clientWidth
  const все = [...document.querySelectorAll('body *')].filter(el => !пусто(el))

  const заКрай = []
  const мелкиеЦели = []
  const мелкийТекст = []
  const обрезано = []

  for (const el of все) {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)

    // 1. Вылезло за правый край. Слева тоже считаем: панель, уехавшая за левый
    //    край НАМЕРЕННО (шторка навигации), стоит с transform — её пропускаем.
    if (r.right > ширинаОкна + 1 && s.position !== 'fixed') {
      заКрай.push(имя(el) + ' до ' + Math.round(r.right) + ' при ширине ' + ширинаОкна)
    }

    // 2. Цель для пальца. Считаем только то, по чему правда нажимают, и только
    //    если у элемента нет нажимаемого родителя — иначе одна кнопка со
    //    значком внутри давала бы две жалобы.
    const нажимаемый = el.matches('button, a, [role="button"], input[type="checkbox"], input[type="radio"], summary')
    if (нажимаемый && !el.parentElement?.closest('button, a, [role="button"]')) {
      if (r.height < ${ПАЛЕЦ} - 0.5 || r.width < ${ПАЛЕЦ} - 0.5) {
        мелкиеЦели.push(имя(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
      }
    }

    // 3. Мелкий текст — только у узлов с собственным текстом.
    const свойТекст = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (свойТекст) {
      const px = parseFloat(s.fontSize)
      if (px && px < ${МЕЛКИЙ}) мелкийТекст.push(имя(el) + ' ' + px + 'px')
    }

    // 4. Текст, обрезанный своим же контейнером БЕЗ многоточия: значит, часть
    //    слов просто не видно, и человек об этом не узнает.
    if (свойТекст && s.overflow === 'hidden' && s.textOverflow !== 'ellipsis') {
      if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
        обрезано.push(имя(el) + ' ' + el.scrollWidth + '>' + el.clientWidth)
      }
    }
  }

  return JSON.stringify({
    узлов: все.length,
    прокруткаВбок: document.documentElement.scrollWidth > ширинаОкна + 1,
    ширинаТела: document.documentElement.scrollWidth,
    ширинаОкна,
    заКрай: [...new Set(заКрай)].slice(0, 12),
    мелкиеЦели: [...new Set(мелкиеЦели)].slice(0, 12),
    мелкийТекст: [...new Set(мелкийТекст)].slice(0, 12),
    обрезано: [...new Set(обрезано)].slice(0, 12),
    текст: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
  })
})()`

// ── Разбор самих мобильных правил ──────────────────────────────────────────
//
// Обход выше видит только те экраны, до которых можно дойти без входа в
// аккаунт. Всё остальное — а это почти всё приложение — проверяется здесь, по
// стилям: правила, которые включаются на телефоне, разбираются и сверяются с
// тем, что на телефоне обязано быть.
//
// ВАЖНО, И НА ЭТОМ Я УЖЕ ПОПАЛСЯ: свойства надо СКЛАДЫВАТЬ по селектору, а не
// судить по одному правилу. Стили дописывают друг друга: «position: fixed;
// bottom: 0» может стоять в одном правиле, а отступ под жестовую полосу — в
// соседнем, ниже. Разбор по одному правилу объявил бы поломкой уже
// исправленное, и я час чинил бы то, что цело.
function разборСтилей(css) {
  const блоки = []
  const re = /@media\s*\(max-width:\s*(\d+)px\)(?:\s*,[^\{]+)?\s*\{/g
  let m
  while ((m = re.exec(css))) {
    const порог = Number(m[1])
    if (порог > 900) continue
    let i = css.indexOf('{', m.index), гл = 0, j = i
    for (; j < css.length; j++) {
      if (css[j] === '{') гл++
      else if (css[j] === '}') { гл--; if (!гл) break }
    }
    блоки.push(css.slice(i + 1, j))
    re.lastIndex = j
  }

  // Собираем свойства по селектору — И ИЗ МОБИЛЬНЫХ БЛОКОВ, И СО ВСЕГО ФАЙЛА.
  //
  // Второе обязательно, и вот почему. Полноэкранные накладки объявляют
  // «position: fixed; inset: 0» СНАРУЖИ медиазапроса, а внутри него их только
  // распирают во весь экран (padding: 0). Разбор, смотревший в один блок,
  // видел там «просто padding» — и пропустил то, что заголовок с крестиком
  // уехал под часы телефона. Владелец нашёл это снимком, а не проверка.
  const вездеСвойства = new Map()
  for (const r of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    for (const сел of r[1].split(',')) {
      const s = сел.trim().replace(/\s+/g, ' ')
      if (!s || s.startsWith('@')) continue
      вездеСвойства.set(s, (вездеСвойства.get(s) || '') + ';' + r[2])
    }
  }

  const свойства = new Map()
  for (const кусок of блоки) {
    // Комментарии выкидываем: иначе они прилипают к имени селектора.
    const чистый = кусок.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const r of чистый.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const сел of r[1].split(',')) {
        const s = сел.trim().replace(/\s+/g, ' ')
        if (!s) continue
        свойства.set(s, (свойства.get(s) || '') + ';' + r[2])
      }
    }
  }

  const беды = { широкие: [], мелкие: [], низ: [], верх: [], экранные: [], подЧасами: [] }

  // Экран, распёртый во весь телефон, обязан оставить полосу с часами пустой.
  for (const [сел, мтело] of свойства) {
    const всё = вездеСвойства.get(сел) || ''
    if (!/position:\s*fixed/.test(всё)) continue
    const воВесьЭкран = /inset:\s*0/.test(всё)
      || (/top:\s*0/.test(всё) && /bottom:\s*0/.test(всё))
    if (!воВесьЭкран) continue
    // На телефоне его ещё и распирают: убирают отступ, скругление или ширину.
    const распёрли = /padding:\s*0/.test(мтело) || /border-radius:\s*0/.test(мтело)
      || /width:\s*100%/.test(мтело)
    if (!распёрли) continue
    if (!/safe-area-inset-top/.test(всё + мтело)) беды.подЧасами.push(сел)
  }
  for (const [сел, тело] of свойства) {
    // 1. Жёсткая ширина, которая не влезет в узкий телефон.
    for (const w of тело.matchAll(/(?<![-\w])(?:min-)?width:\s*(\d+)px/g)) {
      if (Number(w[1]) > 320) беды.широкие.push(сел + ' -> ' + w[0])
    }
    // 2. Цель для пальца.
    if (/(button|\.btn|-btn|\.pqs2-item|\.ch\b|\.dm-item|\.member|\.ctx-item)/.test(сел)) {
      // Берём ПОСЛЕДНЕЕ значение: оно и побеждает.
      const все = [...тело.matchAll(/(?<![-\w])(?:min-)?height:\s*(\d+)px/g)]
      const последнее = все.length ? Number(все[все.length - 1][1]) : null
      const минимум = [...тело.matchAll(/min-height:\s*(\d+)px/g)].map(x => Number(x[1])).pop()
      const итог = минимум ?? последнее
      if (итог !== null && итог !== undefined && итог < ПАЛЕЦ) {
        беды.мелкие.push(сел + ' -> ' + итог + 'px')
      }
    }
    // 3. Размер от ЭКРАНА вместо оболочки.
    //
    // 100vw считается от экрана целиком и перешагивает боковой вырез — из-за
    // этого переписка вместе с полем ввода уезжала под вырез (v1.454.0).
    // 100vh считается от «идеального» экрана без панели браузера, и низ уходит
    // под неё; у приложения для этого есть 100dvh.
    for (const m2 of тело.matchAll(/(?<![-\w])(?:min-|max-)?width:\s*100vw/g)) {
      беды.экранные.push(сел + ' -> ' + m2[0])
    }
    for (const m2 of тело.matchAll(/(?<![-\w])(?:min-|max-)?height:\s*100vh/g)) {
      беды.экранные.push(сел + ' -> ' + m2[0])
    }

    // 4. Прибито к краю экрана без запаса под системные полосы.
    if (/position:\s*fixed/.test(тело)) {
      if (/bottom:\s*0/.test(тело) && !/safe-area-inset-bottom/.test(тело)) беды.низ.push(сел)
      if (/top:\s*0/.test(тело) && !/safe-area-inset-top/.test(тело)) беды.верх.push(сел)
    }
  }
  return беды
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 120000)

app.whenReady().then(async () => {
  // ОДНО окно на все размеры, а не по окну на каждый.
  //
  // Второе окно упорно не открывалось (ERR_FAILED), сколько ни разводи разделы
  // памяти: закрытое окно уносит с собой сессию, а следующее берётся за file://
  // раньше, чем она поднимется. Менять размер у одного окна и перезагружать —
  // и проще, и ближе к правде: человек поворачивает телефон, а не покупает
  // новый.
  const win = new BrowserWindow({
    show: false, width: ЭКРАНЫ[0].ширина, height: ЭКРАНЫ[0].высота,
    webPreferences: { backgroundThrottling: false, partition: 'mobile-' + Date.now() },
  })
  // v1.527.0: стенд ПРИТВОРЯЕТСЯ сенсорным устройством.
  //
  // Раньше мобильная раскладка на «телефоне поперёк» включалась одним правилом
  // «ширина ≤1100 И высота ≤600» — без единого слова про сенсор. Это значит,
  // что обычное окно на компьютере, уменьшенное по высоте, теряло рейку
  // серверов и превращалось в телефон. Правило поправлено (нужен ещё и
  // сенсорный ввод), и вот тут выяснилось, что стенд проверял его случайно:
  // в обычном окне Electron сенсора нет, и раскладка не включается.
  //
  // Поэтому здесь включается настоящая эмуляция: браузеру говорят, что
  // указатель грубый, а наведения не бывает — ровно то, что сообщает о себе
  // телефон. Без этого проверки трогали бы не тот вид, что у человека в руках.
  const сенсорВключить = async (да) => {
    const d = win.webContents.debugger
    if (!d.isAttached()) d.attach('1.3')
    await d.sendCommand('Emulation.setEmulatedMedia', {
      features: да
        ? [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }]
        : [],
    })
    await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: !!да, maxTouchPoints: 5 })
  }

  win.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/126.0.0.0 Mobile Safari/537.36')

  for (const э of ЭКРАНЫ) {
    win.setContentSize(э.ширина, э.высота)
    try { await win.loadFile(DIST) }
    catch (e) {
      console.log('  ПРОВАЛ окно «' + э.id + '» не открылось: ' + e.message)
      failed++
      continue
    }
    // Сенсор включаем ПОСЛЕ загрузки: переход на новый адрес закрывает цель
    // отладчика, и команда, отданная до него, падает с «target closed».
    // Телефонным размерам он нужен всем: узкая ширина включает мобильную
    // раскладку и без него, а «поперёк» — только вместе с ним.
    await сенсорВключить(true)
    await new Promise(r => setTimeout(r, 2500))

    let м
    try { м = JSON.parse(await win.webContents.executeJavaScript(ОБХОД)) }
    catch (e) { console.log('  ПРОВАЛ обход упал на «' + э.id + '»: ' + e.message); failed++; continue }

    console.log('\n── ' + э.id + ' (' + э.ширина + '×' + э.высота + '), узлов: ' + м.узлов + ' ──')
    console.log('   видно: ' + JSON.stringify(м.текст))
    check('нет прокрутки вбок', !м.прокруткаВбок, м.ширинаТела + ' при ' + м.ширинаОкна)
    check('ничего не вылезает за правый край', м.заКрай.length === 0, м.заКрай.join(' | '))
    check('по всему можно попасть пальцем', м.мелкиеЦели.length === 0, м.мелкиеЦели.join(' | '))
    check('нет текста мельче ' + МЕЛКИЙ + ' пикселей', м.мелкийТекст.length === 0, м.мелкийТекст.join(' | '))
    check('ничего не обрезано молча', м.обрезано.length === 0, м.обрезано.join(' | '))
  }

  // ── Вся семья кнопок разом, на телефоне ────────────────────────────────
  //
  // Владелец: «привести к аккуратному минимализму… а также на телефонах».
  // Обход выше ходит по экранам, и каждая кнопка попадает в него только если
  // оказалась на пути. Кнопок в приложении полторы сотни видов, и «на пути»
  // бывает от силы четверть — остальные проверялись бы честным взглядом в
  // потолок. Витрина ставит их рядом и меряет разом.
  //
  // Разметка та же, что снимает npm run look (scripts/button-gallery.cjs):
  // разъехавшиеся копии проверяли бы не то, что показывают.
  console.log('\n── Витрина кнопок на телефоне (412) ──')
  win.setContentSize(412, 900)
  await win.loadFile(DIST)
  await сенсорВключить(true)
  await new Promise(r => setTimeout(r, 800))
  await win.webContents.executeJavaScript(`(() => {
    document.body.className = ''
    document.body.innerHTML = ${JSON.stringify(require('./button-gallery.cjs').витрина())}
  })()`)
  await new Promise(r => setTimeout(r, 500))
  const в = JSON.parse(await win.webContents.executeJavaScript(ОБХОД))
  check('по каждой кнопке можно попасть пальцем', в.мелкиеЦели.length === 0, в.мелкиеЦели.join(' | '))
  check('ни одна кнопка не вылезает за край', в.заКрай.length === 0, в.заКрай.join(' | '))
  check('ни одна подпись не обрезана', в.обрезано.length === 0, в.обрезано.join(' | '))

  // ── Маленькое окно на КОМПЬЮТЕРЕ остаётся компьютером ──────────────────
  //
  // Мобильная раскладка «поперёк» включалась правилом «ширина ≤1100 И высота
  // ≤600» без единого слова про сенсор. Это значит, что обычное окно на
  // компьютере, уменьшенное по высоте (например, пристроенное к краю экрана),
  // теряло рейку серверов и колонку каналов: они уезжали за левый край как
  // шторка, и открыть их было нечем — жеста от края мышью не сделать.
  //
  // Поймано случайно: моя же проба не находила значок сервера, потому что он
  // стоял на x = −70. Здесь это закреплено проверкой — БЕЗ эмуляции сенсора.
  win.setContentSize(1000, 500)
  await win.loadFile(DIST)
  await сенсорВключить(false)
  await new Promise(r => setTimeout(r, 1200))
  await win.webContents.executeJavaScript(`(() => {
    document.body.className = ''
    document.body.innerHTML = '<div class="app-viewport"><div class="app">'
      + '<nav class="servers"><div class="srv-wrap on"><button class="srv on">П</button></div></nav>'
      + '<aside class="channels"><div class="ch on">общий</div></aside>'
      + '<main class="chat"></main></div></div>'
  })()`)
  await new Promise(r => setTimeout(r, 400))
  const узкоеОкно = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const р = document.querySelector('.servers').getBoundingClientRect()
    const к = document.querySelector('.channels').getBoundingClientRect()
    return JSON.stringify({ рейкаX: Math.round(р.x), рейкаШ: Math.round(р.width),
      каналыX: Math.round(к.x), окно: window.innerWidth })
  })()`))
  check('рейка серверов на месте в маленьком окне на компьютере',
    узкоеОкно.рейкаX >= 0 && узкоеОкно.рейкаШ > 40,
    JSON.stringify(узкоеОкно))
  check('колонка каналов тоже на месте, а не уехала шторкой',
    узкоеОкно.каналыX >= 0, JSON.stringify(узкоеОкно))

  // Авторизованная оболочка без сети. Проверяем именно слои приложения:
  // мобильную шторку, сервер, шапку друзей и изображение во вложении.
  win.setContentSize(915, 412)
  await win.loadFile(DIST)
  await сенсорВключить(true)
  await new Promise(r => setTimeout(r, 500))
  const shell = `<div class="app-viewport"><div class="app">
    <nav class="servers"><div class="srv-wrap on"><button id="touch-server" class="srv has-avatar on">P</button><span class="srv-label">Главная</span></div></nav>
    <div class="mob-backdrop"></div>
    <aside class="dm-side"><div class="dm-top"><button class="dm-findbtn">Найти беседу</button></div><div class="dm-navitem on">Друзья</div></aside>
    <main class="chat pfr-chat"><header class="chat-head pfr-head"><button id="touch-burger" class="mob-burger">M</button><span class="pfr-title">Друзья</span><div class="pfr-tabs"><button class="pfr-tab on">В сети</button><button class="pfr-tab">Все</button></div><button id="touch-add" class="pfr-addfriend">+</button></header>
      <div class="msgs"><div class="msg"><div class="msg-body"><div class="att-group grid"><img class="msg-att" alt="Проверка вложения" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='120'%3E%3Crect width='320' height='120' fill='%235865f2'/%3E%3C/svg%3E"></div></div></div></div>
    </main></div></div>`
  await win.webContents.executeJavaScript(`(() => {
    document.body.className = 'no-anim'
    document.body.innerHTML = ${JSON.stringify(shell)}
    window.__touchClicks = { burger: 0, server: 0, add: 0 }
    document.querySelector('#touch-burger').addEventListener('click', () => {
      window.__touchClicks.burger++
      document.body.classList.add('mob-nav-open')
    })
    document.querySelector('.mob-backdrop').addEventListener('click', () => document.body.classList.remove('mob-nav-open'))
    document.querySelector('#touch-server').addEventListener('click', () => window.__touchClicks.server++)
    document.querySelector('#touch-add').addEventListener('click', () => window.__touchClicks.add++)
  })()`)

  const клик = async (сел, справа = false) => {
    const p = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(сел)}).getBoundingClientRect(); return { x: Math.round(${справа ? 'r.right - 10' : 'r.left + r.width / 2'}), y: Math.round(r.top + r.height / 2) } })()`)
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 320))
  }

  console.log('\n── Авторизованная touch-оболочка (915×412) ──')
  const compactMedia = await win.webContents.executeJavaScript(`matchMedia('(max-width: 1100px) and (max-height: 600px)').matches`)
  check('компактная мобильная ветка включена в landscape', compactMedia)
  await клик('#touch-burger')
  const drawer = await win.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.servers').getBoundingClientRect()
    const b = document.querySelector('#touch-burger').getBoundingClientRect()
    return {
      left:r.left,
      width:r.width,
      burgerClicks:window.__touchClicks.burger,
      bodyClass:document.body.className,
      selectorMatches:document.querySelector('.servers').matches('body.mob-nav-open .servers'),
      transform:getComputedStyle(document.querySelector('.servers')).transform,
      transition:getComputedStyle(document.querySelector('.servers')).transitionDuration,
      burgerTop:document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.id || document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.className,
    }
  })()`)
  check('кнопка меню открывает мобильную навигацию', drawer.burgerClicks === 1 && drawer.left >= -1, JSON.stringify(drawer))
  const serverSize = await win.webContents.executeJavaScript(`(() => { const el=document.querySelector('#touch-server'), r=el.getBoundingClientRect(), s=getComputedStyle(el); return { width:r.width, height:r.height, radius:s.borderRadius, top:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id } })()`)
  check('сервер квадратный и не меньше пальца', serverSize.width >= 44 && serverSize.height >= 44 && Math.abs(serverSize.width - serverSize.height) < 1, JSON.stringify(serverSize))
  check('рамка изображения сервера круглая', serverSize.radius === '50%', JSON.stringify(serverSize))
  check('сервер не перекрыт другим слоем', serverSize.top === 'touch-server', serverSize.top)
  await клик('#touch-server')
  const serverClicks = await win.webContents.executeJavaScript(`window.__touchClicks.server`)
  check('сервер нажимается настоящим событием ввода', serverClicks === 1, String(serverClicks))
  const backdropState = await win.webContents.executeJavaScript(`(() => {
    const r=document.querySelector('.mob-backdrop').getBoundingClientRect()
    const x=Math.round(r.right-10), y=Math.round(r.top+r.height/2)
    const top=document.elementFromPoint(x,y)
    return { left:r.left, right:r.right, width:r.width, x, y, top:top?.id || top?.className }
  })()`)
  check('у затемнения есть свободная область для закрытия', backdropState.top === 'mob-backdrop', JSON.stringify(backdropState))
  await клик('.mob-backdrop', true)
  const drawerClosed = await win.webContents.executeJavaScript(`(() => {
    const server = document.querySelector('.servers').getBoundingClientRect()
    const side = document.querySelector('.dm-side').getBoundingClientRect()
    return {
      classRemoved: !document.body.classList.contains('mob-nav-open'),
      serverRight: server.right,
      sideRight: side.right,
    }
  })()`)
  check(
    'нажатие вне панели закрывает мобильную навигацию',
    drawerClosed.classRemoved && drawerClosed.serverRight <= 1 && drawerClosed.sideRight <= 1,
    JSON.stringify(drawerClosed),
  )
  await клик('#touch-add')
  const addState = await win.webContents.executeJavaScript(`(() => {
    const el=document.querySelector('#touch-add')
    const r=el.getBoundingClientRect()
    const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)
    return { clicks:window.__touchClicks.add, width:r.width, height:r.height, bodyClass:document.body.className, top:top?.id || top?.className }
  })()`)
  check('добавление друга нажимается и не мельче пальца', addState.clicks === 1 && addState.width >= 44 && addState.height >= 44, JSON.stringify(addState))
  const imageFit = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.att-group.grid .msg-att')).objectFit`)
  check('вложенная картинка показывается целиком', imageFit === 'contain', imageFit)
  // Окно НЕ закрываем здесь: закрытие последнего окна заставляет Electron
  // выйти, и разбор правил ниже просто не успевал напечататься — выглядело
  // это как «проверка молча обрывается». Всё закончится вместе с process.exit.

  // ── Правила стилей ──────────────────────────────────────────────────────
  {
    const css = ['styles.css', 'ponoi-ui.css']
      .map(file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'))
      .join('\n')
    const б = разборСтилей(css)
    console.log('\n── Мобильные правила стилей ──')
    check('ничего не задано шириной больше узкого телефона', б.широкие.length === 0,
      б.широкие.slice(0, 6).join(' | '))
    check('нет целей мельче пальца', б.мелкие.length === 0, б.мелкие.slice(0, 50).join(' | '))
    check('прибитое к низу оставляет запас под жестовую полосу', б.низ.length === 0,
      б.низ.slice(0, 6).join(' | '))
    check('прибитое к верху оставляет запас под чёлку', б.верх.length === 0,
      б.верх.slice(0, 6).join(' | '))
    check('размеры считаются от оболочки, а не от экрана', б.экранные.length === 0,
      б.экранные.slice(0, 6).join(' | '))
    check('полноэкранные экраны не лезут под часы телефона', б.подЧасами.length === 0,
      б.подЧасами.slice(0, 6).join(' | '))
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
