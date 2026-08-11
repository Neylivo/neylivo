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
    <!-- Настоящая разметка панели профиля (MeBar.tsx). Раньше здесь стоял
         выдуманный .me-bar, которого в стилях нет вовсе, — стенд показывал не то,
         что рисует приложение. -->
    <div class="me"><span class="me-lift"><span class="av"></span></span>
      <span class="me-nm me-lift">nubas<br><small class="mut">В сети</small></span>
      <button class="me-ic me-music me-lift">♪</button>
      <button class="me-ic me-mic me-lift">M</button>
      <button class="me-ic me-deaf me-lift">H</button>
      <button class="me-out me-lift">⚙</button></div>
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
    <div class="me"><span class="me-lift"><span class="av"></span></span>
      <span class="me-nm me-lift">nubas<br><small class="mut">В сети</small></span>
      <button class="me-ic me-music me-lift">♪</button>
      <button class="me-ic me-mic me-lift">M</button>
      <button class="me-ic me-deaf me-lift">H</button>
      <button class="me-out me-lift">⚙</button></div>
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

// v1.540.0: витрина кнопок живёт в scripts/button-gallery.cjs — той же
// разметкой её меряет обход телефона (npm run test:mobile).
const { витрина } = require('./button-gallery.cjs')

// v1.539.0: раздел клипов — настройки и список записанного.
const КЛИПЫ = `<div class="app-viewport"><div class="pqs2" style="padding:24px;max-width:760px">
  <div class="clips-panel">
    <h2>Клипы с экрана</h2>
    <div class="pqs2-desc">Приложение всё время держит в памяти последние секунды экрана и никуда их не сохраняет.</div>
    <div class="clip-main">
      <div class="clip-toggle">
        <div><div class="clip-toggle-t">Держать последние секунды</div>
        <div class="clip-toggle-s">Идёт запись — сохранить можно в любой момент</div></div>
        <button class="pqs-toggle on"><span></span></button>
      </div>
      <label class="clip-lbl">Сколько секунд хранить</label>
      <div class="clip-range"><input type="range" min="5" max="180" step="5" value="30"><span class="clip-val">30 сек</span></div>
      <div class="clip-hint">От 5 секунд до 3 мин. Чем больше — тем больше памяти занято постоянно: примерно 18 МБ.</div>
      <label class="clip-lbl">Качество</label>
      <div class="clip-quality">
        <button class="clip-q"><span class="clip-q-n">Экономно</span><span class="clip-q-d">720p · 30 кадров</span><span class="clip-q-s">≈ 18 МБ за минуту</span></button>
        <button class="clip-q on"><span class="clip-q-n">Обычное</span><span class="clip-q-d">1080p · 30 кадров</span><span class="clip-q-s">≈ 37 МБ за минуту</span></button>
        <button class="clip-q"><span class="clip-q-n">Чётко</span><span class="clip-q-d">1080p · 60 кадров</span><span class="clip-q-s">≈ 60 МБ за минуту</span></button>
      </div>
      <div class="clip-actions">
        <button class="pqs2-btn primary">Сохранить последние 30 сек</button>
        <button class="pqs2-btn">Открыть папку</button>
      </div>
      <div class="clip-hint">Или нажми F7 — работает поверх игры, переключаться в Ponoi не надо.</div>
    </div>
    <div class="pqs-sec-t">Записанные клипы</div>
    <div class="clip-list">
      ${[['Half-Life 2 2026-08-11 11-23-07', '11 авг, 11:23 · 34,2 МБ'],
         ['Portal 2 2026-08-10 22-04-19', '10 авг, 22:04 · 12,8 МБ'],
         ['2026-08-09 18-40-02', '9 авг, 18:40 · 7,1 МБ']].map(([н, п]) => `
      <div class="clip-item">
        <button class="clip-item-main"><span class="clip-item-play">▶</span>
          <span class="clip-item-meta"><span class="clip-item-nm">${н}</span><span class="clip-item-sub">${п}</span></span>
        </button>
        <button class="pqs2-btn">П</button><button class="pqs2-btn danger">У</button>
      </div>`).join('')}
    </div>
  </div>
</div></div>`

// v1.542.0: вход по коду. Квадратик рисуется настоящим кодом — стенд читает ту
// же библиотеку, что и приложение, поэтому на снимке видно настоящий размер.
const КОД_ВХОДА = `<div class="auth2" style="background:#2b2d31">
  <div class="auth2-card">
    <div class="qr2">
      <button type="button" class="qr2-back">‹ Назад</button>
      <h1>Вход по коду</h1>
      <p class="auth2-sub">Открой Ponoi на телефоне, где ты уже вошёл, и наведи камеру</p>
      <div class="qr2-box"><canvas id="qr-here" class="qr2-canvas"></canvas></div>
      <div class="qr2-steps">
        <div class="qr2-step"><span>1</span> На телефоне: Настройки → Устройства и безопасность</div>
        <div class="qr2-step"><span>2</span> Нажми «Сканировать код входа»</div>
        <div class="qr2-step"><span>3</span> Подтверди, что это ты</div>
      </div>
      <div class="qr2-hint">Код обновится через 104 с — так его нельзя подсмотреть заранее.</div>
      <div class="auth2-legal">Пароль при этом не передаётся никуда. Телефон шифрует вход ключом,
        который нарисован в самом коде и не покидает этот компьютер.</div>
    </div>
  </div>
</div>`

