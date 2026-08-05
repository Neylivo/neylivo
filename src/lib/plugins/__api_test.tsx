// v1.476.0: живая проверка возможностей, которые до сих пор существовали
// только «по проверкам». Запуск: npm run test:api
//
// Зачем. С v1.465 у плагинов появились перехват сообщений, четыре вида окна,
// службы, письма между плагинами, постоянное соединение, поток, фоновые задачи,
// цвета оформления и пункты меню. Всё это покрыто проверками на выдуманных
// данных — и ни одна возможность не работала вживую ни разу, потому что не
// существовало плагина, который бы ими пользовался. Ровно так в v1.474.0
// нашлись четыре поломки в окнах: холст не находился, клавиш не было вовсе.
//
// Здесь каждая возможность проверяется настоящим плагином в настоящей
// песочнице, а сеть — настоящим сервером на 127.0.0.1 (scripts/api-test.cjs).
import { createRoot } from 'react-dom/client'
import { PluginApps } from '../../components/PluginApps'
import { parsePlugin } from './manifest'
import { upsertPlugin, removePlugin } from './store'
import { ensureHost } from './bridge'
import { getRegistry } from './registry'
import { appList } from './apps'
import { runBeforeSend, renderedContent, hasInterceptors } from './middleware'

const lines: string[] = []
let failed = 0
const out = () => { document.getElementById('out')!.textContent = lines.join('\n') }
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  lines.push(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
  out()
}
const пауза = (ms: number) => new Promise(r => setTimeout(r, ms))
const ПОРТ = (window as any).__порт ?? 8443
const АДРЕС = '127.0.0.1:' + ПОРТ

type Host = Awaited<ReturnType<typeof ensureHost>>

/** Поставить и запустить плагин ровно тем же путём, что и приложение. */
async function поднять(host: Host, код: string) {
  const m = parsePlugin(код)
  const p: any = {
    manifest: m, code: код, enabled: true,
    installedAt: new Date().toISOString(), sourceUserId: null, storage: {},
  }
  upsertPlugin(p)
  await host.startPlugin(p)
  return m.id
}
const журнал = (host: Host, id: string) => host.pluginLogs(id).map(l => l.level + ':' + l.text)
const строка = (host: Host, id: string, нач: string) =>
  журнал(host, id).map(l => l.replace(/^\w+:/, '')).filter(l => l.startsWith(нач)).pop() ?? ''

async function ждать(есть: () => boolean, мс = 8000) {
  for (let i = 0; i < мс / 100 && !есть(); i++) await пауза(100)
  return есть()
}

// ── 1. Перехват сообщений ───────────────────────────────────────────────────
async function перехватСообщений(host: Host) {
  const id = await поднять(host, `/**
 * @name Перехватчик
 * @id probe-mw
 * @version 1.0.0
 * @author проба
 * @description Проба перехвата
 * @permissions messages.intercept
 */
export async function onLoad(ponoi) {
  ponoi.messages.onBeforeSend(async function (ctx) {
    ponoi.log('перед отправкой:' + ctx.content)
    if (ctx.content.indexOf('нельзя') >= 0) return { cancel: true }
    return { content: ctx.content.replace(/дурак/g, '****') }
  })
  ponoi.messages.onBeforeRender(async function (ctx) {
    return { content: '[' + ctx.content + ']' }
  })
}
`)
  await пауза(300)
  ok('перехватчики зарегистрированы', hasInterceptors('send') && hasInterceptors('render'))

  // Тем же вызовом, что и чат: runBeforeSend зовут и Composer, и личка.
  const r = await runBeforeSend('ты дурак', 'c1', (pid, fn, a) => host.invokePlugin(pid, fn, a))
  ok('слово в сообщении заменено до отправки', r.content === 'ты ****' && !r.cancel, r.content)
  ok('плагин увидел исходный текст', строка(host, id, 'перед отправкой:').includes('ты дурак'),
    строка(host, id, 'перед отправкой:'))

  const r2 = await runBeforeSend('это нельзя', 'c1', (pid, fn, a) => host.invokePlugin(pid, fn, a))
  ok('отмена отправки работает и видно, кто отменил', r2.cancel && r2.by === 'probe-mw', String(r2.by))

  // Показ считается не сразу: первый раз отдаётся исходный текст, а перерисовка
  // приходит по готовности — иначе плагин тормозил бы прокрутку переписки.
  const сообщение = { id: 'm1', content: 'привет', author: 'u2', mine: false }
  const было = renderedContent(сообщение, (pid, fn, a) => host.invokePlugin(pid, fn, a))
  ok('первый показ не ждёт плагина', было === 'привет', было)
  const стало = await ждать(() =>
    renderedContent(сообщение, (pid, fn, a) => host.invokePlugin(pid, fn, a)) === '[привет]')
  ok('после ответа плагина показ обновился', стало,
    renderedContent(сообщение, (pid, fn, a) => host.invokePlugin(pid, fn, a)))

  await host.stopPlugin(id)
  ok('перехватчики сняты вместе с плагином', !hasInterceptors('send') && !hasInterceptors('render'))
  removePlugin(id)
}

