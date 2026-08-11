// Неровности темы: где текст пропадает. Запуск: npm run test:contrast
//
// Владелец: «все неровности в теме приложения починить».
//
// ОТКУДА ОНИ БЕРУТСЯ. В стилях 1181 правило с жёстко вписанным цветом: #dbdee1
// вместо цвета текста, #b5bac1 вместо вторичного, #2b2d31 вместо подложки. На
// тёмной теме всё это ровно те же цвета, что и переменные, — поэтому не видно
// вообще ничего. А светлая тема переменные меняет, вписанное — нет: остаётся
// светло-серая надпись на белом и тёмная плашка посреди светлого окна.
//
// Разработчик сидит в тёмной теме и не увидит этого никогда. Поэтому здесь
// обход: девять настоящих экранов × две темы, и каждый кусочек текста меряется
// числом.
//
// ПОЧЕМУ ПИКСЕЛЯМИ, А НЕ ПО СТИЛЯМ. Вычисленный цвет фона у полупрозрачного
// элемента — это «rgba(0,0,0,.1)», и что человек увидит, зависит от того, что
// под ним. Складывать слои в уме — гадание. Снимок показывает ровно то, что на
// экране: берём самый светлый и самый тёмный пиксель внутри строки — это фон и
// буквы — и считаем между ними разницу общей мерой WCAG.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
if (!fs.existsSync(DIST)) {
  console.error('нет собранного приложения — сперва npm run build')
  process.exit(1)
}

const { экраны } = require('./screens.cjs')

/**
 * Ниже этого текст сливается с фоном.
 *
 * 3 — общая мера для крупного и жирного; мелкому по правилам положено 4.5. Взят
 * мягкий порог намеренно: задача — найти пропавшее, а не переспорить дизайн.
 * Приглушённые подписи (var(--mut)) живут около 4 и в норме.
 */
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

/** Палитры ровно те же, что в src/lib/settings.tsx (THEMES). */
const ПАЛИТРЫ = {
  dark: { dark: '#1e1f22', main: '#23272a', panel: '#2b2d31', content: '#313338', hover: '#383a40', active: '#35373c', accent: '#5865f2', tx: '#dbdee1', mut: '#949ba4', light: false },
  light: { dark: '#e3e5e8', main: '#ebedef', panel: '#f2f3f5', content: '#ffffff', hover: '#e8eaed', active: '#e0e2e6', accent: '#5865f2', tx: '#313338', mut: '#5c5e66', light: true },
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 300000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1000, height: 900,
    webPreferences: { backgroundThrottling: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))
  const кудаСнимки = path.join(__dirname, '..', 'dist-look')
  fs.mkdirSync(кудаСнимки, { recursive: true })

  for (const экран of экраны()) {
    for (const тема of ['dark', 'light']) {
      win.setContentSize(экран.ш, Math.min(экран.в, 900))
      await new Promise(r => setTimeout(r, 200))
      await win.webContents.executeJavaScript(`(() => {
        // Тему нельзя переключить одним признаком: приложение раскрашивается
        // ВПИСАННЫМИ в корень переменными (src/lib/settings.tsx, apply), а
        // вписанное сильнее любого правила из файла.
        //
        // Две попытки до этого врали по-разному. Один признак data-theme не менял
        // ничего: числа совпадали до третьего знака. Снять вписанное и отдать
        // слово стилям — стало хуже: подложка осталась тёмной, а подсветки
        // почернели, и стенд отчитался о десяти «нечитаемых» местах, которых в
        // приложении нет. Поэтому здесь делается ровно то же, что делает
        // приложение: тот же список переменных, те же значения палитры.
        const к = document.documentElement
        const п = ${JSON.stringify(ПАЛИТРЫ[тема])}
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
        document.body.innerHTML = ${JSON.stringify(экран.html)}
        const s = document.createElement('style')
        s.textContent = 'html,body{height:100%;margin:0} .app-viewport,.app{height:100%}'
          + ' .channels,.servers,.chat,.dm-side{height:100%} .ch-list,.msgs{flex:1}'
          + ' .av{width:32px;height:32px;border-radius:50%;background:#5865f2;display:inline-block}'
          + ' .me-av{width:32px;height:32px;border-radius:50%;background:#3ba55d;display:inline-block}'
        document.head.appendChild(s)
      })()`)
      await new Promise(r => setTimeout(r, 500))

      // Берём КОНЦЕВЫЕ элементы с текстом: у них внутри только буквы и фон, и
      // «самый светлый против самого тёмного» — это ровно текст против подложки.
      // У контейнера внутри лежат чужие плашки, и мерка теряет смысл.
      const строки = JSON.parse(await win.webContents.executeJavaScript(`(() => {
        const из = []
        for (const el of document.querySelectorAll('body *')) {
          if (el.children.length) continue
          const т = (el.textContent || '').trim()
          if (т.length < 2) continue
          const s = getComputedStyle(el)
          if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < .5) continue
          const r = el.getBoundingClientRect()
          if (r.width < 12 || r.height < 8) continue
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
          const имя = el.tagName.toLowerCase()
            + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
          из.push({ имя: имя + ' «' + т.slice(0, 22) + '»', x: r.x, y: r.y, w: r.width, h: r.height })
        }
        return JSON.stringify(из)
      })()`))

      const кадр = await win.webContents.capturePage()
      // Снимок остаётся на диске: числа говорят «не читается», а глазами видно,
      // почему именно. Без этого разбираться пришлось бы вслепую.
      fs.writeFileSync(path.join(кудаСнимки,
        'тема-' + экран.имя.replace(/\s+/g, '-') + '-' + (тема === 'dark' ? 'тёмная' : 'светлая') + '.png'), кадр.toPNG())
      const { width, height } = кадр.getSize()
      const биты = кадр.getBitmap()
      const плохие = []

      for (const с of строки) {
        const x0 = Math.round(с.x), x1 = Math.round(с.x + с.w)
        const y0 = Math.round(с.y), y1 = Math.round(с.y + с.h)
        let мин = null, макс = null
        for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
          for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
            const i = (y * width + x) * 4
            const L = светимость(биты[i + 2], биты[i + 1], биты[i])   // BGRA
            if (мин === null || L < мин) мин = L
            if (макс === null || L > макс) макс = L
          }
        }
        if (мин === null) continue
        const разница = (макс + 0.05) / (мин + 0.05)
        if (разница < ПОРОГ) плохие.push(с.имя + ' → ' + разница.toFixed(2))
      }

      check(экран.имя + ', ' + (тема === 'dark' ? 'тёмная' : 'светлая')
        + ': весь текст читается (' + строки.length + ' строк)',
      плохие.length === 0, плохие.slice(0, 6).join(' | ')
        + (плохие.length > 6 ? ' … ещё ' + (плохие.length - 6) : ''))
    }
  }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