const ВОПРОС = `<div class="modal-overlay"><div class="modal qrs">
  <button class="modal-x">×</button>
  <div class="qrs-ask-ico">◻</div>
  <div class="modal-title" style="margin:0">Впустить это устройство?</div>
  <div class="qrs-dev">Windows · приложение Ponoi</div>
  <div class="qrs-warn">Если это не ты сейчас открыл Ponoi на компьютере — нажми «Нет».
    Подтверждение впустит это устройство в твой аккаунт без пароля.</div>
  <div class="lyr-btns"><button class="pqs2-btn">Нет</button>
  <button class="pqs2-btn primary">Да, это я</button></div>
</div></div>`

const ЭКРАНЫ = [
  // Настоящий экран входа, без подмены разметки: это первое, что видит
  // человек, и общий вид кнопки задевает его в первую очередь.
  { имя: 'вход-1000', html: null, ш: 1000, в: 800 },
  { имя: 'сервер-1440', html: СЕРВЕР(false), ш: 1440, в: 900 },
  { имя: 'друзья-1440', html: ДРУЗЬЯ, ш: 1440, в: 900 },
  { имя: 'сервер-412', html: СЕРВЕР(true), ш: 412, в: 860 },
  { имя: 'кнопки-1000', html: витрина(), ш: 1000, в: 900 },
  { имя: 'вход-по-коду', html: КОД_ВХОДА, ш: 900, в: 820 },
  { имя: 'вопрос-на-телефоне', html: ВОПРОС, ш: 412, в: 760 },{ имя: 'кнопки-412', html: витрина(), ш: 412, в: 900 },
  { имя: 'клипы-1000', html: КЛИПЫ, ш: 1000, в: 980 },
  { имя: 'клип-окно', html: `<div class="modal-overlay"><div class="modal clip-view">
      <button class="modal-x">×</button>
      <div class="modal-title" style="margin:0">Half-Life 2 2026-08-11 11-23-07</div>
      <video class="clip-video" controls></video>
      <div class="lyr-btns"><button class="pqs2-btn">Показать в папке</button>
      <button class="pqs2-btn ghost">Закрыть</button></div>
    </div></div>`, ш: 1000, в: 700 },
  { имя: 'клипы-412', html: КЛИПЫ, ш: 412, в: 900 },
]

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: 20, y: 20, width: 1440, height: 900,
    backgroundColor: '#313338',
    // nodeIntegration нужен только затем, чтобы стенд мог нарисовать настоящий
    // QR той же библиотекой, что и приложение.
    webPreferences: { backgroundThrottling: false, nodeIntegration: true, contextIsolation: false } })
  await win.loadFile(DIST)
  await new Promise(r => setTimeout(r, 700))

  for (const э of ЭКРАНЫ) {
    win.setContentSize(э.ш, э.в)
    await new Promise(r => setTimeout(r, 350))
    await win.webContents.executeJavaScript(`(() => {
      if (${JSON.stringify(э.html !== null)}) {
        document.body.className = ''
        document.body.innerHTML = ${JSON.stringify(э.html || '')}
      }
      // Настоящее приложение живёт в #root на всю высоту окна. При подмене
      // разметки этого не остаётся, и всё съезжает наверх — сужденное по такому
      // снимку было бы суждением о стенде, а не о приложении.
      const s = document.createElement('style')
      s.textContent = 'html,body{height:100%;margin:0} .app-viewport{height:100%}'
        // Колонки на всю высоту: иначе панель профиля висит посередине
        // экрана, и о нижней кромке по снимку судить нельзя.
        + ' .app{height:100%} .channels,.servers,.dm-side,.chat{height:100%}'
        + ' .ch-list,.dm-list,.msgs{flex:1} .me{margin-top:auto}'
        + ' .av{width:40px;height:40px;border-radius:50%;background:#5865f2;display:inline-block;flex:none}'
        + ' .member .av,.dm-item .av,.pfr-row .av{width:32px;height:32px}'
        + ' .me-av{width:32px;height:32px;border-radius:50%;background:#3ba55d;display:inline-block}'
      document.head.appendChild(s)
    })()`)
    // Настоящий QR: пустой холст на снимке ничего бы не сказал о размере.
    await win.webContents.executeJavaScript(`(() => {
      const c = document.getElementById('qr-here')
      if (!c) return
      const qr = require(${JSON.stringify('qrcode-generator')})
      const т = qr(0, 'M')
      т.addData('PONOI1:' + 'A'.repeat(26) + ':' + 'B'.repeat(104), 'Alphanumeric')
      т.make()
      const n = т.getModuleCount(), поле = 4
      const пиксель = Math.max(2, Math.floor(240 / (n + поле * 2)))
      const сторона = (n + поле * 2) * пиксель
      c.width = сторона; c.height = сторона
      const g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, сторона, сторона)
      g.fillStyle = '#000'
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
        if (т.isDark(r, k)) g.fillRect((k + поле) * пиксель, (r + поле) * пиксель, пиксель, пиксель)
      }
    })()`).catch(() => {})
    await new Promise(r => setTimeout(r, 450))
    const к = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, э.имя + '.png'), к.toPNG())
    console.log('снято: ' + э.имя + '.png')
  }
  process.exit(0)
})