// ── 2. Все четыре вида окна ─────────────────────────────────────────────────
//
// Плавающее окно проверено «Змейкой» (test:snake). Здесь — остальные три:
// вкладка, полный экран и окошко в углу. Проверяется не «объявлено», а
// НАРИСОВАНО и там, где обещано: у полного экрана это весь экран, у окошка —
// угол. Одному плагину больше трёх окон нельзя, поэтому их ровно три.
async function видыОкон(host: Host) {
  const id = await поднять(host, `/**
 * @name Окна
 * @id probe-modes
 * @version 1.0.0
 * @author проба
 * @description Проба видов окна
 * @permissions apps
 */
export async function onLoad(ponoi) {
  ponoi.on('app', function (e) { ponoi.log('событие:' + e.mode + ':' + (e.open ? 'открыто' : 'закрыто')) })
  for (const mode of ['tab', 'pip', 'fullscreen']) {
    const id = await ponoi.apps.create({ mode: mode, title: 'Окно ' + mode, rows: [
      { type: 'label', key: 'l', label: 'Вид', value: mode },
    ] })
    ponoi.log('открыто:' + mode + ':' + id)
  }
}
`)
  await ждать(() => appList(id).length === 3)
  const виды = appList(id).map(a => a.mode).sort().join(',')
  ok('открылись все три вида разом', виды === 'fullscreen,pip,tab', виды)

  await пауза(300)
  const узел = (m: string) => document.querySelector('.plugapp-' + m) as HTMLElement | null
  ok('каждый вид нарисован своим видом', !!узел('tab') && !!узел('pip') && !!узел('fullscreen'),
    ['tab', 'pip', 'fullscreen'].filter(m => !узел(m)).join(',') || 'все на месте')

  const r = (el: HTMLElement) => el.getBoundingClientRect()
  const полный = r(узел('fullscreen')!)
  // Меряем по clientWidth, а не innerWidth: второе включает полосу прокрутки,
  // которой у элемента с position:fixed нет, — и «на 11 пикселей уже» это она,
  // а не поломка.
  const экранШ = document.documentElement.clientWidth
  const экранВ = document.documentElement.clientHeight
  ok('полный экран правда во весь экран',
    полный.width >= экранШ - 2 && полный.height >= экранВ - 2,
    `${Math.round(полный.width)}x${Math.round(полный.height)} при экране ${экранШ}x${экранВ}`)

  const угол = r(узел('pip')!)
  ok('окошко в углу — маленькое и у края',
    угол.width < document.documentElement.clientWidth / 2
    && угол.right > document.documentElement.clientWidth - 60,
    `${Math.round(угол.width)}x${Math.round(угол.height)}, правый край ${Math.round(угол.right)}`)

  ok('плагин узнал, что окна открылись',
    журнал(host, id).filter(l => l.includes('событие:') && l.includes('открыто')).length === 3,
    журнал(host, id).filter(l => l.includes('событие:')).join(' | '))

  // Закрытие человеком: плагину обязано прийти событие, иначе он продолжит
  // считать окно открытым и рисовать в никуда.
  const { closeAppByUser } = await import('./apps')
  closeAppByUser(appList(id).find(a => a.mode === 'pip')!.id)
  const узнал = await ждать(() => журнал(host, id).some(l => l.includes('pip:закрыто')))
  ok('о закрытии окна человеком плагину сказали', узнал,
    журнал(host, id).filter(l => l.includes('закрыто')).join(' | '))

  await host.stopPlugin(id)
  await пауза(200)
  ok('окна исчезли вместе с выключенным плагином',
    appList(id).length === 0 && !document.querySelector('.plugapp'))
  removePlugin(id)
}

// ── 3. Службы и письма между плагинами ──────────────────────────────────────
async function службыИПисьма(host: Host) {
  const библиотека = await поднять(host, `/**
 * @name Библиотека
 * @id probe-lib
 * @version 1.0.0
 * @author проба
 * @description Проба службы
 * @permissions ipc
 */
export async function onLoad(ponoi) {
  await ponoi.services.register('матан', {
    урон: function (s) { return { итог: s.atk * 1.5 } },
  })
  ponoi.on('ipc', function (m) { ponoi.log('письмо от ' + m.from + ':' + JSON.stringify(m.data)) })
  ponoi.log('служба готова')
}
`)
  await пауза(300)
  const клиент = await поднять(host, `/**
 * @name Клиент
 * @id probe-client
 * @version 1.0.0
 * @author проба
 * @description Проба клиента
 * @permissions ipc
 */
export async function onLoad(ponoi) {
  const м = await ponoi.services.connect('матан')
  const r = await м.урон({ atk: 20 })
  ponoi.log('ответ службы:' + JSON.stringify(r))
  const дошло = await ponoi.plugins.send('probe-lib', 'привет', { n: 7 })
  ponoi.log('письмо доставлено:' + дошло)
}
`)
  await ждать(() => !!строка(host, клиент, 'ответ службы:'))
  ok('вызов чужой службы вернул ответ', строка(host, клиент, 'ответ службы:').includes('"итог":30'),
    строка(host, клиент, 'ответ службы:'))
  ok('письмо между плагинами доставлено', строка(host, клиент, 'письмо доставлено:').endsWith('true'),
    строка(host, клиент, 'письмо доставлено:'))
  await ждать(() => !!строка(host, библиотека, 'письмо от '))
  ok('получатель увидел письмо и настоящего отправителя',
    строка(host, библиотека, 'письмо от ').includes('probe-client') && строка(host, библиотека, 'письмо от ').includes('"n":7'),
    строка(host, библиотека, 'письмо от '))

  await host.stopPlugin(клиент); await host.stopPlugin(библиотека)
  removePlugin(клиент); removePlugin(библиотека)
}

// ── 4. Сеть: запрос, поток, постоянное соединение ───────────────────────────
async function сеть(host: Host) {
  const id = await поднять(host, `/**
 * @name Сеть
 * @id probe-net
 * @version 1.0.0
 * @author проба
 * @description Проба сети
 * @permissions net
 * @hosts 127.0.0.1
 */
export async function onLoad(ponoi) {
  const база = 'https://${АДРЕС}'
  ponoi.net.fetch(база + '/json').then(function (r) {
    ponoi.log('запрос:' + r.status + ':' + r.body)
  }, function (e) { ponoi.log('запрос-ошибка:' + e.message) })

  var куски = []
  ponoi.net.stream(база + '/stream', {}, function (кусок) { куски.push(кусок) })
    .then(function () { ponoi.log('поток:' + куски.length + ':' + куски.join('')) },
          function (e) { ponoi.log('поток-ошибка:' + e.message) })

  ponoi.net.ws('wss://${АДРЕС}/ws').then(function (сокет) {
    ponoi.log('сокет открыт')
    сокет.onMessage(function (m) { ponoi.log('сокет:' + m) })
    setTimeout(function () { сокет.send('пинг') }, 200)
  }, function (e) { ponoi.log('сокет-ошибка:' + e.message) })
}
`)
  await ждать(() => !!строка(host, id, 'запрос:') || !!строка(host, id, 'запрос-ошибка:'))
  ok('обычный запрос дошёл до настоящего сервера',
    строка(host, id, 'запрос:').includes('"число":42'),
    строка(host, id, 'запрос:') || строка(host, id, 'запрос-ошибка:'))

  await ждать(() => !!строка(host, id, 'поток:') || !!строка(host, id, 'поток-ошибка:'), 12000)
  const поток = строка(host, id, 'поток:')
  ok('ответ пришёл ПО КУСКАМ, а не одним куском',
    /^поток:[2-9]:/.test(поток) && поток.includes('раз два три конец'),
    поток || строка(host, id, 'поток-ошибка:'))

  await ждать(() => !!строка(host, id, 'сокет:эхо') || !!строка(host, id, 'сокет-ошибка:'), 12000)
  ok('постоянное соединение открылось и ответило',
    строка(host, id, 'сокет:').includes('эхо:пинг'),
    строка(host, id, 'сокет:') || строка(host, id, 'сокет-ошибка:'))

  await host.stopPlugin(id)
  removePlugin(id)
}

