// v1.551.0: кнопки звонка нужного размера и видны целиком. Запуск: npm run test:call
//
// Владелец: «чини звонки, кнопки размеры и их видимость — это ужас».
//
// Он был прав, и вот что намерил стенд на телефоне до починки:
//   круглые кнопки — 36×52, 37×52, 40×52 вместо 52×52 (три разных овала);
//   стрелка выбора устройства — 52×52 вместо 22×46 (раздулась вдвое);
//   кнопка внутри группы — 46×52 вместо 46×46;
//   правый край полосы — 404 при экране 396, то есть «выйти» уезжала ЗА КРАЙ.
//
// Последнее — не косметика: из звонка нечем было выйти. Поэтому проверка стоит
// отдельно и меряет числа, а не «выглядит нормально».
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { ЗВОНОК } = require('./screens.cjs')

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

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 412, height: 800,
    backgroundColor: '#1e1f22', webPreferences: { backgroundThrottling: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 600))

  for (const ширина of [412, 320]) {
    win.setContentSize(ширина, 800)
    await new Promise(r => setTimeout(r, 250))
    await win.webContents.executeJavaScript(`(() => {
      document.body.className = 'no-anim'
      document.body.innerHTML = ${JSON.stringify(ЗВОНОК)}
    })()`)
    await new Promise(r => setTimeout(r, 350))

    const м = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const мер = el => { const r = el.getBoundingClientRect()
        return { ш: Math.round(r.width), в: Math.round(r.height),
          лево: Math.round(r.left), право: Math.round(r.right) } }
      const круги = [...document.querySelectorAll('.c2-bar > .c2-btn:not(.leave)')].map(мер)
      const выйти = document.querySelector('.c2-bar > .c2-btn.leave')
      const стрелки = [...document.querySelectorAll('.c2-caret')].map(мер)
      const вГруппе = [...document.querySelectorAll('.c2-grp .c2-btn')].map(мер)
      const быстрые = [...document.querySelectorAll('.c2-qrow button')].map(мер)
      const всеПолосы = [...document.querySelectorAll('.c2-bar *')].map(мер)
      return JSON.stringify({ окно: innerWidth, круги, выйти: выйти ? мер(выйти) : null,
        стрелки, вГруппе, быстрые, всеПолосы })
    })()`))

    console.log('\n── Звонок при ширине ' + м.окно + ' ──')

    // 1. Круги — круглые и одинаковые. Разные размеры у соседних кнопок это
    //    первое, что бросается в глаза.
    check('круглые кнопки одинаковые и круглые',
      м.круги.length >= 2 && м.круги.every(к => к.ш === к.в && к.ш === м.круги[0].ш),
      м.круги.map(к => к.ш + 'x' + к.в).join(', '))

    // 2. «Выйти» шире прочих намеренно: её ищут глазами и жмут в спешке.
    check('«выйти» шире остальных', !!м.выйти && м.выйти.ш > м.круги[0].ш,
      м.выйти ? м.выйти.ш + 'x' + м.выйти.в : 'нет')

    // 3. Стрелка выбора устройства — узкая. Раздутая до круга, она отнимает
    //    место у самих кнопок, и полоса перестаёт помещаться.
    check('стрелки выбора устройства узкие',
      м.стрелки.length > 0 && м.стрелки.every(с => с.ш <= 30),
      м.стрелки.map(с => с.ш + 'x' + с.в).join(', '))

    // 4. Кнопки внутри группы — свой размер, не подменённый общим правилом.
    check('кнопки в группе квадратные',
      м.вГруппе.every(к => Math.abs(к.ш - к.в) <= 1),
      м.вГруппе.map(к => к.ш + 'x' + к.в).join(', '))

    // 5. ГЛАВНОЕ: ничего не уехало за край. Кнопка «выйти» за краем означает,
    //    что из звонка нечем выйти.
    const заКрай = м.всеПолосы.filter(э => э.право > м.окно + 1 || э.лево < -1)
    check('ничего из полосы не уходит за край экрана', заКрай.length === 0,
      заКрай.map(э => 'до ' + э.право).join(', ') || 'край ' + м.окно)

    // 6. Быстрый ряд — цели под палец.
    check('быстрые кнопки не мельче пальца',
      м.быстрые.every(б => б.в >= 44 - 0.5),
      м.быстрые.map(б => б.ш + 'x' + б.в).join(', '))
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
