// Экраны приложения одной разметкой — на всех, кому она нужна.
//
// Ими пользуются двое: npm run look снимает их глазами, npm run test:contrast
// меряет на них читаемость на обеих темах. Разъехавшиеся копии разметки — это
// стенд, который проверяет не то, что показывает; здесь источник один.
//
// Разметка списана с настоящих компонентов. Где она врала (выдуманный класс
// .me-bar, которого нет в стилях вовсе), это уже находилось и правилось.
const { витрина } = require('./button-gallery.cjs')

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

const ОКНО_КЛИПА = `<div class="modal-overlay"><div class="modal clip-view">
      <button class="modal-x">×</button>
      <div class="modal-title" style="margin:0">Half-Life 2 2026-08-11 11-23-07</div>
      <video class="clip-video" controls></video>
      <div class="lyr-btns"><button class="pqs2-btn">Показать в папке</button>
      <button class="pqs2-btn ghost">Закрыть</button></div>
    </div></div>`


// Ещё четыре поверхности — те, где человек проводит больше всего времени после
// переписки. Классы списаны с настоящих компонентов (Settings.tsx, DmCtxMenu.tsx,
// MusicPlayer.tsx): выдуманные проверяли бы моё представление о разметке.
const НАСТРОЙКИ = `<div class="app-viewport"><div class="pqs2">
  <aside class="pqs2-side">
    <div class="pqs2-side-h">НАСТРОЙКИ</div>
    <div class="pqs2-item on">Моя учётная запись</div>
    <div class="pqs2-item">Внешний вид</div>
    <div class="pqs2-item">Устройства и безопасность</div>
  </aside>
  <main class="pqs2-main">
    <h2>Внешний вид</h2>
    <div class="pqs2-desc">Как выглядит приложение: тема, скругления, размер текста.</div>
    <div class="pqs-sec-t">ТЕМА</div>
    <div class="pqs2-row"><span class="pqs2-row-k">Тема оформления</span>
      <span class="pqs-seg"><button class="pqs-seg-btn on">Тёмная</button><button class="pqs-seg-btn">Светлая</button></span></div>
    <div class="pqs2-optrow"><div><div class="pqs-optt">Компактный вид</div>
      <div class="pqs-optd">Сообщения идут плотнее, без отступов между ними.</div></div>
      <button class="pqs-toggle on"><span></span></button></div>
    <label class="pqs-in-l">Ваше имя</label>
    <input class="pqs-in" value="nubas">
    <div class="lyr-btns"><button class="pqs2-btn ghost">Отмена</button><button class="pqs-save">Сохранить</button></div>
  </main>
</div></div>`

const МЕНЮ = `<div class="app-viewport" style="padding:24px">
  <div class="ctxmenu" style="position:static;width:240px">
    <div class="ctx-item">Ответить</div>
    <div class="ctx-item has-sub">Реакция</div>
    <div class="ctx-item">Копировать текст</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger">Удалить сообщение</div>
    <div class="ctx-idbadge">ID: 8f2c…</div>
  </div>
</div>`

const ОКНО = `<div class="modal-overlay"><div class="modal">
  <div class="modal-title">Создать канал</div>
  <div class="modal-sub">Каналы — это комнаты для разговоров по темам.</div>
  <label class="ms-in-l">Название</label>
  <input class="ms-in" value="общий">
  <div class="lyr-btns"><button class="pqs2-btn ghost">Отмена</button>
  <button class="pqs2-btn primary">Создать</button></div>
</div></div>`

const ПЛЕЕР = `<div class="app-viewport"><div class="mus2">
  <div class="mus2-top"><div class="mus2-topr"><button>◀</button><button>▶</button></div>
    <button class="mus2-libbtn">Моя музыка</button></div>
  <div class="mus2-nowt">Название трека</div>
  <div class="mus2-nowa">Исполнитель</div>
  <div class="mus2-li"><span class="mus2-li-nm">Первый трек</span><span class="mus2-li-a">Кто-то</span></div>
  <div class="mus2-li on"><span class="mus2-li-nm">Второй трек</span><span class="mus2-li-a">Ещё кто-то</span></div>
</div></div>`

/** Все экраны: имя, разметка и удобный размер окна. */
function экраны() {
  return [
    { имя: 'сервер', html: СЕРВЕР(false), ш: 1440, в: 900 },
    { имя: 'друзья', html: ДРУЗЬЯ, ш: 1440, в: 900 },
    { имя: 'сервер на телефоне', html: СЕРВЕР(true), ш: 412, в: 860 },
    { имя: 'витрина кнопок', html: витрина(), ш: 1000, в: 900 },
    { имя: 'витрина кнопок на телефоне', html: витрина(), ш: 412, в: 900 },
    { имя: 'вход по коду', html: КОД_ВХОДА, ш: 900, в: 820 },
    { имя: 'вопрос на телефоне', html: ВОПРОС, ш: 412, в: 760 },
    { имя: 'клипы', html: КЛИПЫ, ш: 1000, в: 980 },
    { имя: 'клип в окне', html: ОКНО_КЛИПА, ш: 1000, в: 700 },
    { имя: 'настройки', html: НАСТРОЙКИ, ш: 1100, в: 820 },
    { имя: 'меню', html: МЕНЮ, ш: 500, в: 400 },
    { имя: 'окно', html: ОКНО, ш: 700, в: 500 },
    { имя: 'плеер', html: ПЛЕЕР, ш: 900, в: 700 },
  ]
}

module.exports = { экраны, СЕРВЕР, ДРУЗЬЯ, КЛИПЫ, КОД_ВХОДА, ВОПРОС, ОКНО_КЛИПА,
  НАСТРОЙКИ, МЕНЮ, ОКНО, ПЛЕЕР, витрина }