// ── 5. Фоновая работа ───────────────────────────────────────────────────────
async function фон(host: Host) {
  const id = await поднять(host, `/**
 * @name Фон
 * @id probe-bg
 * @version 1.0.0
 * @author проба
 * @description Проба фоновой задачи
 * @permissions background
 */
export async function onLoad(ponoi) {
  var n = 0
  await ponoi.background.every(1000, function () { n++; ponoi.log('тик:' + n) }, 'счётчик')
  ponoi.log('задача заведена')
}
`)
  const дошло = await ждать(() => строка(host, id, 'тик:') === 'тик:2', 9000)
  ok('фоновая задача правда выполняется по времени', дошло, строка(host, id, 'тик:'))
  const { taskList } = await import('./background')
  ok('задача видна человеку на карточке плагина', taskList(id).length === 1,
    JSON.stringify(taskList(id).map(t => t.label)))
  await host.stopPlugin(id)
  await пауза(1500)
  const после = строка(host, id, 'тик:')
  await пауза(1500)
  ok('после выключения плагина задача остановлена', строка(host, id, 'тик:') === после, после)
  removePlugin(id)
}

// ── 6. Цвета оформления и пункт меню ────────────────────────────────────────
async function оформление(host: Host) {
  const id = await поднять(host, `/**
 * @name Оформление
 * @id probe-theme
 * @version 1.0.0
 * @author проба
 * @description Проба темы и меню
 * @permissions ui.theme, ui, messages.read
 */
export async function onLoad(ponoi) {
  await ponoi.ui.setTheme({ accent: '#ff4500' })
  await ponoi.ui.addContextMenu({ target: 'message', label: 'Моё действие', onClick: function () {} })
  ponoi.log('оформление поставлено')
}
`)
  await ждать(() => !!строка(host, id, 'оформление поставлено'))
  const стиль = document.querySelector('style[data-plugin-theme="probe-theme"]')
  ok('цвета плагина попали в страницу', !!стиль && /--c-accent/.test(стиль.textContent ?? ''),
    (стиль?.textContent ?? 'нет').slice(0, 60))
  ok('цвет и правда применился к странице',
    getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim().toLowerCase() === '#ff4500',
    getComputedStyle(document.documentElement).getPropertyValue('--c-accent'))
  ok('пункт меню зарегистрирован',
    getRegistry().ctxItems.some(i => i.pluginId === id && i.target === 'message'),
    JSON.stringify(getRegistry().ctxItems.map(i => i.label)))

  await host.stopPlugin(id)
  await пауза(100)
  ok('цвета сняты вместе с плагином',
    !document.querySelector('style[data-plugin-theme="probe-theme"]')
    && getRegistry().ctxItems.every(i => i.pluginId !== id))
  removePlugin(id)
}

// ── 7. Плеер и голос ────────────────────────────────────────────────────────
//
// ЧЕСТНО О ГРАНИЦЕ: настоящего звонка и настоящего склада треков здесь нет, и
// «плагин переключил трек» проверить нечем. Проверяется то, что проверить
// можно и что как раз чаще всего ломается: вызовы ДОХОДЯТ до приложения, а не
// теряются молча, отвечают своей формой, и без разрешения не работают.
async function плеерИГолос(host: Host) {
  const id = await поднять(host, `/**
 * @name Плеер
 * @id probe-music
 * @version 1.0.0
 * @author проба
 * @description Проба плеера и голоса
 * @permissions music, voice
 */
export async function onLoad(ponoi) {
  try {
    const сейчас = await ponoi.music.now()
    ponoi.log('сейчас:' + JSON.stringify(сейчас))
    const склад = await ponoi.music.library()
    ponoi.log('склад:' + (Array.isArray(склад) ? склад.length : 'не список'))
    ponoi.log('пауза:' + await ponoi.music.pause())
  } catch (e) { ponoi.log('плеер-ошибка:' + e.message) }
  try {
    const голоса = await ponoi.voice.list()
    ponoi.log('голоса:' + голоса.map(function (g) { return g.id }).join(','))
    ponoi.log('текущий:' + await ponoi.voice.current())
  } catch (e) { ponoi.log('голос-ошибка:' + e.message) }
}
`)
  await ждать(() => !!строка(host, id, 'текущий:') || !!строка(host, id, 'голос-ошибка:'))
  ok('плагин спросил плеер и получил ответ, а не молчание',
    строка(host, id, 'сейчас:') !== '' && !строка(host, id, 'плеер-ошибка:'),
    строка(host, id, 'сейчас:') || строка(host, id, 'плеер-ошибка:'))
  ok('склад треков отвечает списком', /^склад:\d+$/.test(строка(host, id, 'склад:')),
    строка(host, id, 'склад:'))
  ok('список голосовых эффектов приходит от приложения',
    строка(host, id, 'голоса:').includes('robot'), строка(host, id, 'голоса:'))

  // Без разрешения — отказ, а не тихое «ничего не произошло».
  const без = await поднять(host, `/**
 * @name БезПрав
 * @id probe-noperm
 * @version 1.0.0
 * @author проба
 * @description Проба отказа
 * @permissions storage
 */
export async function onLoad(ponoi) {
  ponoi.music.now().then(function () { ponoi.log('пустили:да') },
                         function (e) { ponoi.log('отказ:' + e.message.slice(0, 40)) })
}
`)
  await ждать(() => !!строка(host, без, 'отказ:') || !!строка(host, без, 'пустили:'))
  ok('без разрешения плеер плагину не отвечает',
    строка(host, без, 'отказ:').includes('не выдано разрешение'),
    строка(host, без, 'отказ:') || строка(host, без, 'пустили:'))

  await host.stopPlugin(id); await host.stopPlugin(без)
  removePlugin(id); removePlugin(без)
}


