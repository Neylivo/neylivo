// Текст на кнопке читается — на обеих темах. Запуск: npm run test:contrast
//
// Зачем. Сводя полсотни разных фонов кнопок к одному набору (v1.540.0), я
// заменил сплошной серый #4e5058 на просвечивающую заливку rgba(var(--ov),.10).
// На тёмной теме это то же самое; на светлой --ov становится чёрным, кнопка
// делается светло-серой — а подпись у неё осталась жёстко белой. Белым по
// светло-серому. Поймать это глазами на тёмной теме невозможно в принципе:
// разработчик сидит в тёмной, а ломается светлая.
//
// ПОЧЕМУ ПИКСЕЛЯМИ, А НЕ ПО СТИЛЯМ. Вычисленный цвет фона у полупрозрачной
// кнопки — это «rgba(0,0,0,.1)», и что человек увидит, зависит от того, что под
// ней. Складывать слои в уме — это гадать. Снимок показывает ровно то, что на
// экране: берём самый светлый и самый тёмный пиксель внутри кнопки — это фон и
// буквы — и считаем между ними разницу по общей мере WCAG.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
if (!fs.existsSync(DIST)) {
  console.error('нет собранного приложения — сперва npm run build')
  process.exit(1)
}

const { витрина } = require('./button-gallery.cjs')

/** Ниже этого подпись сливается с кнопкой. 3 — общая мера для крупного и
 *  жирного текста, каким и написаны подписи кнопок. */
const ПОРОГ = 3

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

/** Относительная яркость по WCAG. */
function светимость(r, g, b) {
  const к = v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * к(r) + 0.7152 * к(g) + 0.0722 * к(b)
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 120000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1000, height: 900,
    webPreferences: { backgroundThrottling: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))

  for (const тема of ['dark', 'light']) {
    console.log('\n── Тема: ' + (тема === 'dark' ? 'тёмная' : 'светлая') + ' ──')
    await win.webContents.executeJavaScript(`(() => {
      // Тему нельзя переключить одним признаком: приложение раскрашивается
      // ВПИСАННЫМИ в корень переменными (src/lib/settings.tsx, apply), а
      // вписанное сильнее любого правила из файла.
      //
      // Две попытки до этого врали по-разному. Один признак data-theme не менял
      // ничего: числа у кнопок совпадали до третьего знака. Снять вписанное и
      // отдать слово стилям — стало хуже: подложка страницы осталась тёмной, а
      // подсветки почернели, и стенд отчитался о десяти «нечитаемых» кнопках,
      // которых в приложении нет. Поэтому здесь делается ровно то же, что
      // делает приложение: тот же список переменных, те же значения палитры.
      const к = document.documentElement
      const п = ${JSON.stringify(тема === 'dark'
        ? { dark: '#1e1f22', main: '#23272a', panel: '#2b2d31', content: '#313338', hover: '#383a40', active: '#35373c', accent: '#5865f2', tx: '#dbdee1', mut: '#949ba4', light: false }
        : { dark: '#e3e5e8', main: '#ebedef', panel: '#f2f3f5', content: '#ffffff', hover: '#e8eaed', active: '#e0e2e6', accent: '#5865f2', tx: '#313338', mut: '#5c5e66', light: true })}
      к.style.setProperty('--c-dark', п.dark)
      к.style.setProperty('--c-main', п.main)
      к.style.setProperty('--c-panel', п.panel)
      к.style.setProperty('--c-content', п.content)
      к.style.setProperty('--c-hover', п.hover)
      к.style.setProperty('--c-active', п.active)
      к.style.setProperty('--c-accent', п.accent)
      к.style.setProperty('--tx', п.tx)
      к.style.setProperty('--mut', п.mut)
      к.style.setProperty('--ov', п.light ? '0,0,0' : '255,255,255')
      к.style.setProperty('--tx-hi', п.light ? '#1a1a1c' : '#ffffff')
      к.style.setProperty('--tx-name', п.light ? '#1a1a1c' : '#f2f3f5')
      к.setAttribute('data-theme', ${JSON.stringify(тема)})
      document.body.className = ''
      document.body.innerHTML = ${JSON.stringify(витрина())}
    })()`)
    await new Promise(r => setTimeout(r, 600))

    // Меряем только кнопки С ПОДПИСЬЮ: у значка нет текста, и «самый тёмный
    // пиксель» там — это сам значок, разница с фоном у него своя мера.
    const кнопки = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const из = []
      for (const el of document.querySelectorAll('button')) {
        const т = (el.textContent || '').trim()
        if (т.length < 3) continue
        const r = el.getBoundingClientRect()
        if (r.width < 10 || r.height < 10) continue
        из.push({ имя: (el.className || 'без класса') + ' «' + т.slice(0, 18) + '»',
          x: r.x, y: r.y, w: r.width, h: r.height })
      }
      return JSON.stringify(из)
    })()`))

    const кадр = await win.webContents.capturePage()
    // Снимок остаётся на диске: числа говорят «не читается», а глазами видно,
    // почему именно. Без этого разбираться пришлось бы вслепую.
    const кудаСнимки = path.join(__dirname, '..', 'dist-look')
    fs.mkdirSync(кудаСнимки, { recursive: true })
    fs.writeFileSync(path.join(кудаСнимки, 'кнопки-' + (тема === 'dark' ? 'тёмная' : 'светлая') + '.png'), кадр.toPNG())
    const { width, height } = кадр.getSize()
    const биты = кадр.getBitmap()
    const плохие = []

    for (const к of кнопки) {
      // Отступаем от краёв: там скругление и подложка страницы, а не кнопка.
      const x0 = Math.round(к.x + 4), x1 = Math.round(к.x + к.w - 4)
      const y0 = Math.round(к.y + 4), y1 = Math.round(к.y + к.h - 4)
      let мин = null, макс = null
      for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
          const i = (y * width + x) * 4
          // getBitmap отдаёт BGRA.
          const L = светимость(биты[i + 2], биты[i + 1], биты[i])
          if (мин === null || L < мин) мин = L
          if (макс === null || L > макс) макс = L
        }
      }
      if (мин === null) continue
      const разница = (макс + 0.05) / (мин + 0.05)
      if (разница < ПОРОГ) плохие.push(к.имя + ' → ' + разница.toFixed(2))
    }

    check('подписи читаются на всех кнопках (' + кнопки.length + ' шт.)',
      плохие.length === 0, плохие.join(' | '))
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
