// v1.525.0: движение в приложении не пропало. Запуск: npm run test:anim
//
// Зачем. Поверх наших стилей появился второй слой (src/neylivo-ui.css), который
// задаёт тем же элементам свои рамки, тени и переходы. CSS так и работает: кто
// ниже — тот и прав, и объявление `transition: background-color .16s` не
// добавляется к прежнему, а ЗАМЕНЯЕТ его целиком. Значит любое движение,
// которого нет в новом списке (например, transform), пропадает молча: ошибки
// нет, вид почти тот же, а живость интерфейса ушла.
//
// Владелец сказал прямо: почини все сломанные анимации. Глазами это ловится
// плохо — исчезновение плавности заметно только рядом с прежней версией.
// Поэтому здесь замер: страница поднимается ДВАЖДЫ — со старыми стилями и с
// обоими слоями, — и у каждого образца сравниваются переходы и анимации.
//
// Проверка не требует «всё как было»: новый слой имеет право менять вид. Она
// требует, чтобы движение не ИСЧЕЗАЛО: если элемент раньше плавно менял
// положение или прозрачность, он должен делать это и теперь.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-anim-test')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))
fs.copyFileSync(path.join(__dirname, '..', 'src', 'neylivo-ui.css'), path.join(OUT, 'neylivo-ui.css'))

// Образцы: разметка списана с настоящих экранов. Для каждого — что именно
// должно двигаться, чтобы интерфейс не выглядел мёртвым.
const ОБРАЗЦЫ = [
  { имя: 'сервер в рейке', html: '<nav class="servers"><div class="srv-wrap"><button class="srv" id="%">P</button></div></nav>' },
  { имя: 'канал', html: '<div class="channels"><div class="ch" id="%">общий</div></div>' },
  { имя: 'строка диалога', html: '<aside class="dm-side"><div class="dm-item" id="%">Друг</div></aside>' },
  { имя: 'сообщение', html: '<div class="msgs"><div class="msg" id="%"><div class="msg-body">привет</div></div></div>' },
  { имя: 'аватарка в сообщении', html: '<div class="msg"><div class="msg-gutter"><span class="av-click" id="%"><span class="av"></span></span></div></div>' },
  { имя: 'участник', html: '<div class="members"><div class="member" id="%">Ваня</div></div>' },
  { имя: 'вкладка друзей', html: '<div class="pfr-tabs"><button class="pfr-tab" id="%">В сети</button></div>' },
  { имя: 'карточка раздела', html: '<div class="cat-tile" id="%" style="width:160px;height:90px"></div>' },
  { имя: 'плитка активности', html: '<div class="act-card" id="%">Играет</div>' },
  { имя: 'окно', html: '<div class="modal" id="%">окно</div>' },
  { имя: 'мини-профиль', html: '<div class="mini" id="%">профиль</div>' },
  { имя: 'строка ввода', html: '<form class="composer cstyle-default" id="%"><textarea rows="1"></textarea></form>' },
]

function страница(соСлоем) {
  return `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css">
${соСлоем ? '<link rel=stylesheet href="neylivo-ui.css">' : ''}
<style>html,body{margin:0;background:#313338;font-family:system-ui,sans-serif;color:#dbdee1}
:root{--c-accent:#5865f2;--ov:255,255,255;--brand:#5865f2}
.probes{display:flex;flex-wrap:wrap;gap:16px;padding:16px;align-items:flex-start}</style>
<div class="probes">${ОБРАЗЦЫ.map((о, n) => о.html.replace('%', 't' + n)).join('\n')}</div>`
}

fs.writeFileSync(path.join(OUT, 'было.html'), страница(false))
fs.writeFileSync(path.join(OUT, 'стало.html'), страница(true))

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

