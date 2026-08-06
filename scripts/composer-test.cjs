// v1.501.0: строку ввода на телефоне НЕ ОБРЕЗАЕТ. Запуск: npm run test:composer
//
// Владелец прислал снимок: печатает длинное сообщение, поле выросло на шесть
// строк — и вместо «Нормальная» видно «ормальная», а в последней строке вместо
// «сообщение» — «ообщение». Первые буквы срезаны по дуге.
//
// Причина не видна в исходнике: правило выглядит безобидно
// (border-radius: 999px, как у таблетки). Но поле РАСТЁТ вместе с текстом, и на
// высоте 130 радиус становится 65 — дуга угла заходит внутрь на тридцать
// пикселей, то есть дальше отступа в четырнадцать, и режет текст.
//
// ПОЧЕМУ ПИКСЕЛЯМИ, А НЕ ЗНАЧЕНИЕМ СВОЙСТВА. Проверка «радиус не больше
// двадцати двух» ничего не стоит: она поймала бы ровно этот случай и прошла бы
// мимо любого другого способа отрезать текст (переполнение, отрицательный
// отступ, маска). Поэтому стенд СМОТРИТ на нарисованное.
//
// КАК ИМЕННО. Рядом ставится ЭТАЛОН — второе поле с тем же текстом, шириной,
// шрифтом и отступами, но без скругления и без обрезки. Дальше в каждой строке
// СЧИТАЮТСЯ светлые пиксели и сравниваются с эталонными. Обрезанная строка
// теряет их — и неважно, чем её обрезало.
//
// Сначала я мерил проще: самый левый светлый пиксель строки. Такая мерка
// пропустила поломку на ширине 412 — дуга съела верх буквы «Н», а её ножка
// ниже осталась на прежнем месте, и «левый край» не сдвинулся. Подлог это
// показал, потому и переделано на счёт пикселей.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-composer-test')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))

// Тот самый текст со снимка владельца — длинный, чтобы поле выросло.
const ТЕКСТ = 'Нормальная летающая выбор что сделать с сообщением для телефонов ' +
  'открывающиеся внятным кликом ровно на сообщение'

// Разметка списана с Composer.tsx: поле между кнопкой скрепки и значками.
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css">
<style>html,body{margin:0;height:100%;background:#313338;font-family:system-ui,sans-serif}</style>
<div style="position:absolute;bottom:0;left:0;right:0">
  <div class="composer">
    <button class="attach-btn">+</button>
    <textarea id="cin" rows="1">${ТЕКСТ}</textarea>
    <div class="composer-tools"><button class="ctool">&#9786;</button></div>
  </div>
</div>`)

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

/**
 * Сколько светлых пикселей в каждой строке текста.
 *
 * getBitmap отдаёт BGRA подряд, строка за строкой. Порог 120 отделяет буквы
 * (около 219) от подложки поля (около 43) — между ними нет ничего.
 */
function пикселиПоСтрокам(картинка, поле, высотаСтроки, отступСверху) {
  const { width } = картинка.getSize()
  const b = картинка.getBitmap()
  const счёт = []
  for (let n = 0; ; n++) {
    const верх = Math.round(поле.y + отступСверху + n * высотаСтроки)
    const низ = Math.round(верх + высотаСтроки)
    if (низ > поле.y + поле.height) break
    let сколько = 0
    for (let y = верх; y < низ; y++) {
      for (let x = Math.round(поле.x); x < Math.round(поле.x + поле.width); x++) {
        const i = (y * width + x) * 4
        if ((b[i] + b[i + 1] + b[i + 2]) / 3 > 120) сколько++
      }
    }
    счёт.push(сколько)
  }
  return счёт
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 412, height: 560, backgroundColor: '#313338' })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 400))

  for (const [имя, ширина] of [['телефон', 412], ['узкий телефон', 320]]) {
    win.setContentSize(ширина, 560)
    await new Promise(r => setTimeout(r, 250))
    // Поле растёт под текст — так же, как это делает сам Composer. Рядом
    // ставится эталон: те же ширина, шрифт и отступы, но без скругления и без
    // обрезки. Он рисуется на такой же подложке, иначе порог яркости соврёт.
    const мерка = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const t = document.getElementById('cin')
      t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'
      const s = getComputedStyle(t)
      let э = document.getElementById('ref')
      if (!э) {
        э = t.cloneNode(true); э.id = 'ref'; document.body.appendChild(э)
      }
      for (const имя of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'padding', 'width', 'color', 'backgroundColor', 'borderWidth', 'borderStyle', 'borderColor']) {
        э.style[имя] = s[имя]
      }
      э.style.position = 'absolute'; э.style.left = '0px'; э.style.top = '0px'
      э.style.borderRadius = '0'; э.style.boxSizing = s.boxSizing; э.style.resize = 'none'
      э.style.height = 'auto'; э.style.height = э.scrollHeight + 'px'
      const r = t.getBoundingClientRect(), rэ = э.getBoundingClientRect()
      return JSON.stringify({
        поле: { x: r.x, y: r.y, width: r.width, height: r.height },
        эталон: { x: rэ.x, y: rэ.y, width: rэ.width, height: rэ.height },
        строка: parseFloat(s.lineHeight), сверху: parseFloat(s.paddingTop),
        радиус: s.borderTopLeftRadius,
      })
    })()`))
    await new Promise(r => setTimeout(r, 200))
    const картинка = await win.webContents.capturePage()
    const было = пикселиПоСтрокам(картинка, мерка.поле, мерка.строка, мерка.сверху)
    const надо = пикселиПоСтрокам(картинка, мерка.эталон, мерка.строка, мерка.сверху)

    console.log('\n── ' + имя + ' (' + ширина + ') ──')
    console.log('   поле ' + Math.round(мерка.поле.height) + ' высотой, радиус ' + мерка.радиус)
    console.log('   пикселей по строкам: ' + JSON.stringify(было))
    console.log('   у эталона:           ' + JSON.stringify(надо))

    check('поле выросло под текст и эталон совпал по строкам',
      было.length >= 3 && было.length === надо.length,
      'строк ' + было.length + ', у эталона ' + надо.length)
    if (было.length >= 3 && было.length === надо.length) {
      // Допуск в 3% — на сглаживание букв: подложка у поля и у эталона одна и
      // та же, но пиксель на краю буквы может лечь на полтона иначе.
      let худшая = -1, потеря = 0
      for (let n = 0; n < было.length; n++) {
        const доля = надо[n] ? (надо[n] - было[n]) / надо[n] : 0
        if (доля > потеря) { потеря = доля; худшая = n }
      }
      check('ни одна строка не потеряла букв',
        потеря <= 0.03,
        худшая < 0 ? 'потерь нет'
          : 'строка ' + (худшая + 1) + ': ' + было[худшая] + ' вместо ' + надо[худшая] +
            ' (−' + Math.round(потеря * 100) + '%)')
    }
  }

  console.log('\nИТОГ: провалено ' + failed)
  // Окно закрываем ПОСЛЕ печати: закрытие последнего окна заставляет Electron
  // выйти раньше, чем вывод дойдёт до трубы.
  process.exit(failed ? 1 : 0)
})