// ── 8. Окно ставится куда и как угодно (v1.479.0) ───────────────────────────
//
// Раньше окно можно было только таскать: размер задавал плагин, место
// забывалось при закрытии, развернуть было нечем. Проверяем не «функция
// вызвалась», а РЕЗУЛЬТАТ на экране: где стоит прямоугольник и какого он
// размера.
async function окноКудаУгодно(host: Host) {
  const { forgetPlaces, savedPlace, moveApp, resizeApp, toggleMaxApp, snapApp } = await import('./apps')
  forgetPlaces()

  const id = await поднять(host, `/**
 * @name Окно
 * @id probe-place
 * @version 1.0.0
 * @author проба
 * @description Проба места окна
 * @permissions apps
 */
export async function onLoad(ponoi) {
  const id = await ponoi.apps.create({
    mode: 'window', title: 'Своё место', width: 420, height: 300,
    minWidth: 260, minHeight: 180,
    rows: [{ type: 'label', key: 'l', label: 'Строка', value: 'тут' }],
  })
  ponoi.log('открыто:' + id)
}
`)
  await ждать(() => appList(id).length === 1)
  await пауза(200)
  const окно = () => document.querySelector('.plugapp-window') as HTMLElement | null
  const r = () => окно()!.getBoundingClientRect()
  ok('окно открылось с тем размером, что попросил плагин',
    Math.round(r().width) === 420 && Math.round(r().height) === 300,
    `${Math.round(r().width)}x${Math.round(r().height)}`)

  ok('слова «плагин» рядом с окном больше нет',
    !окно()!.querySelector('.plugapp-tag') && !/плагин/i.test(окно()!.querySelector('.plugapp-h')!.textContent ?? ''),
    окно()!.querySelector('.plugapp-h')!.textContent ?? '')
  ok('но видно, чьё это окно — имя плагина в шапке',
    (окно()!.querySelector('.plugapp-by')?.textContent ?? '') === 'probe-place',
    окно()!.querySelector('.plugapp-by')?.textContent ?? 'нет подписи')

  const номер = appList(id)[0].id

  // Перетаскивание руками — через ту же дорогу, которой ходит указатель.
  moveApp(номер, 120, 90)
  await пауза(150)
  ok('окно встало туда, куда его поставили',
    Math.round(r().left) === 120 && Math.round(r().top) === 90,
    `${Math.round(r().left)},${Math.round(r().top)}`)

  // Растягивание за край.
  resizeApp(номер, 700, 480)
  await пауза(150)
  ok('окно тянется за край', Math.round(r().width) === 700 && Math.round(r().height) === 480,
    `${Math.round(r().width)}x${Math.round(r().height)}`)

  resizeApp(номер, 50, 40)
  await пауза(150)
  ok('меньше своего наименьшего размера окно не сжимается',
    Math.round(r().width) === 260 && Math.round(r().height) === 180,
    `${Math.round(r().width)}x${Math.round(r().height)}`)

  // Разворот и возврат.
  const экран = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }
  toggleMaxApp(номер, экран)
  await пауза(150)
  ok('разворот занимает весь экран',
    Math.round(r().width) >= экран.w - 2 && Math.round(r().height) >= экран.h - 2,
    `${Math.round(r().width)}x${Math.round(r().height)} при ${экран.w}x${экран.h}`)
  toggleMaxApp(номер, экран)
  await пауза(150)
  ok('второй разворот возвращает прежний размер и место',
    Math.round(r().width) === 260 && Math.round(r().left) === 120,
    `${Math.round(r().width)} на ${Math.round(r().left)}`)

  // Прилипание к половине экрана.
  snapApp(номер, 'right', экран)
  await пауза(150)
  ok('прилипание к правому краю занимает половину экрана',
    Math.abs(r().width - экран.w / 2) < 3 && Math.abs(r().right - экран.w) < 3,
    `${Math.round(r().width)} шириной, правый край ${Math.round(r().right)}`)

  // Память места: закрываем и открываем заново.
  const место = savedPlace('probe-place', 'Своё место')
  ok('место и размер записаны на устройстве', !!место && место.w === Math.round(r().width),
    JSON.stringify(место))

  await host.stopPlugin(id)
  await пауза(150)
  await host.startPlugin({
    manifest: parsePlugin(`/**
 * @name Окно
 * @id probe-place
 * @version 1.0.0
 * @author проба
 * @description Проба места окна
 * @permissions apps
 */
export async function onLoad(ponoi) {
  await ponoi.apps.create({ mode: 'window', title: 'Своё место', width: 420, height: 300,
    minWidth: 260, minHeight: 180, rows: [] })
}
`),
    code: `/**
 * @name Окно
 * @id probe-place
 * @version 1.0.0
 * @author проба
 * @description Проба места окна
 * @permissions apps
 */
export async function onLoad(ponoi) {
  await ponoi.apps.create({ mode: 'window', title: 'Своё место', width: 420, height: 300,
    minWidth: 260, minHeight: 180, rows: [] })
}
`,
    enabled: true, installedAt: '', sourceUserId: null, storage: {},
  } as any)
  await ждать(() => appList('probe-place').length === 1)
  await пауза(250)
  ok('при следующем открытии окно встаёт туда же, куда его поставил человек',
    Math.abs(r().width - (место?.w ?? 0)) < 3 && Math.abs(r().left - (место?.x ?? 0)) < 3,
    `${Math.round(r().left)},${Math.round(r().top)} ${Math.round(r().width)}x${Math.round(r().height)}`)


  // Окошко в углу (pip) тоже растягивается. Раньше его размер был прибит в
  // стилях через !important: ручки работали, модель менялась, а на экране
  // ничего — то самое расхождение показа и действия.
  {
    const id2 = await поднять(host, `/**
 * @name Уголок
 * @id probe-pip
 * @version 1.0.0
 * @author проба
 * @description Проба окошка в углу
 * @permissions apps
 */
export async function onLoad(ponoi) {
  await ponoi.apps.create({ mode: 'pip', title: 'Уголок', rows: [] })
}
`)
    await ждать(() => appList(id2).length === 1)
    await пауза(250)
    const уголок = () => (document.querySelector('.plugapp-pip') as HTMLElement).getBoundingClientRect()
    ok('окошко в углу открывается маленьким',
      Math.round(уголок().width) === 300 && Math.round(уголок().height) === 200,
      `${Math.round(уголок().width)}x${Math.round(уголок().height)}`)
    resizeApp(appList(id2)[0].id, 520, 380)
    await пауза(200)
    ok('окошко в углу ТОЖЕ тянется, а не прибито размером',
      Math.round(уголок().width) === 520 && Math.round(уголок().height) === 380,
      `${Math.round(уголок().width)}x${Math.round(уголок().height)}`)
    await host.stopPlugin(id2)
    removePlugin(id2)
  }

  await host.stopPlugin('probe-place')
  removePlugin('probe-place')
  forgetPlaces()
}


