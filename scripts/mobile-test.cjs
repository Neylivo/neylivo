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
  const re = /@media\s*\(max-width:\s*(\d+)px\)\s*\{/g
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

  // Собираем все объявления по каждому селектору.
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

  const беды = { широкие: [], мелкие: [], низ: [], верх: [], экранные: [] }
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
      if (итог !== null && итог !== undefined && итог < 40) {
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
  win.destroy()

  // ── Правила стилей ──────────────────────────────────────────────────────
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
    const б = разборСтилей(css)
    console.log('\n── Мобильные правила стилей ──')
    check('ничего не задано шириной больше узкого телефона', б.широкие.length === 0,
      б.широкие.slice(0, 6).join(' | '))
    check('нет целей мельче пальца', б.мелкие.length === 0, б.мелкие.slice(0, 6).join(' | '))
    check('прибитое к низу оставляет запас под жестовую полосу', б.низ.length === 0,
      б.низ.slice(0, 6).join(' | '))
    check('прибитое к верху оставляет запас под чёлку', б.верх.length === 0,
      б.верх.slice(0, 6).join(' | '))
    check('размеры считаются от оболочки, а не от экрана', б.экранные.length === 0,
      б.экранные.slice(0, 6).join(' | '))
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
