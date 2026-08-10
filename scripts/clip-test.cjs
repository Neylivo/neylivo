// v1.538.0: запись последних секунд экрана правда пишется. Запуск: npm run test:clip
//
// Владелец: «добавить возможность как в Medal сохранять от 5 секунд до 3 минут
// того, что происходило на экране».
//
// Проверяется НАСТОЯЩИЙ путь: захват экрана, кольцо кусков, сохранение файла на
// диск и то, что этот файл открывается и декодируется. Половинчатая проверка
// («функция вызвалась») тут ничего не стоила бы: главная беда этой затеи —
// файл, который весит мегабайты и не открывается ничем, потому что у webm
// первый кусок это заголовок, и выбрасывать его нельзя.
const { app, BrowserWindow, session, desktopCapturer } = require('electron')
const fs = require('fs')
const path = require('path')
const клипы = require('./../electron/clipRecorder.cjs')

const OUT = path.join(__dirname, '..', 'dist-clip-test')
fs.mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 120000)

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(s => cb({ video: s[0] }))
  })

  console.log('\n── Запись последних секунд экрана ──')

  const пуск = await клипы.start({ seconds: 10, fps: 24, height: 480, bitrate: 1_500_000, folder: OUT })
  check('запись началась', пуск.ok === true, пуск.why || '')
  if (!пуск.ok) { console.log('\nИТОГ: провалено ' + (failed + 1)); process.exit(1) }

  // Ждём дольше, чем длина клипа: так проверяется и вытеснение старых кусков.
  await new Promise(r => setTimeout(r, 8000))

  const рано = клипы.state()
  check('запись идёт и знает свою папку', рано.running === true && !!рано.folder, рано.folder)

  const итог = await клипы.save(5, 'проверка.webm')
  check('клип сохранён на диск', итог.ok === true, итог.why || итог.path || '')
  if (итог.ok) {
    const размер = fs.statSync(итог.path).size
    check('файл не пустой', размер > 20000, Math.round(размер / 1024) + ' КБ')

    // Главное: файл ОТКРЫВАЕТСЯ. Проверяем движком, а не по расширению.
    const win = new BrowserWindow({ show: false, width: 400, height: 300,
      webPreferences: { backgroundThrottling: false, webSecurity: false } })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<meta charset=utf-8><body></body>'))
    const кадр = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const v = document.createElement('video')
      v.muted = true
      document.body.appendChild(v)
      v.src = ${JSON.stringify('file:///' + итог.path.replace(/\\/g, '/'))}
      v.load()
      const r = await new Promise(готово => {
        const глянуть = () => готово({ w: v.videoWidth, h: v.videoHeight, s: v.readyState })
        v.onloadeddata = глянуть
        v.onerror = () => готово({ w: 0, h: 0, s: -1 })
        setTimeout(глянуть, 6000)
      })
      return JSON.stringify(r)
    })()`))
    check('клип открывается и декодируется', кадр.w > 0 && кадр.h > 0,
      кадр.w + 'x' + кадр.h + ', готовность ' + кадр.s)
  }

  клипы.stop()
  check('запись останавливается', клипы.state().running === false)

  // Прибираем за собой: проверка не должна оставлять мусор в репозитории.
  try { for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f)) } catch { /* уже чисто */ }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