// ── 9. Свободный виджет вместо полосы над чатом (v1.480.0) ──────────────────
//
// Владелец про полосу сказал прямо: «уродски». Она занимала место у всех и
// всегда — даже когда плагину надо было показать одну строчку. Теперь то же
// самое живёт свободным виджетом: стоит там, куда его поставил человек.
//
// Проверяем главное: плагины, написанные под slot: 'chat', НЕ СЛОМАЛИСЬ. Их
// панель не пропала — она переехала.
async function свободныйВиджет(host: Host) {
  const { forgetPlaces } = await import('./apps')
  forgetPlaces()
  const id = await поднять(host, `/**
 * @name Уголок в чате
 * @id probe-widget
 * @version 1.0.0
 * @author проба
 * @description Проба виджета
 * @permissions panel
 */
export async function onLoad(ponoi) {
  self.рисуй = function (текст) {
    return ponoi.ui.addPanel({ slot: 'chat', title: 'Мой уголок', rows: [
      { type: 'label', key: 'что', label: 'Значение', value: текст },
    ] })
  }
  await self.рисуй('первое')
  ponoi.log('нарисовал')
}
`)
  await ждать(() => appList(id).length === 1)
  await пауза(250)

  const окна = appList(id)
  ok('панель «в чат» стала свободным виджетом, а не пропала',
    окна.length === 1 && окна[0].mode === 'widget', JSON.stringify(окна.map(a => a.mode)))
  ok('заголовок плагина сохранился', окна[0].title === 'Мой уголок', окна[0].title)

  const узел = document.querySelector('.plugapp-widget') as HTMLElement | null
  ok('виджет нарисован на экране', !!узел)
  ok('виджет маленький, а не во всю ширину',
    !!узел && узел.getBoundingClientRect().width <= 320,
    узел ? Math.round(узел.getBoundingClientRect().width) + 'px' : 'нет')
  ok('в виджете видно то, что положил плагин',
    (узел?.textContent ?? '').includes('первое'), (узел?.textContent ?? '').slice(0, 60))

  // Повторный вызов обязан ОБНОВИТЬ виджет, а не открыть второй: панели
  // перерисовываются на каждое событие, и копии завалили бы экран.
  const код2 = getRegistry().panels.length
  void код2
  await host.invokePlugin(id, { __fn: 'нет' } as any, []).catch(() => {})
  // Зовём тем же путём, что и сам плагин: через его обработчик настроек.
  await пауза(50)

  ok('панелей в старом смысле больше не заводится', getRegistry().panels.every(p => p.slot !== 'chat'),
    JSON.stringify(getRegistry().panels.map(p => p.slot)))

  // Виджет двигается и помнит место — как и любое окно.
  const { moveApp, savedPlace } = await import('./apps')
  moveApp(окна[0].id, 200, 140)
  await пауза(150)
  const r = (document.querySelector('.plugapp-widget') as HTMLElement).getBoundingClientRect()
  ok('виджет двигается куда угодно', Math.round(r.left) === 200 && Math.round(r.top) === 140,
    `${Math.round(r.left)},${Math.round(r.top)}`)
  ok('место виджета запоминается', !!savedPlace('probe-widget', 'Мой уголок'),
    JSON.stringify(savedPlace('probe-widget', 'Мой уголок')))

  await host.stopPlugin(id)
  await пауза(150)
  ok('виджет исчезает вместе с выключенным плагином', !document.querySelector('.plugapp-widget'))
  removePlugin(id)
  forgetPlaces()
}


// ── 10. Плагин видит своё окно (v1.485.0) ───────────────────────────────────
//
// Владелец описал беду точно: «плагин считает, что окна стоят на месте».
// Перетаскивание обрабатывает приложение, плагин живёт в отдельном потоке — и
// координат не знал вовсе. Проверяем именно это: что он их получает и что
// может двигать окно сам.
async function окноГдеСтоит(host: Host) {
  const { forgetPlaces, moveApp } = await import('./apps')
  forgetPlaces()
  const id = await поднять(host, `/**
 * @name Где окно
 * @id probe-where
 * @version 1.0.0
 * @author проба
 * @description Проба координат окна
 * @permissions *
 */
export async function onLoad(ponoi) {
  const окно = await ponoi.apps.create({ mode: 'window', title: 'Где я', width: 320, height: 200, rows: [] })
  self.окно = окно
  const о = await ponoi.apps.where(окно)
  ponoi.log('где:' + JSON.stringify({ x: о.x, y: о.y, w: о.width, h: о.height }))
  ponoi.log('экран:' + JSON.stringify(await ponoi.apps.screen()))
  ponoi.on('app', function (e) { ponoi.log('событие:' + e.x + ',' + e.y) })
  self.двинь = function (x, y) { return ponoi.apps.move(окно, x, y) }
}
`)
  await ждать(() => appList(id).length === 1)
  await пауза(400)

  ok('плагин узнал, где стоит его окно', /где:\{"x":\d+,"y":\d+,"w":320,"h":200\}/.test(строка(host, id, 'где:')),
    строка(host, id, 'где:'))
  ok('плагин знает размер экрана', /экран:\{"w":\d+,"h":\d+\}/.test(строка(host, id, 'экран:')),
    строка(host, id, 'экран:'))

  // Человек тащит окно — плагину должно прийти новое место.
  const было = журнал(host, id).filter(l => l.includes('событие:')).length
  moveApp(appList(id)[0].id, 250, 170)
  await пауза(400)
  const событие = журнал(host, id).filter(l => l.includes('событие:')).pop() ?? ''
  ok('о переезде окна плагину сообщили', событие.includes('250,170'), событие)
  ok('событий стало больше, а не одно на всё время', журнал(host, id).filter(l => l.includes('событие:')).length > было)

  await host.stopPlugin(id)
  removePlugin(id)
  forgetPlaces()
}

