// v1.528.0: панель эмодзи на телефоне — шторка снизу. Запуск: npm run test:picker
//
// Владелец прислал снимок мобильного Discord: панель не висит пузырём над
// кнопкой, а выезжает снизу во всю ширину — под строкой ввода, на месте
// клавиатуры, с полоской-ручкой и рядом вкладок сверху. Просьба: «1 в 1».
//
// Что было: .pop-anchor — absolute, bottom 52px, right 0. То есть пузырь над
// правым краем строки ввода: скруглённый со всех сторон, с полями по бокам, и
// половина экрана под ним пропадает зря.
//
// Проверяется геометрия НА НАСТОЯЩИХ СТИЛЯХ: где панель стоит, какой ширины и
// какой формы. Слова «сделал шторкой» без замера ничего не значат — ровно это
// уже случалось с полем ввода, где скругление рисовало овал вместо таблетки.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-picker-test')
fs.mkdirSync(OUT, { recursive: true })
for (const f of ['styles.css', 'ponoi-ui.css']) {
  fs.copyFileSync(path.join(__dirname, '..', 'src', f), path.join(OUT, f))
}

// Разметка списана с Composer.tsx и EmojiPicker.tsx.
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css"><link rel=stylesheet href="ponoi-ui.css">
<style>html,body{margin:0;height:100%;background:#313338;font-family:system-ui,sans-serif;color:#dbdee1}
:root{--brand:#5865f2;--ov:255,255,255;--c-accent:#5865f2}
html,body,.app-viewport,.app{height:100%}.chat{display:flex;flex-direction:column;height:100%}
.msgs{flex:1;min-height:0}</style>
<div class="app-viewport"><div class="app"><main class="chat" id="чат">
  <div class="msgs">переписка</div>
  <form class="composer cstyle-default" id="строка">
    <div class="plus-wrap"><button type="button" class="attach-btn">+</button></div>
    <div class="composer-field"><textarea rows="1" placeholder="Написать"></textarea>
      <button type="button" class="cin-emoji">&#9786;</button></div>
    <div class="composer-tools">
      <div class="pop-anchor" id="якорь">
        <div class="emoji-pop ep2" id="панель">
          <div class="ep2-tabs"><button class="on">Эмодзи</button><button>Гифки</button><button>Стикеры</button></div>
          <div class="ep2-search"><input placeholder="Найдите идеальный эмодзи"></div>
          <div class="ep2-body"><div class="emoji-scroll">сетка</div></div>
        </div>
      </div>
    </div>
    <div class="cin-act"><button class="cin-mic">&#9679;</button><button type="submit" class="send-tg">&#10148;</button></div>
  </form>
</main></div></div>`)

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 412, height: 860, backgroundColor: '#313338',
    webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 300))
  const d = win.webContents.debugger
  if (!d.isAttached()) d.attach('1.3')
  // Телефон — это не только узкое окно: раскладка спрашивает и про сенсор.
  await d.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }],
  })
  // Приложение помечает тело страницы, пока шторка открыта, — от этой отметки
  // и поднимается строка ввода. Без неё стенд мерил бы не то устройство.
  await win.webContents.executeJavaScript(`document.body.classList.add('pick-open')`)
  await new Promise(r => setTimeout(r, 400))

  const м = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const п = document.getElementById('панель').getBoundingClientRect()
    const с = document.getElementById('строка').getBoundingClientRect()
    const st = getComputedStyle(document.getElementById('панель'))
    const я = getComputedStyle(document.getElementById('якорь'))
    const ручка = getComputedStyle(document.getElementById('панель'), '::before')
    const вкл = document.querySelector('.ep2-tabs').getBoundingClientRect()
    return JSON.stringify({
      панель: { x: Math.round(п.x), y: Math.round(п.y), ш: Math.round(п.width), в: Math.round(п.height) },
      строка: { y: Math.round(с.y), низ: Math.round(с.bottom) },
      окно: { ш: window.innerWidth, в: window.innerHeight },
      скругление: st.borderRadius,
      положение: я.position,
      ручкаШирина: parseFloat(ручка.width) || 0,
      вкладки: { ш: Math.round(вкл.width), y: Math.round(вкл.y) },
    })
  })()`))

  console.log('\n── Панель эмодзи на телефоне (412) ──')
  console.log('   ' + JSON.stringify(м.панель) + ' при окне ' + м.окно.ш + '×' + м.окно.в)

  check('панель прибита к низу окна', м.панель.y + м.панель.в >= м.окно.в - 2,
    'низ панели ' + (м.панель.y + м.панель.в) + ', окно ' + м.окно.в)
  check('во всю ширину, а не пузырём у края',
    м.панель.x <= 1 && м.панель.ш >= м.окно.ш - 1,
    'x=' + м.панель.x + ', ширина ' + м.панель.ш + ' из ' + м.окно.ш)
  check('скруглена только сверху', /0px 0px|0px$/.test(м.скругление.trim()) && !/^0px 0px 0px 0px$/.test(м.скругление.trim()),
    'скругление: ' + м.скругление)
  check('стоит на месте клавиатуры, а не поверх строки ввода',
    м.панель.y >= м.строка.низ - 2, 'верх панели ' + м.панель.y + ', низ строки ' + м.строка.низ)
  check('есть полоска-ручка сверху', м.ручкаШирина >= 20, 'ширина ручки ' + м.ручкаШирина)
  check('ряд вкладок во всю ширину', м.вкладки.ш >= м.окно.ш - 24,
    'вкладки ' + м.вкладки.ш + ' из ' + м.окно.ш)

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
