// Проверка на кривости в вёрстке. Запуск: npm run test:crooked
//
// Ищет то, что видно глазом, но не ловится ни одной проверкой на числах:
// кнопки, наехавшие друг на друга; элементы, вылезшие за окно; подписи,
// обрезанные без многоточия; наложения на полосу заголовка окна.
//
// Смотрит НАСТОЯЩЕЕ приложение (та же сборка, что для снимков сайта: настоящие
// компоненты, подменён только клиент базы), а не разметку «по мотивам».
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const КОРЕНЬ = path.join(__dirname, '..')
const СТРАНИЦА = (тема) => path.join(КОРЕНЬ, 'dist-site-shots', тема + '.html')
if (!fs.existsSync(СТРАНИЦА('dark'))) {
  console.error('нет сборки — сначала: node scripts/site-shots.mjs')
  process.exit(1)
}

const ЭКРАНЫ = [
  { имя: 'ЛС, 1440',            стр: 'dark',    ш: 1440, в: 900, дела: [] },
  { имя: 'сервер, 1440',        стр: 'dark',    ш: 1440, в: 900, дела: ['сервер'] },
  { имя: 'сервер, 1000',        стр: 'dark',    ш: 1000, в: 760, дела: ['сервер'] },
  { имя: 'телефон, 412',        стр: 'dark',    ш: 412,  в: 892, дела: ['сервер'] },
  { имя: 'рабочий стол, 1440',  стр: 'desktop', ш: 1440, в: 900, дела: ['сервер'] },
  { имя: 'рабочий стол + просмотр картинки', стр: 'desktop', ш: 1440, в: 900, дела: ['сервер', 'лайтбокс'] },
  { имя: 'меню у нижнего угла',   стр: 'dark', ш: 1440, в: 900, дела: ['сервер', 'меню-угол'] },
  { имя: 'меню у верхнего угла',  стр: 'dark', ш: 1440, в: 900, дела: ['сервер', 'меню-верх'] },
  { имя: 'меню у угла, окно 700', стр: 'dark', ш: 700,  в: 520, дела: ['сервер', 'меню-угол'] },
  { имя: 'настройки, 1440',       стр: 'dark', ш: 1440, в: 900, дела: ['настройки'] },
  { имя: 'настройки, окно 760',   стр: 'dark', ш: 760,  в: 560, дела: ['настройки'] },
]

const НАЖАТЬ = (сел) => `(() => {
  const n = document.querySelector(${JSON.stringify(сел)})
  if (!n) return 'нет: ' + ${JSON.stringify(сел)}
  n.click(); return 'ок'
})()`

/** Настоящее нажатие правой кнопкой в заданной точке окна. */
const ПРАВОЙ = (сел, гдеX, гдеY) => `(() => {
  const n = document.querySelector(${JSON.stringify(сел)})
  if (!n) return 'нет: ' + ${JSON.stringify(сел)}
  const x = ${гдеX}, y = ${гдеY}
  n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  return 'ок'
})()`

const ДЕЛА = {
  сервер: [НАЖАТЬ('button.srv:not(.add):not(.join):not(.home):not(.fold-head)')],
  // Меню у самого нижнего правого угла: именно там его обрезает край окна,
  // если оно не умеет разворачиваться в другую сторону.
  'меню-угол': [ПРАВОЙ('button.srv:not(.add):not(.join):not(.home):not(.fold-head)', 'innerWidth - 6', 'innerHeight - 6')],
  'меню-верх': [ПРАВОЙ('button.srv:not(.add):not(.join):not(.home):not(.fold-head)', '4', '4')],
  настройки: [НАЖАТЬ('button.me-out')],
  эмодзи: [НАЖАТЬ('.composer button[title*="мод"], .composer .cmp-emoji, .composer button')],
  // Просмотр картинки открывается своей же разметкой приложения: вложения на
  // стенде нет, а проверять надо ровно наложение его верхнего ряда на полосу
  // заголовка окна — на него владелец и прислал снимок.
  лайтбокс: [`(() => {
    const d = document.createElement('div')
    d.className = 'lightbox'
    d.innerHTML = '<div class="lightbox-zoom">'
      + '<button title="Крупнее">+</button><button title="Мельче">-</button>'
      + '<button title="Скачать">v</button><button title="Закрыть">x</button></div>'
    document.body.appendChild(d)
    return 'ок'
  })()`],
}

/**
 * Разбор в самой странице.
 *
 * ПОЧЕМУ ТАК, А НЕ ПО СНИМКУ. По картинке наложение кнопок не отличить от
 * задуманного слоя: у всплывающего меню оно нормально, у двух кнопок в ряд —
 * поломка. Здесь смотрятся настоящие прямоугольники настоящих узлов, и
 * задуманные слои (наложения, меню, подсказки) отсеиваются по признакам.
 */