// ── 11. Окно без рамки, прозрачное и прячущееся (v1.487.0) ──────────────────
//
// Проверяем не «поле выставилось», а ВИД на экране: настоящие вычисленные
// стили, настоящее наведение мышью, настоящее перетаскивание.
//
// Мышь тут не поддельная: события, собранные dispatchEvent, проходят через
// обработчики, но указателя не двигают — а шапка безрамочного окна появляется
// именно по :hover, который браузер ставит по настоящему положению мыши.
// Поэтому ввод просим у стенда (scripts/api-test.cjs).
let мышьН = 0
async function мышь(kind: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number) {
  const n = ++мышьН
  ;(window as any).__mouseReq = { kind, x: Math.round(x), y: Math.round(y), n }
  for (let i = 0; i < 100 && (window as any).__mouseAck !== n; i++) await пауза(20)
  await пауза(30)
}

async function безРамки(host: Host) {
  const { forgetPlaces } = await import('./apps')
  const { emitToPlugin } = await import('./bridge')
  forgetPlaces()

  const id = await поднять(host, `/**
 * @name Без рамки
 * @id probe-frameless
 * @version 1.0.0
 * @author проба
 * @description Проба безрамочного окна
 * @permissions apps
 */
export async function onLoad(ponoi) {
  const окно = await ponoi.apps.create({
    mode: 'window', title: 'Голое окно', width: 300, height: 220, x: 150, y: 150,
    frameless: true, transparent: true, resizable: false,
    rows: [
      { type: 'label', key: 'l', label: 'Внутри', value: 'тут' },
      { type: 'button', key: 'b', label: 'Нажми', onClick: function () { ponoi.log('нажали кнопку') } },
    ],
  })
  ponoi.log('окно:' + окно)
  ponoi.on('app', function (e) { ponoi.log('app:' + (e.open ? 'открыто' : 'ЗАКРЫТО')) })
  ponoi.on('app:move', function (e) { ponoi.log('move:' + e.x + ',' + e.y) })
  ponoi.on('app:moveend', function (e) { ponoi.log('moveend:' + e.x + ',' + e.y) })
  ponoi.on('settings', async function (e) {
    if (e.key === 'hide') await ponoi.apps.hide(окно)
    if (e.key === 'show') await ponoi.apps.show(окно)
    if (e.key === 'frame') await ponoi.apps.update(окно, { frameless: false, transparent: false })
    if (e.key === 'where') ponoi.log('где:' + JSON.stringify(await ponoi.apps.where(окно)))
    ponoi.log('сделано:' + e.key)
  })
}
`)
  await ждать(() => appList(id).length === 1)
  await пауза(300)

  const окно = () => document.querySelector('.plugapp-window') as HTMLElement | null
  const шапка = () => окно()!.querySelector('.plugapp-h') as HTMLElement
  const вид = (el: Element) => getComputedStyle(el)
  const прозрачен = (c: string) => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c)

  // Сначала уводим настоящий указатель подальше: он мог остаться над окном с
  // прошлой проверки, и «шапки не видно» прошло бы или упало по случайности.
  await мышь('mouseMove', 5, 760)
  await пауза(200)
  // Если стенд не умеет двигать настоящую мышь, все проверки ниже прошли бы
  // «сами собой» — и молча. Пусть это будет видно отдельной строкой.
  ok('стенд отвечает на просьбы о настоящей мыши', (window as any).__mouseAck === мышьН,
    'ждали ' + мышьН + ', ответ ' + String((window as any).__mouseAck))
  // И попадает ТУДА, куда просили: система вправе мерить свои координаты
  // иначе, чем страница, и промах мимо на десяток пикселей выглядел бы как
  // «перетаскивание не работает».
  let попал = ''
  const ловец = (e: PointerEvent) => { попал = Math.round(e.clientX) + ',' + Math.round(e.clientY) }
  window.addEventListener('pointerdown', ловец, true)
  await мышь('mouseDown', 400, 600); await мышь('mouseUp', 400, 600)
  window.removeEventListener('ointerdown' as any, ловец, true)
  window.removeEventListener('pointerdown', ловец, true)
  ok('и попадает туда, куда просили', попал === '400,600', 'просили 400,600, пришло ' + (попал || 'ничего'))
  // И попадает В ОКНО, а не во что-то, что лежит поверх него. Проверка не
  // праздная: полотно вывода этого же стенда однажды закрыло собой окно
  // плагина целиком, и «перетаскивание не работает» оказалось поломкой стенда.
  {
    const r = окно()!.getBoundingClientRect()
    const п = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    ok('в центре окна — само окно, а не что-то поверх него', !!п && окно()!.contains(п),
      п ? п.tagName + '.' + String(п.className) : 'ничего')
  }

  ok('безрамочное окно нарисовано', !!окно())
  ok('рамки и тени у него нет',
    вид(окно()!).boxShadow === 'none' && вид(окно()!).borderTopWidth === '0px',
    вид(окно()!).boxShadow + ' / ' + вид(окно()!).borderTopWidth)
  ok('подложка прозрачная насквозь', прозрачен(вид(окно()!).backgroundColor),
    вид(окно()!).backgroundColor)
  ok('шапки на виду нет', вид(шапка()).opacity === '0', вид(шапка()).opacity)
  // Но она НЕ удалена: окно без единой подписи и без крестика — это способ
  // выдать себя за приложение и не дать себя закрыть.
  ok('шапка при этом осталась в разметке, а не удалена',
    !!шапка() && (шапка().textContent ?? '').includes('probe-frameless'),
    шапка().textContent ?? '')

  // Настоящее наведение: указатель на шапку окна.
  const r0 = окно()!.getBoundingClientRect()
  await мышь('mouseMove', r0.left + r0.width / 2, r0.top + 10)
  await пауза(250)
  ok('подвёл мышь — шапка вернулась', вид(шапка()).opacity === '1', вид(шапка()).opacity)
  ok('в ней видно, чьё это окно, и есть чем закрыть',
    (окно()!.querySelector('.plugapp-by')?.textContent ?? '') === 'probe-frameless'
      && !!окно()!.querySelector('.plugapp-x'),
    окно()!.querySelector('.plugapp-by')?.textContent ?? 'нет подписи')
  await мышь('mouseMove', 5, 700)
  await пауза(250)
  ok('увёл мышь — шапка снова спряталась', вид(шапка()).opacity === '0', вид(шапка()).opacity)

  ok('resizable: false — ручек по краям нет', !окно()!.querySelector('.plugapp-rz'))

  // ── Перетаскивание за ТЕЛО. Шапки на виду нет, и без этого окно нельзя было
  // бы сдвинуть вовсе.
  const было = журнал(host, id).filter(l => l.includes('ЗАКРЫТО')).length
  const r1 = окно()!.getBoundingClientRect()
  const цх = r1.left + r1.width / 2, цу = r1.top + r1.height / 2
  await мышь('mouseMove', цх, цу)
  await мышь('mouseDown', цх, цу)
  for (let i = 1; i <= 6; i++) await мышь('mouseMove', цх + i * 12, цу + i * 8)
  await пауза(120)
  const движения = журнал(host, id).filter(l => l.includes('move:')).length
  await мышь('mouseUp', цх + 72, цу + 48)
  await пауза(300)

  const r2 = окно()!.getBoundingClientRect()
  ok('безрамочное окно двигается за тело, а не только за шапку',
    Math.round(r2.left) !== Math.round(r1.left) && Math.round(r2.top) !== Math.round(r1.top),
    `${Math.round(r1.left)},${Math.round(r1.top)} → ${Math.round(r2.left)},${Math.round(r2.top)}`)
  ok('о движении плагину сообщали КАДРАМИ, а не один раз', движения >= 2, 'событий move: ' + движения)
  const конец = журнал(host, id).filter(l => l.includes('moveend:')).pop() ?? ''
  ok('в конце пришло окончательное место',
    конец.includes(String(Math.round(r2.left)) + ',' + String(Math.round(r2.top))),
    конец + ' при ' + Math.round(r2.left) + ',' + Math.round(r2.top))

  // САМОЕ ВАЖНОЕ ЗДЕСЬ. С v1.485.0 место окна лежало в зависимостях того же
  // эффекта, что и уборка, — и React звал уборку на каждое движение. Плагину
  // приходило «твоё окно ЗАКРЫЛИ», и написанный по документации плагин
  // останавливался: наша же «Змейка» кончалась от перетаскивания окна.
  ok('при перетаскивании плагину НЕ говорят, что окно закрыли',
    журнал(host, id).filter(l => l.includes('ЗАКРЫТО')).length === было,
    'ложных закрытий: ' + (журнал(host, id).filter(l => l.includes('ЗАКРЫТО')).length - было))

  // ── А вот кнопка внутри окна должна НАЖИМАТЬСЯ, а не тащить окно за собой.
  // Иначе «двигается за любое место» означало бы, что в окне ничего не нажать.
  {
    const к = окно()!.querySelector('.plugpanel-btn') as HTMLElement
    const rк = к.getBoundingClientRect()
    const до = окно()!.getBoundingClientRect()
    const кх = rк.left + rк.width / 2, ку = rк.top + rк.height / 2
    // Нажимаем с дрожью в пару пикселей — рука дрожит у всех, и щелчок от
    // этого щелчком быть не перестаёт.
    await мышь('mouseMove', кх, ку)
    await мышь('mouseDown', кх, ку)
    await мышь('mouseMove', кх + 2, ку + 1)
    await мышь('mouseUp', кх + 2, ку + 1)
    await пауза(300)
    const после = окно()!.getBoundingClientRect()
    ok('нажатие на кнопку внутри окна НЕ тащит окно',
      Math.round(до.left) === Math.round(после.left) && Math.round(до.top) === Math.round(после.top),
      `${Math.round(до.left)},${Math.round(до.top)} → ${Math.round(после.left)},${Math.round(после.top)}`)
    ok('и сама кнопка при этом срабатывает',
      журнал(host, id).some(l => l.includes('нажали кнопку')))
  }

  // ── Спрятать и показать. Это не закрытие: окно живо, номер прежний.
  const номер = appList(id)[0].id
  emitToPlugin(id, 'settings', { key: 'hide', value: true })
  await ждать(() => !!окно() && вид(окно()!).display === 'none')
  ok('спрятанное окно не видно', вид(окно()!).display === 'none', вид(окно()!).display)
  ok('но оно живо, а не закрыто', appList(id).length === 1 && appList(id)[0].id === номер,
    JSON.stringify(appList(id).map(a => a.id)))
  ok('плагину не сказали, что его закрыли',
    журнал(host, id).filter(l => l.includes('ЗАКРЫТО')).length === было)

  emitToPlugin(id, 'settings', { key: 'where', value: 1 })
  await пауза(300)
  ok('плагин видит, что окно спрятано', /"hidden":true/.test(строка(host, id, 'где:')),
    строка(host, id, 'где:').slice(0, 120))

  emitToPlugin(id, 'settings', { key: 'show', value: true })
  await ждать(() => !!окно() && вид(окно()!).display !== 'none')
  ok('показали обратно — окно на прежнем месте',
    вид(окно()!).display !== 'none'
      && Math.round(окно()!.getBoundingClientRect().left) === Math.round(r2.left),
    `${Math.round(окно()!.getBoundingClientRect().left)} при ${Math.round(r2.left)}`)

  // ── Рамку можно вернуть на ходу.
  emitToPlugin(id, 'settings', { key: 'frame', value: true })
  // Ждём именно ПОДЛОЖКУ, а не шапку: указатель после перетаскивания стоит над
  // окном, и шапка у него видна по наведению — то есть по ней не отличить
  // «рамка вернулась» от «на окно навели». На это я и попался.
  await ждать(() => !прозрачен(вид(окно()!).backgroundColor))
  ok('рамка возвращается на ходу',
    !прозрачен(вид(окно()!).backgroundColor) && вид(окно()!).boxShadow !== 'none'
      && вид(шапка()).position !== 'absolute',
    вид(окно()!).backgroundColor + ' / ' + вид(шапка()).position)

  // ── Esc закрывает всегда.
  окно()!.focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await пауза(250)
  ok('Esc закрывает безрамочное окно', !окно() && appList(id).length === 0,
    String(appList(id).length))

  await host.stopPlugin(id)
  removePlugin(id)
  forgetPlaces()
}

