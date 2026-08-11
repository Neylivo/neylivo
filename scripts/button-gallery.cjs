// Витрина кнопок: вся семья разом, одной разметкой.
//
// Владелец: «вместо сотен разных кнопок делать легче». Кнопки живут в 92
// компонентах, и разнобой виден только когда они стоят рядом. Здесь они стоят
// рядом — и этим пользуются двое: npm run look снимает их глазами, а
// npm run test:mobile меряет на телефоне, влезает ли по ним палец.
//
// Почему разметка одна на двоих. Разъехавшиеся копии — это стенд, который
// проверяет не то, что показывает. Один список, два потребителя.
//
// В кнопках-значках нарочно стоят короткие символы, а не слова: у них
// фиксированная ширина под значок, и подпись «Скачать» вылезала бы наружу —
// стенд показывал бы поломку, которой в приложении нет.
const РЯД = (имя, что) => `<div class="look-row"><div class="look-lbl">${имя}</div>
  <div class="look-btns">${что}</div></div>`

const СТИЛЬ = `<style>
  .look-row { display:flex; align-items:center; gap:16px; padding:10px 0; border-bottom:1px solid rgba(var(--ov,255,255,255),.06); }
  .look-lbl { width:190px; flex:none; color:var(--mut); font-size:12px; }
  .look-btns { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  @media (max-width: 700px) { .look-row { flex-direction:column; align-items:stretch; gap:6px; } .look-lbl { width:auto; } }
</style>`

const РЯДЫ = [
  ['обычная в окне', '<button class="pqs2-btn">Сохранить</button><button class="pqs2-btn primary">Главная</button><button class="pqs2-btn ghost">Тихая</button><button class="pqs2-btn danger">Опасная</button>'],
  ['над сообщением', '<div class="msg-tools" style="opacity:1;position:static"><button>+</button><button>↩</button><button>…</button></div>'],
  ['в поле ввода', '<button class="attach-btn">+</button><button class="ctool">☺</button>'],
  // Значки шапки стоят в своей шапке: у них margin-left:auto, и вне её они
  // разлетаются по краям — это была бы поломка стенда, а не приложения.
  ['шапка канала', '<header class="chat-head" style="width:280px"><span class="ch-title"># общий</span><button class="pin-btn">з</button><button class="call-start">п</button><button class="srv-invite">и</button></header>'],
  ['вкладки друзей', '<div class="pfr-tabs"><button class="pfr-tab on">В сети</button><button class="pfr-tab">Все</button><button class="pfr-tab">Заявки</button></div>'],
  ['плеер', '<div class="mus2-topr"><button>◀</button><button>▶</button></div><button class="mus2-libbtn">Моё</button><button class="mus2-addbtn">+</button>'],
  ['голосовая панель', '<div class="vp-btns"><button class="vp-btn">М</button><button class="vp-btn danger">×</button><button class="vp-act">…</button></div>'],
  ['карточка файла', '<button class="fcard-btn">↓</button><button class="fcard-btn">…</button>'],
  ['настройки', '<button class="pqs-seg-btn on">Слева</button><button class="pqs-seg-btn">Справа</button><button class="pqs-font-btn">Системный</button><button class="pqs-font-btn on">Inter</button>'],
  ['плагины', '<div class="plug-actions"><button>Открыть</button><button>Настроить</button><button>Убрать</button></div>'],
  // Кнопки входа стоят в своей карточке: она тёмная в любой теме, и вне её
  // белая подпись выглядела бы нечитаемой там, где в приложении всё в порядке.
  ['вход', '<div class="auth2-card" style="padding:16px"><button class="auth2-btn">Войти</button><button class="auth2-btn ghost">Отмена</button></div>'],
  ['меню правой кнопкой', '<div class="ctx-quick"><button>+</button><button>↩</button><button>…</button></div>'],
  ['выбор в настройках', '<button class="cset-chc-btn">Не выбрано</button><button class="cset-chc-btn on">Выбрано</button>'],
  ['качество клипа', '<button class="clip-q"><span class="clip-q-n">Экономно</span><span class="clip-q-s">≈ 18 МБ</span></button><button class="clip-q on"><span class="clip-q-n">Обычное</span><span class="clip-q-s">≈ 37 МБ</span></button>'],
]

/** Готовая страница витрины. */
function витрина() {
  return `<div class="app-viewport"><div style="padding:20px;overflow:auto;height:100%">
    ${СТИЛЬ}${РЯДЫ.map(([и, ч]) => РЯД(и, ч)).join('')}
  </div></div>`
}

module.exports = { витрина }
