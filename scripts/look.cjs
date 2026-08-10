// Снимки настоящих экранов приложения. Запуск: npm run look
//
// Зачем. Про вид нельзя рассуждать по исходнику: «красиво» и «удобно» видно
// только глазами, и только на настоящих стилях. Этот стенд поднимает собранное
// приложение (dist), подставляет разметку главных экранов — ровно ту, что
// рисуют компоненты, — и складывает снимки в dist-look/.
//
// Это не проверка: она ничего не утверждает и никогда не падает. Это глаза.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const DIST = path.join(__dirname, '..', 'dist', 'index.html')
const OUT = path.join(__dirname, '..', 'dist-look')
fs.mkdirSync(OUT, { recursive: true })

const СЕРВЕР = (узкий) => `<div class="app-viewport"><div class="app">
  <nav class="servers">
    <div class="srv-wrap on"><button class="srv has-avatar on">П</button></div>
    <div class="srv-wrap"><button class="srv">Д</button></div>
    <div class="srv-wrap"><button class="srv">М</button></div>
    <div class="srv-sep"></div>
    <div class="srv-wrap"><button class="srv srv-add">+</button></div>
  </nav>
  <aside class="channels">
    <div class="ch-head"><span class="ch-head-nm">Мой сервер</span></div>
    <div class="ch-cat">ТЕКСТОВЫЕ КАНАЛЫ</div>
    <div class="ch on"># общий</div>
    <div class="ch"># новости</div>
    <div class="ch"># мемы</div>
    <div class="ch-cat">ГОЛОСОВЫЕ</div>
    <div class="ch">Общая</div>
    <div class="me-bar"><span class="me-av"></span><span class="me-nm">nubas</span><button class="me-ic">M</button><button class="me-ic">S</button></div>
  </aside>
  <main class="chat">
    <header class="chat-head">${узкий ? '<button class="mob-burger">≡</button>' : ''}<span class="ch-title"># общий</span></header>
    <div class="msgs">
      ${[['Ваня', 'Привет! Как дела с новой версией?'], ['nubas', 'Собрал, сейчас проверю на телефоне'],
         ['Ваня', 'Скинь потом снимок, интересно посмотреть на новый вид']].map(([кто, что]) => `
      <div class="msg"><div class="msg-gutter"><span class="av-click"><span class="av"></span></span></div>
        <div class="msg-body"><div class="msg-hdr"><span class="nm">${кто}</span><span class="msg-time">14:32</span></div>
        <div class="msg-text">${что}</div></div></div>`).join('')}
    </div>
    <form class="composer cstyle-default">
      <div class="plus-wrap"><button type="button" class="attach-btn">+</button></div>
      <div class="composer-field"><textarea rows="1" placeholder="Написать в #общий"></textarea>
        ${узкий ? '<button type="button" class="cin-emoji">☺</button>' : ''}</div>
      <div class="composer-tools">${узкий ? '' : '<button class="ctool">☺</button><button class="ctool">GIF</button><button class="ctool">🎤</button>'}</div>
      <div class="cin-act"><button class="cin-mic">◍</button><button type="submit" class="send-tg">➤</button></div>
    </form>
  </main>
  ${узкий ? '' : `<aside class="members"><div class="mem-cat">В СЕТИ — 2</div>
    <div class="member"><span class="av"></span><span class="member-nm">Ваня</span></div>
    <div class="member"><span class="av"></span><span class="member-nm">nubas</span></div></aside>`}
</div></div>`

const ДРУЗЬЯ = `<div class="app-viewport"><div class="app">
  <nav class="servers"><div class="srv-wrap on"><button class="srv has-avatar on">П</button></div></nav>
  <aside class="dm-side">
    <div class="dm-top"><button class="dm-findbtn">Найти беседу</button></div>
    <div class="dm-navitem on">Друзья</div>
    <div class="dm-cat">ЛИЧНЫЕ СООБЩЕНИЯ</div>
    <div class="dm-item"><span class="av"></span><span class="dm-nm">Ваня</span></div>
    <div class="dm-item on"><span class="av"></span><span class="dm-nm">Маша</span></div>
  </aside>
  <main class="chat pfr-chat">
    <header class="chat-head pfr-head"><span class="pfr-title">Друзья</span>
      <div class="pfr-tabs"><button class="pfr-tab on">В сети</button><button class="pfr-tab">Все</button><button class="pfr-tab">Заявки</button></div>
      <button class="pfr-addfriend">Добавить в друзья</button></header>
    <div class="pfr-main"><div class="pfr-list">
      <div class="pfr-row"><span class="av"></span><span class="pfr-nm">Ваня</span><span class="pfr-sub">в сети</span></div>
      <div class="pfr-row"><span class="av"></span><span class="pfr-nm">Маша</span><span class="pfr-sub">играет в Dying Light</span></div>
    </div></div>
  </main>
</div></div>`

const ЭКРАНЫ = [
  { имя: 'сервер-1440', html: СЕРВЕР(false), ш: 1440, в: 900 },
  { имя: 'друзья-1440', html: ДРУЗЬЯ, ш: 1440, в: 900 },
  { имя: 'сервер-412', html: СЕРВЕР(true), ш: 412, в: 860 },
]

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1440, height: 900,
    backgroundColor: '#313338', webPreferences: { backgroundThrottling: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))

  for (const э of ЭКРАНЫ) {
    win.setContentSize(э.ш, э.в)
    await new Promise(r => setTimeout(r, 350))
    await win.webContents.executeJavaScript(`(() => {
      document.body.className = ''
      document.body.innerHTML = ${JSON.stringify(э.html)}
      // Настоящее приложение живёт в #root на всю высоту окна. При подмене
      // разметки этого не остаётся, и всё съезжает наверх — сужденное по такому
      // снимку было бы суждением о стенде, а не о приложении.
      const s = document.createElement('style')
      s.textContent = 'html,body{height:100%;margin:0} .app-viewport{height:100%}'
        + ' .av{width:40px;height:40px;border-radius:50%;background:#5865f2;display:inline-block;flex:none}'
        + ' .member .av,.dm-item .av,.pfr-row .av{width:32px;height:32px}'
        + ' .me-av{width:32px;height:32px;border-radius:50%;background:#3ba55d;display:inline-block}'
      document.head.appendChild(s)
    })()`)
    await new Promise(r => setTimeout(r, 450))
    const к = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, э.имя + '.png'), к.toPNG())
    console.log('снято: ' + э.имя + '.png')
  }
  process.exit(0)
})