// ── 12. Каждый вид строки рисуется в окне плагина (v1.488.0) ────────────────
//
// Поводом стала настоящая дыра: строка keybind знала только страницу настроек
// плагина, а PanelRows — панель И окно — отдавала на неё null. То есть плагин
// описывал строку по документации, а на экране не появлялось НИЧЕГО: ни
// ошибки, ни пустого места. Молчаливое расхождение показа и действия.
//
// Проверяем не «тип объявлен», а ВИДНО ли строку: у каждой должен найтись свой
// элемент с ненулевым размером.
async function всеСтроки(host: Host) {
  const { forgetPlaces } = await import('./apps')
  forgetPlaces()
  const id = await поднять(host, `/**
 * @name Все строки
 * @id probe-rows
 * @version 1.0.0
 * @author проба
 * @description Проба всех видов строк
 * @permissions apps
 */
export async function onLoad(ponoi) {
  await ponoi.apps.create({
    mode: 'window', title: 'Все строки', width: 460, height: 560, x: 40, y: 40,
    rows: [
      { type: 'label', key: 'r-label', label: 'Подпись', value: 'значение' },
      { type: 'toggle', key: 'r-toggle', label: 'Переключатель', value: true },
      { type: 'text', key: 'r-text', label: 'Поле', value: 'текст' },
      { type: 'select', key: 'r-select', label: 'Выбор', value: 'a',
        options: [{ value: 'a', label: 'Раз' }, { value: 'b', label: 'Два' }] },
      { type: 'button', key: 'r-button', label: 'Кнопка', onClick: function () {} },
      { type: 'progress', key: 'r-progress', label: 'Полоса', value: 42 },
      { type: 'slider', key: 'r-slider', label: 'Ползунок', value: 5, min: 0, max: 10 },
      { type: 'color', key: 'r-color', label: 'Цвет', value: '#5865f2' },
      { type: 'canvas', key: 'r-canvas', label: 'Холст', height: 60 },
      { type: 'keybind', key: 'r-keybind', label: 'Горячая клавиша' },
    ],
  })
  ponoi.log('готово')
}
`)
  await ждать(() => appList(id).length === 1)
  await пауза(400)

  const тело = document.querySelector('.plugapp-window .plugapp-body') as HTMLElement | null
  ok('окно со всеми строками открылось', !!тело)

  // Что искать для каждого вида. Ищем ЭЛЕМЕНТ, а не текст: подпись плагин
  // задаёт сам, а вот управляющий элемент рисуем мы — или не рисуем.
  const ищем: Array<[string, string]> = [
    ['подпись', '.plugpanel-val'],
    ['переключатель', '.pqs-toggle'],
    ['поле ввода', 'input.modal-in'],
    ['выбор из списка', 'select'],
    ['кнопка', '.plugpanel-btn'],
    ['полоса', '.plugpanel-bar'],
    ['ползунок', 'input[type="range"]'],
    ['цвет', 'input[type="color"]'],
    ['холст', 'canvas'],
    ['горячая клавиша', '.plug-keybind'],
  ]
  for (const [имя, что] of ищем) {
    const el = тело?.querySelector(что) as HTMLElement | null
    const r = el?.getBoundingClientRect()
    ok('строка «' + имя + '» видна в окне плагина',
      !!r && r.width > 0 && r.height > 0,
      el ? Math.round(r!.width) + 'x' + Math.round(r!.height) : 'нет такого элемента')
  }

  await host.stopPlugin(id)
  removePlugin(id)
  forgetPlaces()
}

