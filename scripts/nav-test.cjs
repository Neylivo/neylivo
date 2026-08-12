// v1.557.0: сторож навигации Electron. Запуск: npm run test:nav
//
// Проверяется НАСТОЯЩЕЕ окно с настоящим сторожем из electron/navGuard.cjs:
// страница по-настоящему пытается увести себя на чужой адрес (window.location,
// ссылка с щелчком, форма с action, meta refresh), а проба смотрит, где окно
// оказалось на самом деле — по webContents.getURL(), а не по обещаниям кода.
//
// Почему это нельзя проверить в Node заглушками: заглушка проверяла бы саму
// себя. Весь смысл находки F5 в том, СРАБОТАЕТ ли событие will-navigate на
// каждый из этих способов ухода, а это знает только Chromium.
//
// Отдельно проверяется, что сторож не сломал нужное: своя страница, вложенная
// рамка с чужим адресом (встроенный YouTube в музыке) и открытие чужой ссылки
// снаружи вместо загрузки внутрь.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { своё, сторожить } = require('../electron/navGuard.cjs')

const OUT = path.join(__dirname, '..', 'dist-nav-test')
fs.mkdirSync(OUT, { recursive: true })

let всего = 0, плохо = 0
const проверить = (имя, ок, что) => {
  всего++
  if (ок) console.log('  ok  ' + имя)
  else { плохо++; console.log('  НЕТ ' + имя + (что ? ' — ' + что : '')) }
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверка не завершилась'); process.exit(2) }, 90000)

// Чужой адрес, до которого нельзя дойти по-настоящему: если сторож пропустит
// переход, окно упрётся в отсутствие сети — а нам нужно отличить «не пустили»
// от «не доехало». Поэтому чужое поднимаем своё же, на 127.0.0.1… нельзя:
// localhost у сторожа как раз СВОЙ. Берём адрес, который заведомо не
// резолвится, и смотрим, состоялся ли переход.
const ЧУЖОЙ = 'https://chuzhoy.invalid/page'

/**
 * Страница на диск.
 *
 * ГОЛОВА ОТДЕЛЬНЫМ ДОВОДОМ, И ЭТО ВАЖНО. Первая версия писала всё одной строкой
 * после <body> — и мета Content-Security-Policy оказывалась В ТЕЛЕ, где браузер
 * её игнорирует по спецификации. Проверки политики при этом «проходили» и
 * «падали» по совершенно посторонним причинам: <object> не грузился из-за
 * несуществующего домена, а не из-за политики. Мета обязана быть в <head>.
 */
function страница(тело, голова) {
  const f = path.join(OUT, 'p' + Math.random().toString(36).slice(2) + '.html')
  fs.writeFileSync(f, '<!doctype html><html><head><meta charset=utf-8>'
    + (голова || '') + '</head><body>' + тело + '</body></html>')
  return f
}

/**
 * Один опыт: загрузить свою страницу, выполнить попытку ухода и доложить,
 * начиналась ли навигация на чужой адрес.
 */
async function опыт(win, тело, действие) {
  await win.loadFile(страница(тело))
  const свой = win.webContents.getURL()
  let ушло = null
  // Мерить надо СОСТОЯВШИЙСЯ переход, а не начатый. Первую версию пробы я
  // повесил на did-start-navigation и получил пять «провалов» на рабочем
  // сторожe: это событие Electron присылает и тогда, когда will-navigate тут же
  // отменяет навигацию. Считается did-navigate — он приходит только на
  // закрепившийся переход главной рамки.
  const шпион = (_e, url) => { if (!своё(url)) ушло = url }
  win.webContents.on('did-navigate', шпион)
  try { await действие(win) } catch {}
  await new Promise(r => setTimeout(r, 900))
  win.webContents.off('did-navigate', шпион)
  return { ушло, остались: win.webContents.getURL() === свой }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 500, height: 400,
    webPreferences: { partition: 'nav-test-' + Date.now() } })

  // Наружу ничего не открываем по-настоящему — записываем, что попросили.
  const снаружи = []
  // SABOTAGE=nav — сторожа не ставим вовсе. Проверка, которая не умеет падать,
  // ничего не значит: так видно, что она меряет сторожа, а не саму себя.
  if (process.env.SABOTAGE !== 'nav') сторожить(win.webContents, (u) => снаружи.push(u))
  else console.log('  (SABOTAGE=nav: сторож не поставлен, проба обязана провалиться)')

  console.log('\nразбор адреса (без окна)')
  проверить('file:// своё', своё('file:///C:/app/dist/index.html') === true)
  проверить('localhost:5173 своё', своё('http://localhost:5173/') === true)
  проверить('127.0.0.1 своё', своё('http://127.0.0.1:5173/') === true)
  проверить('about:srcdoc своё (рамки плагинов)', своё('about:srcdoc') === true)
  проверить('blob: своё', своё('blob:file:///x') === true)
  проверить('чужой https не свой', своё('https://example.com/') === false)
  проверить('http на чужом хосте не свой', своё('http://evil.example/') === false)
  проверить('мусор не свой', своё('не адрес вовсе') === false)
  // Ловушка, на которую легко попасться самому: подстрока «localhost» в имени.
  проверить('localhost.evil.example не свой', своё('https://localhost.evil.example/') === false)

  console.log('\nуход главного окна на чужой адрес')

  let r = await опыт(win, '<script>setTimeout(()=>{location.href=' + JSON.stringify(ЧУЖОЙ) + '},50)</script>',
    async () => {})
  проверить('window.location.href не уводит окно', r.ушло === null && r.остались, r.ушло || '')

  r = await опыт(win, '<script>setTimeout(()=>{location.replace(' + JSON.stringify(ЧУЖОЙ) + ')},50)</script>',
    async () => {})
  проверить('location.replace не уводит окно', r.ушло === null && r.остались, r.ушло || '')

  r = await опыт(win, '<a id=a href="' + ЧУЖОЙ + '">тык</a>',
    async (w) => { await w.webContents.executeJavaScript('document.getElementById("a").click()') })
  проверить('щелчок по ссылке не уводит окно', r.ушло === null && r.остались, r.ушло || '')

  r = await опыт(win, '<form id=f method=get action="' + ЧУЖОЙ + '"><input name=q value=1></form>',
    async (w) => { await w.webContents.executeJavaScript('document.getElementById("f").submit()') })
  проверить('отправка формы не уводит окно', r.ушло === null && r.остались, r.ушло || '')

  r = await опыт(win, '<meta http-equiv="refresh" content="0;url=' + ЧУЖОЙ + '">', async () => {})
  проверить('meta refresh не уводит окно', r.ушло === null && r.остались, r.ушло || '')

  console.log('\nчужая ссылка не пропадает, а уходит наружу')
  снаружи.length = 0
  await опыт(win, '<script>setTimeout(()=>{location.href="https://example.com/x"},50)</script>', async () => {})
  проверить('https отдан системному браузеру', снаружи.includes('https://example.com/x'), снаружи.join(','))
  снаружи.length = 0
  // Диплинк игры: openGameLink без моста ставит window.location = roblox://…
  await опыт(win, '<script>setTimeout(()=>{location.href="roblox://experiences/start?placeId=1"},50)</script>', async () => {})
  проверить('диплинк roblox:// отдан системе (не съеден)',
    снаружи.some(u => u.startsWith('roblox:')), снаружи.join(','))

  console.log('\nсторож не сломал нужное')
  // Своя страница грузится и переходит на свою же.
  const своя2 = страница('<p>вторая</p>')
  await win.loadFile(страница('<a id=a href="' + 'file:///' + своя2.replace(/\\/g, '/') + '">своя</a>'))
  await win.webContents.executeJavaScript('document.getElementById("a").click()')
  await new Promise(r2 => setTimeout(r2, 900))
  проверить('переход на свою страницу проходит',
    win.webContents.getURL().toLowerCase().includes(path.basename(своя2).toLowerCase()),
    win.webContents.getURL())

  // Вложенная рамка с чужим адресом — это встроенный YouTube в музыке.
  // Она обязана НАЧАТЬ грузиться: запрет здесь означал бы сломанный плеер.
  await win.loadFile(страница('<p>рамка</p>'))
  let рамка = null
  const шпион2 = (_e, url, _ip, главная) => { if (!главная && !своё(url)) рамка = url }
  win.webContents.on('did-start-navigation', шпион2)
  await win.webContents.executeJavaScript(
    'var f=document.createElement("iframe");f.src="https://www.youtube-nocookie.com/embed/x";document.body.appendChild(f)')
  await new Promise(r2 => setTimeout(r2, 1200))
  win.webContents.off('did-start-navigation', шпион2)
  проверить('вложенная рамка на чужой адрес не запрещена (YouTube в музыке)', рамка !== null)

  // ── Политика страницы (CSP) ───────────────────────────────────────────────
  //
  // Берётся НАСТОЯЩАЯ строка из index.html, а не её копия: копия проверяла бы
  // саму себя и разошлась бы с приложением на первой же правке.
  console.log('\nполитика страницы (из index.html)')
  const индекс = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  const м = индекс.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)
  проверить('в index.html есть Content-Security-Policy', !!м)
  const политика = м ? м[1] : ''

  if (политика) {
    const csp = '<meta http-equiv="Content-Security-Policy" content="' + политика + '">'
    // Нарушения политики браузер сообщает событием securitypolicyviolation —
    // это и есть прямое измерение. Смотреть «загрузилось или нет» нельзя:
    // несуществующий домен не загрузится и без всякой политики, и проверка
    // радовалась бы отсутствию сети.
    const ловушка = '<script>window.__нар=[];addEventListener("securitypolicyviolation",'
      + 'function(e){window.__нар.push(e.violatedDirective)})</script>'

    // base-uri: чужой <base> не должен переопределить адрес страницы.
    await win.loadFile(страница('<base href="https://chuzhoy.invalid/"><p>x</p>', csp + ловушка))
    const base = await win.webContents.executeJavaScript('document.baseURI')
    проверить('base-uri: чужой <base> не действует', !String(base).includes('chuzhoy.invalid'), String(base))

    // object-src: <object> не должен ничего загрузить.
    await win.loadFile(страница('<object id=o data="https://chuzhoy.invalid/x.swf"></object>', csp + ловушка))
    await new Promise(r2 => setTimeout(r2, 400))
    const нар1 = await win.webContents.executeJavaScript('(window.__нар||[]).join(",")')
    проверить('object-src: <object> запрещён политикой', /object-src/.test(нар1), нар1)

    // form-action: отправка формы наружу не должна начаться.
    await win.loadFile(страница('<form id=f method=get action="https://chuzhoy.invalid/p"></form>', csp + ловушка))
    await win.webContents.executeJavaScript('document.getElementById("f").submit()')
    await new Promise(r2 => setTimeout(r2, 600))
    const нар2 = await win.webContents.executeJavaScript('(window.__нар||[]).join(",")')
    проверить('form-action: отправка формы наружу запрещена политикой', /form-action/.test(нар2), нар2)
  }

  // ── Отказ работать в чужой рамке ──────────────────────────────────────────
  console.log('\nотказ работать внутри чужой рамки')
  const сторожРамки = path.join(OUT, 'frameguard.js')
  проверить('собран frameGuard', fs.existsSync(сторожРамки),
    'нет ' + сторожРамки + ' — запускай через npm run test:nav')
  if (fs.existsSync(сторожРамки)) {
    // Собранный сторож вставляется в страницу ЦЕЛИКОМ, а не через src.
    // Причина: во вложении с sandbox документ получает чужое происхождение, и
    // подгрузка соседнего файла с file:// оттуда не работает — проверка мерила
    // бы несработавший <script src>, а не сторожа.
    const код = fs.readFileSync(сторожРамки, 'utf8')
    const внутренняя = страница('<div id=root>приложение</div><script>' + код
      + '\ntry{window.__итог = FG.держатьРамку()}catch(e){window.__итог = "сбой: "+e}</script>')
    const имяВнутр = path.basename(внутренняя)

    // Случай 1: рамка не запрещает навигацию верхнего уровня. Сторож обязан
    // ВЫЙТИ наверх — то есть верхним документом становится само приложение.
    await win.loadFile(страница('<iframe src="' + имяВнутр + '" width=300 height=200></iframe>'))
      .catch(() => {})   // выход наверх прерывает загрузку внешней страницы — так и должно быть
    await new Promise(r2 => setTimeout(r2, 1200))
    проверить('из обычной рамки сторож выходит наверх',
      win.webContents.getURL().toLowerCase().includes(имяВнутр.toLowerCase()),
      win.webContents.getURL())

    // Случай 2: рамка с sandbox — выйти наверх нельзя, браузер бросит исключение.
    // Тогда приложение обязано не запуститься и убрать свою разметку.
    await win.loadFile(страница('<iframe sandbox="allow-scripts" src="' + имяВнутр + '" width=300 height=200></iframe>'))
    await new Promise(r2 => setTimeout(r2, 1200))
    const рамки = win.webContents.mainFrame.frames
    проверить('вложенная рамка на месте (наверх выйти не дали)', рамки.length === 1)
    if (рамки.length === 1) {
      const итог = await рамки[0].executeJavaScript('window.__итог === true')
      проверить('во вложении сторож говорит «не запускаться»', итог === true)
      const остался = await рамки[0].executeJavaScript('!!document.getElementById("root")')
      проверить('во вложении разметка приложения убрана', остался === false)
    }

    // И обратное: сам по себе, верхним документом, сторож не мешает.
    await win.loadFile(внутренняя)
    const сверху = await win.webContents.executeJavaScript('window.__итог === false')
    проверить('верхним документом сторож не мешает', сверху === true)
    const цел = await win.webContents.executeJavaScript('!!document.getElementById("root")')
    проверить('верхним документом разметка приложения на месте', цел === true)
  }

  console.log('\nпроверок: ' + всего + ', не прошло: ' + плохо)
  app.exit(плохо ? 1 : 0)
})