/** Что элемент умеет двигать: список свойств перехода плюс имя анимации. */
async function движение(win) {
  return JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const из = []
    for (let n = 0; n < ${ОБРАЗЦЫ.length}; n++) {
      const e = document.getElementById('t' + n)
      if (!e) { из.push(null); continue }
      const s = getComputedStyle(e)
      const свойства = s.transitionProperty.split(',').map(x => x.trim()).filter(x => x && x !== 'none')
      const длит = s.transitionDuration.split(',').map(x => parseFloat(x) || 0)
      // Свойство с нулевой длительностью не двигается — это запись без действия.
      const живые = свойства.filter((_, i) => (длит[i] ?? длит[0] ?? 0) > 0)
      из.push({ переходы: живые, анимация: s.animationName === 'none' ? '' : s.animationName })
    }
    return JSON.stringify(из)
  })()`))
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, backgroundColor: '#313338',
    webPreferences: { backgroundThrottling: false } })

  await win.loadFile(path.join(OUT, 'было.html'))
  await new Promise(r => setTimeout(r, 300))
  const было = await движение(win)

  await win.loadFile(path.join(OUT, 'стало.html'))
  await new Promise(r => setTimeout(r, 300))
  const стало = await движение(win)

  console.log('\n── Что двигалось раньше и что двигается теперь ──')
  for (let n = 0; n < ОБРАЗЦЫ.length; n++) {
    const о = ОБРАЗЦЫ[n], a = было[n], b = стало[n]
    if (!a || !b) { check('образец на месте: ' + о.имя, false, 'разметка не нашлась'); continue }
    const пропало = a.переходы.filter(p => !b.переходы.includes(p) && !b.переходы.includes('all'))
    const строка = о.имя + ': было [' + a.переходы.join(' ') + '] стало [' + b.переходы.join(' ') + ']'
    check('движение не пропало: ' + о.имя, пропало.length === 0,
      пропало.length ? 'пропало: ' + пропало.join(', ') + ' | ' + строка : строка)
    if (a.анимация) {
      check('анимация на месте: ' + о.имя, !!b.анимация,
        'было «' + a.анимация + '», стало «' + (b.анимация || 'ничего') + '»')
    }
  }

  // ── v1.526.0: выделение тихое, а форма значка живая ────────────────────
  //
  // Владелец: «сделать приложение нормальным». Крикливее всего было выделение:
  // общий слой стилей красил КАЖДУЮ выбранную строку синей подложкой с рамкой и
  // полосой, а выбранный сервер, наоборот, делал блёклым — залитым цветом на
  // 17% вместо сплошного. Плюс скругление значка было прибито к одному
  // значению, и превращение круга в скруглённый квадрат не происходило вовсе.
  await win.webContents.executeJavaScript(`(() => {
    document.body.innerHTML = '<nav class="servers"><div class="srv-wrap"><button class="srv" id="покой">П</button></div>'
      + '<div class="srv-wrap on"><button class="srv on" id="выбран">В</button></div></nav>'
      + '<aside class="channels"><div class="ch" id="обычный">общий</div><div class="ch on" id="активный">выбранный</div></aside>'
  })()`)
  await new Promise(r => setTimeout(r, 300))
  const вид = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const в = (id) => { const s = getComputedStyle(document.getElementById(id))
      return { радиус: parseFloat(s.borderTopLeftRadius), фон: s.backgroundColor,
               рамка: s.borderTopColor, тень: s.boxShadow } }
    return JSON.stringify({ покой: в('покой'), выбран: в('выбран'), активный: в('активный') })
  })()`))

  console.log('\n── Как показано выбранное ──')
  check('значок сервера в покое круглый, а у выбранного — скруглённый квадрат',
    вид.покой.радиус >= 20 && вид.выбран.радиус < вид.покой.радиус,
    'покой ' + вид.покой.радиус + 'px, выбран ' + вид.выбран.радиус + 'px')
  check('выбранный сервер залит цветом, а не подкрашен',
    /rgb\(\s*88,\s*101,\s*242\s*\)/.test(вид.выбран.фон),
    'фон: ' + вид.выбран.фон)
  check('выбранный канал показан подложкой, без рамки и полосы',
    вид.активный.тень === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(вид.активный.рамка)
    && вид.активный.фон !== 'rgba(0, 0, 0, 0)',
    'фон ' + вид.активный.фон + ', рамка ' + вид.активный.рамка + ', тень ' + вид.активный.тень)

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