const РАЗБОР = `(() => {
  const беды = []
  const видим = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const слой = (el) => {
    // Задуманные слои: у них своё положение и они лежат ПОВЕРХ. Такие с
    // соседями пересекаются по делу.
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.position === 'fixed' || s.position === 'absolute' || s.position === 'sticky') return n
    }
    return null
  }
  const имя = (el) => {
    const t = (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '') + (t ? ' «' + t + '»' : '')
  }

  /**
   * Убрано НАМЕРЕННО, а не сломано.
   *
   * На телефоне список каналов уезжает за левый край, когда открыта переписка,
   * а длинные списки прокручиваются. И то и другое даёт узлы вне окна — но это
   * задумано. Признак: элемент вне своего же обрезающего или уехавшего предка.
   * Первый прогон без этого дал тринадцать «кривостей», все ложные.
   */
  const убрано = (el) => {
    const r = el.getBoundingClientRect()
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n)
      const rn = n.getBoundingClientRect()
      const режет = s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible'
      if (режет && (r.right <= rn.left + 1 || r.left >= rn.right - 1 || r.bottom <= rn.top + 1 || r.top >= rn.bottom - 1)) return true
      if (s.transform !== 'none' && (rn.right <= 1 || rn.left >= innerWidth - 1)) return true
    }
    return false
  }

  const кнопки = [...document.querySelectorAll('button, a[href], [role=button], input, select, textarea')]
    .filter(видим).filter(el => !убрано(el))

  // ── 1. Кнопки наехали друг на друга ───────────────────────────────────────
  for (let i = 0; i < кнопки.length; i++) {
    for (let j = i + 1; j < кнопки.length; j++) {
      const a = кнопки[i], b = кнопки[j]
      if (a.contains(b) || b.contains(a)) continue
      // Разные слои пересекаются по делу: меню поверх списка и т.п.
      if (слой(a) !== слой(b)) continue
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (w > 2 && h > 2) беды.push({ вид: 'наложение', что: имя(a) + ' × ' + имя(b),
        сколько: Math.round(w) + '×' + Math.round(h) + 'px' })
    }
  }

  // ── 2. Вылезло за окно ────────────────────────────────────────────────────
  for (const el of кнопки) {
    const r = el.getBoundingClientRect()
    if (r.right > innerWidth + 2 || r.bottom > innerHeight + 2 || r.left < -2 || r.top < -2) {
      беды.push({ вид: 'за окном', что: имя(el),
        сколько: Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + '×' + Math.round(r.height) })
    }
  }

  // ── 3. Подпись обрезана без многоточия ────────────────────────────────────
  for (const el of [...document.querySelectorAll('*')].filter(видим)) {
    if (el.children.length || убрано(el)) continue
    const t = (el.textContent || '').trim()
    if (!t) continue
    const s = getComputedStyle(el)
    if (s.overflow === 'visible' && s.overflowX === 'visible') continue
    if (s.textOverflow === 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'auto' && s.overflowX !== 'scroll') {
      беды.push({ вид: 'обрезано', что: имя(el), сколько: el.scrollWidth + '>' + el.clientWidth })
    }
  }

  // ── 4. Лишняя прокрутка вбок ─────────────────────────────────────────────
  if (document.documentElement.scrollWidth > innerWidth + 2) {
    беды.push({ вид: 'прокрутка вбок', что: 'страница целиком',
      сколько: document.documentElement.scrollWidth + '>' + innerWidth })
  }

  // ── 5. Наложение на полосу заголовка окна ────────────────────────────────
  const полоса = document.querySelector('.titlebar')
  if (полоса) {
    const rp = полоса.getBoundingClientRect()
    for (const el of кнопки) {
      if (полоса.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.top < rp.bottom - 2 && r.bottom > rp.top + 2) {
        беды.push({ вид: 'на полосе заголовка', что: имя(el), сколько: Math.round(rp.bottom - r.top) + 'px' })
      }
    }
  }
  return JSON.stringify(беды)
})()`

/** Что обязано появиться после шага. */
const ЖДЁМ = {
  'сервер': '.ch-list',
  'меню-угол': '.ctxmenu',
  'меню-верх': '.ctxmenu',
  'настройки': process.env.SABOTAGE === 'steps' ? '.-нет-такого-' : '.pqs2-body, .pqs-body, .settings',
  'лайтбокс': '.lightbox',
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 180000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { partition: 'crooked-' + Date.now() } })
  let всего = 0
  for (const э of ЭКРАНЫ) {
    win.setContentSize(э.ш, э.в)
    await win.loadFile(СТРАНИЦА(э.стр))
    await new Promise(r => setTimeout(r, 1800))
    for (const шаг of э.дела) {
      for (const код of (ДЕЛА[шаг] || [])) {
        await win.webContents.executeJavaScript(код).catch(() => {})
        await new Promise(r => setTimeout(r, 900))
      }
      // Проверка, что шаг СРАБОТАЛ. Без неё «чисто» означало бы только то, что
      // экран не открылся: разбирать было нечего, и проба радовалась пустоте.
      const ждём = ЖДЁМ[шаг]
      if (ждём) {
        const есть = await win.webContents.executeJavaScript('!!document.querySelector(' + JSON.stringify(ждём) + ')')
        if (!есть) { console.log('  ! шаг «' + шаг + '» не сработал: нет ' + ждём); всего++ }
      }
    }
    // Проверка, которая не умеет падать, ничего не значит. SABOTAGE=crooked
    // возвращает прежнее поведение (наложения ничего не знают о полосе
    // заголовка) — проба обязана это заметить.
    if (process.env.SABOTAGE === 'crooked') {
      await win.webContents.executeJavaScript("document.documentElement.style.setProperty('--titlebar-h','0px')")
      await new Promise(r => setTimeout(r, 200))
    }
    const есть = await win.webContents.executeJavaScript("!!document.querySelector('.titlebar')")
    if (э.стр === 'desktop' && !есть) { console.log('  ! полосы заголовка нет — проверять нечего'); всего++ }
    const беды = JSON.parse(await win.webContents.executeJavaScript(РАЗБОР))
    console.log('\n' + э.имя + ': ' + (беды.length ? беды.length + ' кривостей' : 'чисто'))
    // Одинаковые повторяются десятками (список, таблица) — показываем по одной.
    const видано = new Set()
    for (const б of беды) {
      const ключ = б.вид + '|' + б.что
      if (видано.has(ключ)) continue
      видано.add(ключ)
      console.log('  ' + б.вид + ': ' + б.что + '  (' + б.сколько + ')')
    }
    всего += беды.length
  }
  console.log('\nвсего кривостей: ' + всего)
  app.exit(всего ? 1 : 0)
})