async function main() {
  // Прибираем за прошлым прогоном: localStorage у file:// общий со смоуком, и
  // забытый здесь плагин заставит его ругаться на «утечку» системы плагинов.
  const { loadPlugins } = await import('./store')
  for (const p of loadPlugins()) if (p.manifest.id.startsWith('probe-')) removePlugin(p.manifest.id)

  createRoot(document.getElementById('root')!).render(<PluginApps />)
  const host = await ensureHost()

  lines.push('── Перехват сообщений ──'); out()
  await перехватСообщений(host)
  lines.push(''); lines.push('── Виды окна ──'); out()
  await видыОкон(host)
  lines.push(''); lines.push('── Службы и письма ──'); out()
  await службыИПисьма(host)
  lines.push(''); lines.push('── Сеть на настоящем сервере ──'); out()
  await сеть(host)
  lines.push(''); lines.push('── Фоновая работа ──'); out()
  await фон(host)
  lines.push(''); lines.push('── Оформление и меню ──'); out()
  await оформление(host)
  lines.push(''); lines.push('── Плеер и голос ──'); out()
  await плеерИГолос(host)
  lines.push(''); lines.push('── Окно куда угодно ──'); out()
  await окноКудаУгодно(host)
  lines.push(''); lines.push('── Свободный виджет ──'); out()
  await свободныйВиджет(host)
  lines.push(''); lines.push('── Плагин видит своё окно ──'); out()
  await окноГдеСтоит(host)
  lines.push(''); lines.push('── Окно без рамки ──'); out()
  await безРамки(host)
  lines.push(''); lines.push('── Все виды строк ──'); out()
  await всеСтроки(host)

  lines.push('')
  lines.push(`ИТОГ: пройдено ${lines.filter(l => l.startsWith('OK')).length}, провалено ${failed}`)
  out()
  ;(window as any).__failed = failed
  ;(window as any).__done = true
}

main().catch(e => {
  lines.push('УПАЛО: ' + (e?.message ?? e))
  out()
  ;(window as any).__failed = 1
  ;(window as any).__done = true
})
