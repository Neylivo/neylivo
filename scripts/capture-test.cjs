// v1.556.0: живая проверка защиты от снимков экрана. Запуск: npm run test:capture
//
// ЗАЧЕМ ОНА ВООБЩЕ НУЖНА. `win.setContentProtection(true)` — одна строка, и
// именно поэтому её легко посчитать сделанной. Проверить её можно только одним
// способом: НАСТОЯЩИМ системным захватом экрана. Если снимать окно изнутри
// (webContents.capturePage), защита не участвует вовсе — картинка придёт целой,
// и проверка молча одобрит неработающую защиту.
//
// Поэтому здесь: показываем окно, залитое чистым красным, и снимаем ВЕСЬ ЭКРАН
// через desktopCapturer — тот же путь, которым идут «Ножницы», OBS и
// демонстрация экрана в звонке. Считаем красные точки в снимке.
//
//   защита выключена -> красное на экране есть;
//   защита включена  -> красного нет.
//
// Второе без первого ничего не значит: красного может не быть и потому, что
// окно не открылось, экран заблокирован или снимок пуст. Поэтому проверка
// СНАЧАЛА убеждается, что видит окно, и только потом — что перестала.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')

// Без этого проверка обрывается на середине: закрыв ПОСЛЕДНЕЕ окно, Electron на
// Windows выходит сам, и следующее окно уже не загружается — ERR_FAILED на
// собственном файле, из которого причина совершенно не видна. Потерял на этом
// один прогон.
app.on('window-all-closed', () => { /* выходим сами, в конце проверки */ })

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

/** Доля чисто красных точек во всём снимке экрана, в процентах. */
async function краснотаЭкрана() {
  const дисплей = screen.getPrimaryDisplay()
  const { width, height } = дисплей.size
  const источники = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width / 2), height: Math.round(height / 2) },
  })
  if (!источники.length) return { доля: -1, почему: 'система не отдала ни одного экрана' }
  const кадр = источники[0].thumbnail
  if (кадр.isEmpty()) return { доля: -1, почему: 'снимок экрана пуст' }
  const { width: w, height: h } = кадр.getSize()
  const байты = кадр.toBitmap()   // BGRA
  let красных = 0
  const всего = w * h
  for (let i = 0; i < байты.length; i += 4) {
    const b = байты[i], g = байты[i + 1], r = байты[i + 2]
    // Тот самый красный, которым залито окно, с запасом на пересчёт цвета при
    // масштабировании снимка.
    if (r > 200 && g < 60 && b < 60) красных++
  }
  return { доля: (красных / всего) * 100, почему: '' }
}

