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
    //
    // Окно нарочно обычное: file://-страница и защита включена — ровно как в
    // приложении, где клип показывается прямо в настройках. С webSecurity:false
    // проверка проходила бы и в том случае, когда у настоящего окна доступа к
    // файлу нет и человек видит чёрный прямоугольник.
    // Страница нарочно лежит в ДРУГОЙ папке, чем клип: в приложении окно живёт
    // внутри программы, а клипы — в «Видео/Ponoi», и проверять надо именно
    // чтение из чужой папки.
    const стенд = path.join(require('os').tmpdir(), 'ponoi-clip-player.html')
    fs.writeFileSync(стенд, '<meta charset=utf-8><body></body>', 'utf8')
    const win = new BrowserWindow({ show: false, width: 400, height: 300,
      webPreferences: { backgroundThrottling: false } })
    await win.loadFile(стенд)
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

  // v1.539.0: список клипов и то, чем он открывается.
  //
  // Список читается из папки, а не из памяти: только так проверяется, что там
  // лежит настоящий файл и что удаление правда его убирает.
  const второй = await клипы.save(5, клипы.имяКлипа(new Date(), 'Half-Life 2'))
  check('второй клип сохранён', второй.ok === true, второй.why || '')
  const список = клипы.list()
  check('список видит оба клипа', список.length === 2, 'нашлось ' + список.length)
  check('в списке есть размер и время', список.every(c => c.bytes > 0 && c.at > 0))
  check('новый клип идёт первым', список[0].at >= список[1].at)
  // Дефис и пробел в названии игры остаются: это не запретные для файла знаки.
  check('название игры попало в имя целиком', /^Half-Life 2 /.test(список[0].name), список[0].name)

  // Имя должно зависеть от МОМЕНТА нажатия: раньше окно присылало готовое имя
  // вместе с настройками, и второе нажатие F7 писало файл поверх первого.
  const а = клипы.имяКлипа(new Date(2026, 7, 5, 12, 0, 0), null)
  const б = клипы.имяКлипа(new Date(2026, 7, 5, 12, 0, 1), null)
  check('два нажатия подряд дают разные имена', а !== б, а + ' / ' + б)
  // Имя собирается в двух местах: здесь (для F7) и в src/lib/clipBuffer.ts (для
  // кнопки). Обе проверки сверяются с одной и той же строкой — иначе клипы от
  // клавиши и от кнопки начнут называться по-разному, и никто этого не заметит.
  const образец = клипы.имяКлипа(new Date(2026, 7, 5, 12, 0, 0), 'Half-Life 2')
  check('формат имени тот же, что у кнопки', образец === 'Half-Life 2 2026-08-05 12-00-00.webm', образец)
  check('в имени нет запрещённых для Windows знаков', !/[\\/:*?"<>|]/.test(клипы.имяКлипа(new Date(), 'A/B:C*D')))

  // Путь горячей клавиши целиком: настройки от окна + два нажатия подряд.
  //
  // Именно здесь была ошибка, которую видно только по файлам: окно присылало
  // готовое имя вместе с настройками, и ВТОРОЕ нажатие писало поверх первого
  // клипа. Проверка нажимает дважды в одну секунду — самый злой случай.
  клипы.hotkeySettings({ seconds: 5, game: 'Portal 2' })
  const было = клипы.list().length
  const н1 = await клипы.saveHotkey()
  const н2 = await клипы.saveHotkey()
  check('клавиша сохраняет клип', н1.ok === true && н2.ok === true, (н1.why || '') + (н2.why || ''))
  check('второе нажатие не затирает первое', н1.path !== н2.path, (н1.path || '') + ' / ' + (н2.path || ''))
  check('оба файла лежат на диске', клипы.list().length === было + 2, 'стало ' + клипы.list().length)
  check('клавиша берёт длину и игру из настроек', /^Portal 2 /.test(path.basename(н1.path || '')), path.basename(н1.path || ''))
  for (const p of [н1.path, н2.path]) { try { fs.unlinkSync(p) } catch { /* уже нет */ } }

  const мимо = клипы.remove('../../важное.webm')
  check('удаление не выходит из папки клипов', мимо.ok === false, мимо.why || '')
  const убрали = клипы.remove(список[0].name)
  check('клип удаляется', убрали.ok === true, убрали.why || '')
  check('удалённого нет в списке', клипы.list().length === 1)

  клипы.stop()
  check('запись останавливается', клипы.state().running === false)

  // Прибираем за собой: проверка не должна оставлять мусор в репозитории.
  try { for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f)) } catch { /* уже чисто */ }

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
