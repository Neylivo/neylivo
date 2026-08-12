// Окно для снимков сайта. Запускается из scripts/site-shots.mjs.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const КОРЕНЬ = path.join(__dirname, '..')
const СТРАНИЦА = (тема) => path.join(КОРЕНЬ, 'dist-site-shots', тема + '.html')
// Имена файлов латиницей: они попадают в адреса на сайте.
const КУДА = path.join(КОРЕНЬ, '..', 'ponoi-site', 'assets', 'shots')
fs.mkdirSync(КУДА, { recursive: true })

// Что снимаем. Экран задаётся не «страницей», а действиями внутри настоящего
// приложения: снимок обязан показывать то, до чего человек доходит руками.
const СНИМКИ = [
  { имя: 'server-dark',    ш: 1440, в: 900, тема: 'dark',  дела: ['сервер'] },
  { имя: 'server-light',   ш: 1440, в: 900, тема: 'light', дела: ['сервер'] },
  { имя: 'phone-server',   ш: 412,  в: 892, тема: 'dark',  дела: ['сервер'] },
]

// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ — чтобы не выглядело недосмотром.
//
// • Личные сообщения: клик по беседе валит стенд («name is not iterable») —
//   где-то в пути открытия диалога ожидается поле, которого нет в подставных
//   данных. Чинить это значило бы чинить стенд, а не приложение, а сервер
//   показывает те же сообщения, тот же композитор и тех же участников.
// • Музыка: панель открывается, но очередь наполняется мусором стенда
//   («СЕЙЧАС ИГРАЕТ», идентификатор вместо исполнителя, «Слушает: undefined»).
//   Такой снимок на официальном сайте — враньё картинкой, и лучше его не быть.
// • Настройки: кнопка нажимается, окно на снимке не появляется.
//   Для настроек уже есть НАСТОЯЩИЙ снимок из npm run look:real — он снят с
//   тех же компонентов без всякой подставной базы, и берётся именно он.


app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 180000)

/**
 * Нажать по селектору.
 *
 * Именно по селектору, а не по видимому тексту: кнопка сервера в рейке
 * подписана двумя буквами («МА»), а полное имя живёт в отдельной подсказке
 * RailTip — поиск по тексту её не находил, и снимок «сервера» получался
 * экраном друзей. Проверка на это встроена: если элемента нет, шаг сообщает об
 * этом и снимок помечается замечанием.
 */
const НАЖАТЬ = (сел, n = 0) => `(() => {
  const узлы = [...document.querySelectorAll(${JSON.stringify(сел)})]
  if (!узлы[${n}]) return 'нет: ' + ${JSON.stringify(сел)}
  узлы[${n}].click()
  return 'ок'
})()`

const ДЕЛА = {
  // Кнопка сервера в рейке — .srv без служебных классов «домой/плюс/компас».
  // Сервер, а затем нужный канал: по умолчанию открывается первый по алфавиту
  // («музыка»), а на снимке нужен разговор, а не пустой канал.
  // Нужный канал выбирать не приходится: он назван так, что оказывается первым
  // по алфавиту, а приложение открывает первый. Кликать по списку каналов я
  // пробовал — обработчик висит не на том узле, на который попадает click(),
  // и снимок молча оставался на пустом канале.
  сервер: [
    НАЖАТЬ('button.srv:not(.add):not(.join):not(.home):not(.fold-head)'),
  ],
  // Первая беседа в списке личных сообщений.
  беседа: [НАЖАТЬ('.dm-item')],
  музыка: [НАЖАТЬ('button.me-music')],
  настройки: [НАЖАТЬ('button.me-out')],
}

app.whenReady().then(async () => {
  let ошибок = 0
  // ОДНО окно на все снимки.
  //
  // Второе созданное окно в этом же процессе Electron грузит файл с
  // ERR_FAILED — проверено отдельно, на пустой странице из одного абзаца, то
  // есть дело не в приложении. Размер и тему меняем у одного окна: так же
  // устроены и остальные пробы проекта.
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { partition: 'site-shots-' + Date.now() },
  })
  const беды = []
  win.webContents.on('console-message', (_e, lvl, msg) => {
    if (lvl >= 2 && !/Security Warning|Content Security|electronjs\.org|unnecessary security risks|once the app is packaged|For more information/.test(msg)) беды.push(msg)
    if (process.env.SHOTS_NOISE) console.log('    [' + lvl + '] ' + msg)
  })

  for (const с of СНИМКИ) {
    беды.length = 0
    win.setContentSize(с.ш, с.в)
    await win.loadFile(СТРАНИЦА(с.тема))
    await new Promise(r => setTimeout(r, 1800))

    for (const шаг of с.дела) {
      for (const код of (ДЕЛА[шаг] || [])) {
        const r = await win.webContents.executeJavaScript(код).catch(e => 'сбой: ' + e.message)
        if (String(r).startsWith('нет') || String(r).startsWith('сбой')) {
          console.log('  ! ' + с.имя + ' / ' + шаг + ': ' + r)
          ошибок++
        }
        await new Promise(r2 => setTimeout(r2, 700))
      }
    }
    await new Promise(r => setTimeout(r, 500))

    if (process.env.SHOTS_DEBUG) {
      const r = await win.webContents.executeJavaScript(
        "JSON.stringify({msg: document.querySelectorAll('.msg, .msg-row, [class*=msg-]').length, txt: (document.querySelector('.msgs')||{}).innerText ? (document.querySelector('.msgs').innerText||'').slice(0,300) : 'нет .msgs'})")
      console.log('    отладка: ' + r)
    }
    // Первый снимок выбрасывается намеренно: Electron отдаёт последний
    // отрисованный кадр, и у скрытого окна он отстаёт. Сообщения в DOM уже были
    // (проверял SHOTS_DEBUG), а на картинке лента оставалась пустой.
    await win.webContents.capturePage()
    await new Promise(r => setTimeout(r, 600))
    const кадр = await win.webContents.capturePage()
    fs.writeFileSync(path.join(КУДА, с.имя + '.png'), кадр.toPNG())
    const узлов = await win.webContents.executeJavaScript('document.querySelectorAll("*").length')
    console.log('снято: ' + с.имя + '.png (' + с.ш + '×' + с.в + ', узлов: ' + узлов + ')'
      + (беды.length ? '  ОШИБКИ: ' + беды.slice(0, 2).join(' | ').slice(0, 200) : ''))
    if (узлов < 250) { console.log('  ! почти пустой экран — снимок бесполезен'); ошибок++ }
  }
  console.log(ошибок ? 'с замечаниями: ' + ошибок : 'все снимки сняты')
  app.exit(ошибок ? 1 : 0)
})
