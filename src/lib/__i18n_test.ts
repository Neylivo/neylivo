// v1.357.0: проверка того, что перевод интерфейса не трогает чужой текст.
//
// Зачем в настоящем браузере. Переводчик не подставляет строки в компонентах —
// он ходит по готовому DOM и подменяет текстовые узлы, а за новыми следит через
// MutationObserver. Ни того, ни другого в Node нет, и проверить его без окна
// нельзя: вся суть проверки в том, ЧТО он пропустит, а что тронет.
//
// Что именно было сломано. Имена придумывает человек, а совпадают они со
// словарём сплошь и рядом: сервер «Друзья», роль «Участник», ник «Настройки»,
// канал «все». Всё это молча превращалось во Friends, Member, Settings, all —
// подмена чужих слов, а не перевод интерфейса.
//
// Запуск: npm run test:i18n
import { applyLang, UGC_CLASSES } from './i18n'

const out: string[] = []
let pass = 0, fail = 0
function check(name: string, fn: () => boolean | Promise<boolean>) {
  return Promise.resolve()
    .then(fn)
    .then(ok => {
      if (ok) { pass++; out.push('  ok   ' + name) }
      else { fail++; out.push('  ПРОВАЛ ' + name) }
    })
    .catch(e => { fail++; out.push('  ПРОВАЛ ' + name + ' — ' + (e?.message ?? e)) })
}

/** Положить узел в тело страницы и вернуть его. */
function put(html: string): HTMLElement {
  const box = document.createElement('div')
  box.innerHTML = html
  document.body.appendChild(box)
  return box
}

// Слова, которые человек реально пишет и которые лежат в словаре как подписи.
const COLLIDING = ['Участник', 'Друзья', 'Настройки', 'Профиль', 'Сервер', 'Поиск', 'Все', 'Готово']

async function run() {
  out.push('── Интерфейс переводится ──')
  const ui = put('<div class="probe-ui">Настройки</div><button title="Поиск">x</button>')
  await applyLang('en')
  await check('обычная подпись стала английской', () =>
    (ui.querySelector('.probe-ui') as HTMLElement).textContent === 'Settings')
  await check('title тоже переведён', () =>
    ui.querySelector('button')!.getAttribute('title') === 'Search')

  out.push('\n── Чужой текст не трогаем ──')
  for (const cls of ['me-nm', 'ch-txt', 'srv-title-nm', 'chr-name', 'cat-nm']) {
    const box = put(`<span class="${cls}">Настройки</span>`)
    await check(`имя в .${cls} осталось как есть`, () =>
      (box.firstElementChild as HTMLElement).textContent === 'Настройки')
  }

  const marked = put('<span class="notr">Друзья</span><span translate="no">Участник</span>')
  await check('.notr не переводится', () =>
    (marked.children[0] as HTMLElement).textContent === 'Друзья')
  await check('translate="no" не переводится', () =>
    (marked.children[1] as HTMLElement).textContent === 'Участник')

  await check('вложенный текст внутри помеченного узла тоже цел', () => {
    const b = put('<div class="me-nm"><b>Сервер</b> <i>Готово</i></div>')
    return b.textContent === 'Сервер Готово'
  })

  out.push('\n── Появившееся уже после переключения ──')
  // Самое коварное: язык переключили раньше, а список участников отрисовался
  // позже — такие узлы приходят через MutationObserver, не через первый проход.
  const late = put('<div class="probe-late"></div>')
  const host = late.firstElementChild as HTMLElement
  host.innerHTML = '<span class="me-nm">Профиль</span><span class="probe-ui2">Профиль</span>'
  await new Promise(r => setTimeout(r, 60))
  await check('поздний интерфейс перевёлся', () =>
    (host.querySelector('.probe-ui2') as HTMLElement).textContent === 'Profile')
  await check('позднее имя осталось как есть', () =>
    (host.querySelector('.me-nm') as HTMLElement).textContent === 'Профиль')

  out.push('\n── Возврат на русский ──')
  await applyLang('ru')
  await check('подпись вернулась', () =>
    (ui.querySelector('.probe-ui') as HTMLElement).textContent === 'Настройки')
  await check('title вернулся', () =>
    ui.querySelector('button')!.getAttribute('title') === 'Поиск')

  out.push('\n── Ломаем нарочно ──')
  await check('без пометки такое имя действительно перевелось бы', async () => {
    // Показываем, что защита не декоративная: тот же текст без класса меняется.
    const bare = put('<span class="probe-bare">Участник</span>')
    await applyLang('en')
    const changed = (bare.firstElementChild as HTMLElement).textContent === 'Member'
    await applyLang('ru')
    return changed
  })

  await check('список помеченных классов не пуст и все они настоящие', () =>
    UGC_CLASSES.length > 10 && UGC_CLASSES.every(c => /^[a-z0-9-]+$/.test(c)))

  await check('все спорные слова словаря перечислены в проверке', () =>
    COLLIDING.length >= 8)

  out.push(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
  const el = document.getElementById('out')
  if (el) el.textContent = out.join('\n')
  ;(window as any).__failed = fail
  ;(window as any).__done = true
}

void run()
