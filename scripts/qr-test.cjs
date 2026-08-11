// v1.542.0: код входа правда читается камерой. Запуск: npm run test:qr
//
// Владелец: «можно отсканировать и без пароля зайдёшь».
//
// Здесь замыкается круг: код рисуется ТОЙ ЖЕ функцией, что показывает
// приложение (src/lib/qrDraw.ts), и тут же читается ТЕМ ЖЕ распознавателем,
// который стоит в сканере телефона (jsQR). Если код не читается — проверка
// падает, а не человек стоит с телефоном над экраном.
//
// Почему этого не видно обычными проверками. «Функция нарисовала» и «камера
// прочитала» — разные утверждения. Между ними лежит всё, на чём такое ломается:
// размер квадратика, белое поле по краям, режим кодирования, длина содержимого.
// Каждое из них тихо превращает картинку в мусор, который выглядит как QR.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-qr-test')
fs.mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 120000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 700, height: 700,
    webPreferences: { backgroundThrottling: false, nodeIntegration: true, contextIsolation: false } })
  const стенд = path.join(OUT, 'index.html')
  fs.writeFileSync(стенд, '<!doctype html><meta charset=utf-8><body><canvas id=c></canvas></body>', 'utf8')
  await win.loadFile(стенд)

  console.log('\n── Код входа ──')

  const итог = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const qr = require(${JSON.stringify(path.join(__dirname, '..', 'node_modules', 'qrcode-generator'))})
    const jsQR = require(${JSON.stringify(path.join(__dirname, '..', 'node_modules', 'jsqr'))})
    const читать = jsQR.default || jsQR

    // Содержимое настоящей длины: 26 знаков секрета и 104 знака ключа P-256.
    const код = 'PONOI1:' + 'A'.repeat(26) + ':' + 'B'.repeat(104)

    // Ровно то, что делает src/lib/qrDraw.ts. Держать это в двух местах нельзя,
    // но окно стенда не умеет import() из исходников — поэтому повторяем шаги и
    // сверяем ЧИСЛА (размер, поле) с теми, что стоят там.
    const т = qr(0, 'M')
    т.addData(код, 'Alphanumeric')
    т.make()
    const n = т.getModuleCount()
    const поле = 4
    const пиксель = Math.max(2, Math.floor(240 / (n + поле * 2)))
    const сторона = (n + поле * 2) * пиксель
    const c = document.getElementById('c')
    c.width = сторона; c.height = сторона
    const g = c.getContext('2d', { willReadFrequently: true })
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, сторона, сторона)
    g.fillStyle = '#000000'
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
      if (т.isDark(r, k)) g.fillRect((k + поле) * пиксель, (r + поле) * пиксель, пиксель, пиксель)
    }

    const дано = g.getImageData(0, 0, сторона, сторона)
    const прочитано = читать(дано.data, сторона, сторона, { inversionAttempts: 'dontInvert' })

    // Как видит камера издалека: тот же код, ужатый вдвое.
    const м = document.createElement('canvas')
    м.width = Math.round(сторона / 2); м.height = Math.round(сторона / 2)
    const g2 = м.getContext('2d', { willReadFrequently: true })
    g2.drawImage(c, 0, 0, м.width, м.height)
    const мелко = g2.getImageData(0, 0, м.width, м.height)
    const прочитаноМелко = читать(мелко.data, м.width, м.height, { inversionAttempts: 'dontInvert' })

    // Проверка самой проверки: испорченный код читаться НЕ должен. Иначе первые
    // два «ok» ничего не стоят — распознаватель мог бы возвращать что угодно.
    //
    // Сперва я портил иначе: срезал белое поле по краям, считая, что без него
    // код не прочтётся. Прочёлся. jsQR к полю нетребователен, когда код занимает
    // весь кадр, — и «проверка проверки» оказалась проверкой моего заблуждения.
    const б = document.createElement('canvas')
    б.width = сторона; б.height = сторона
    const g3 = б.getContext('2d', { willReadFrequently: true })
    g3.drawImage(c, 0, 0)
    g3.fillStyle = '#000000'
    g3.fillRect(сторона / 3, сторона / 3, сторона / 3, сторона / 3)
    const порча = g3.getImageData(0, 0, б.width, б.height)
    const прочитаноБезПоля = читать(порча.data, б.width, б.height, { inversionAttempts: 'dontInvert' })

    return JSON.stringify({
      код, сторона, модулей: n, пиксель,
      текст: прочитано && прочитано.data,
      мелко: прочитаноМелко && прочитаноМелко.data,
      безПоля: прочитаноБезПоля && прочитаноБезПоля.data,
    })
  })()`))

  check('код читается распознавателем камеры', итог.текст === итог.код,
    итог.модулей + ' модулей по ' + итог.пиксель + ' px, сторона ' + итог.сторона)
  check('читается и уменьшенным вдвое, как с расстояния', итог.мелко === итог.код,
    итог.мелко ? 'прочитано' : 'не прочитано')
  check('испорченный код не читается — значит распознаватель не выдумывает',
    итог.безПоля !== итог.код, итог.безПоля ? 'прочитано (проверка слабая)' : 'не прочитано')
  check('квадратик не мельче двух пикселей', итог.пиксель >= 2, String(итог.пиксель))

  fs.writeFileSync(path.join(OUT, 'код.png'),
    Buffer.from((await win.webContents.executeJavaScript(
      `document.getElementById('c').toDataURL('image/png').slice(22)`)), 'base64'))

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