app.whenReady().then(async () => {
  const дисплей = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: 600, height: 400,
    x: дисплей.workArea.x + 60, y: дисплей.workArea.y + 60,
    frame: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#ff0000',
    webPreferences: { backgroundThrottling: false },
  })
  await win.loadURL('data:text/html,' + encodeURIComponent(
    '<body style="margin:0;background:#ff0000;width:100vw;height:100vh"></body>'))
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
  await new Promise(r => setTimeout(r, 1500))

  // 1. Без защиты окно ОБЯЗАНО быть видно. Иначе всё остальное недоказуемо.
  win.setContentProtection(false)
  await new Promise(r => setTimeout(r, 900))
  const без = await краснотаЭкрана()
  if (без.доля < 0) {
    check('снимок экрана вообще получается', false, без.почему)
    console.log('\nИТОГ: провалено ' + (failed || 1))
    app.exit(1)
    return
  }
  check('без защиты окно видно в снимке экрана', без.доля > 1,
    'красного ' + без.доля.toFixed(2) + '% (ждали больше 1%)')

  // 2. С защитой его быть не должно.
  win.setContentProtection(true)
  await new Promise(r => setTimeout(r, 900))
  const с = await краснотаЭкрана()
  check('с защитой окно из снимка пропало', с.доля >= 0 && с.доля < 0.1,
    'красного ' + с.доля.toFixed(2) + '% (ждали меньше 0.1%)')

  // 3. И возвращается обратно — переключатель должен работать в обе стороны,
  //    иначе выключить защиту было бы нельзя без перезапуска.
  win.setContentProtection(false)
  await new Promise(r => setTimeout(r, 900))
  const снова = await краснотаЭкрана()
  check('защита снимается обратно', снова.доля > 1,
    'красного ' + снова.доля.toFixed(2) + '%')

  // 4. Своя же картинка окна остаётся целой: защита закрывает окно от ЧУЖИХ
  //    глаз, а не ломает его отрисовку. Если бы ломала, приложение показывало
  //    бы чёрное и самому человеку.
  win.setContentProtection(true)
  await new Promise(r => setTimeout(r, 500))
  const своё = await win.webContents.capturePage()
  const б = своё.toBitmap()
  let свои = 0
  for (let i = 0; i < б.length; i += 4) {
    if (б[i + 2] > 200 && б[i + 1] < 60 && б[i] < 60) свои++
  }
  check('человеку окно по-прежнему видно', свои / (б.length / 4) > 0.9,
    'красного внутри окна ' + ((свои / (б.length / 4)) * 100).toFixed(1) + '%')

  win.destroy()

  // ── Вторая мера: скрытие текста ──────────────────────────────────────────
  //
  // Она про другое — про чужую камеру и взгляд через плечо, — и проверяется
  // иначе: на НАСТОЯЩЕМ styles.css, а не на выдуманной разметке. Смысл только
  // в этом: правило легко написать так, что оно не попадёт по элементу, и
  // тогда «скрытие» не скрывает ничего.
  const w2 = new BrowserWindow({ show: false, width: 800, height: 600,
    webPreferences: { backgroundThrottling: false } })
  // Страница пишется файлом, а не грузится data-адресом: styles.css весит
  // сотни килобайт, и такой адрес Electron отвергает целиком (ERR_FAILED).
  const fs2 = require('fs'), path2 = require('path')
  const ПАПКА = path2.join(__dirname, '..', 'dist-capture-test')
  fs2.mkdirSync(ПАПКА, { recursive: true })
  fs2.copyFileSync(path2.join(__dirname, '..', 'src', 'styles.css'),
    path2.join(ПАПКА, 'styles.css'))
  fs2.writeFileSync(path2.join(ПАПКА, 'index.html'),
    '<!doctype html><meta charset=utf-8><link rel=stylesheet href="styles.css">'
    + '<body><div class="msg" id="m" style="height:80px">'
    + '<div class="msg-body"><div class="msg-txt" id="t">тайное сообщение</div></div>'
    + '</div></body>', 'utf8')
  await w2.loadFile(path2.join(ПАПКА, 'index.html'))
  // Окно обязано быть ПОКАЗАНО.
  //
  // В скрытом окне Chromium не продвигает переходы CSS: размытие навсегда
  // застревает на blur(0px), и проверка честно сообщает «не размыто» про
  // совершенно исправное правило. Потерял на этом два прогона, прежде чем
  // сообразил посмотреть на само число, а не на факт наличия blur().
  w2.showInactive()
  await new Promise(r => setTimeout(r, 600))

  // Замер ПОСЛЕ окончания перехода.
  //
  // У размытия есть transition, и computed style сразу после смены класса
  // отдаёт середину перехода — в первый раз я получил blur(0px) и чуть не
  // записал это в «размыто»: проверка `blur(\d` совпадает и с нулём. Отсюда
  // два вывода, оба в коде: ждать, и требовать НАСТОЯЩЕЙ величины размытия.
  const стиль = async () => {
    await new Promise(r => setTimeout(r, 500))
    return JSON.parse(await w2.webContents.executeJavaScript(`(() => {
      const s = getComputedStyle(document.getElementById('t'))
      return JSON.stringify({ filter: s.filter, select: s.userSelect, opacity: s.opacity })
    })()`))
  }
  /** Размыто ли по-настоящему: меньше 4 пикселей текст ещё читается. */
  const размыто = ф => {
    const m = /blur\(([\d.]+)px\)/.exec(ф || '')
    return !!m && Number(m[1]) >= 4
  }

  const открыто = await стиль()
  check('без настройки текст не тронут', открыто.filter === 'none',
    'filter: ' + открыто.filter)

  await w2.webContents.executeJavaScript(
    `document.documentElement.classList.add('hide-msg'), true`)
  const скрыто = await стиль()
  check('с настройкой текст размыт', размыто(скрыто.filter), 'filter: ' + скрыто.filter)
  // Размытый текст, который можно выделить и скопировать, читается в буфере —
  // и мера не стоит ничего.
  check('размытое нельзя выделить', скрыто.select === 'none', 'user-select: ' + скрыто.select)

  // Настоящее наведение мыши, а не класс руками: правило висит на :hover
  // РОДИТЕЛЯ, и промах по вложенности виден только так.
  const где = JSON.parse(await w2.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('m').getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
  })()`))
  w2.webContents.sendInputEvent({ type: 'mouseMove', x: где.x, y: где.y })
  await new Promise(r => setTimeout(r, 400))
  const подМышью = await стиль()
  check('под мышью текст открывается', подМышью.filter === 'none', 'filter: ' + подМышью.filter)

  // Уводим мышь — и текст обязан закрыться обратно.
  w2.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 580 })
  await new Promise(r => setTimeout(r, 400))
  const снова2 = await стиль()
  check('без мыши закрывается обратно', размыто(снова2.filter), 'filter: ' + снова2.filter)

  // На телефоне наведения нет — там открывает прикосновение, и оно ставит
  // класс open. Без этой ветки настройка означала бы «на телефоне читать нельзя».
  await w2.webContents.executeJavaScript(
    `document.getElementById('m').classList.add('open'), true`)
  const поКасанию = await стиль()
  check('прикосновение открывает (для телефона)', поКасанию.filter === 'none',
    'filter: ' + поКасанию.filter)

  w2.destroy()
  console.log('\nИТОГ: провалено ' + failed)
  app.exit(failed ? 1 : 0)
})

setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)
