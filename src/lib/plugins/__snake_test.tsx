// v1.474.0: живая проверка НАСТОЯЩЕГО плагина. Запуск: npm run test:snake
//
// Зачем именно так. С v1.465 у плагинов появились окно, холст, клавиши,
// геймпад, таблицы и файлы — и ни одна из этих возможностей ни разу не была
// проверена вживую, потому что не существовало плагина, который ими
// пользуется. «Работает» означало «проверки на выдуманных данных зелёные».
//
// Здесь работает настоящий официальный плагин «Змейка»: он проходит тот же
// путь, что у человека (разбор шапки → установка → песочница → команда), сам
// открывает своё окно, сам берёт холст, сам собирает звук и пишет рекорд в
// свою таблицу. А нажатие клавиши шлёт ЭЛЕКТРОН — настоящим событием ввода в
// окно, а не вызовом обработчика (см. scripts/snake-test.cjs), и результат
// меряется по снимку экрана: где на картинке голова змейки.
//
// Именно так нашлись три поломки: холст, объявленный в окне плагина, не
// находился вовсе; клавиш в окне не было ни одной; а разрешение на холст
// спрашивалось чужое («своя панель в плеере» у игры, у которой панели нет).
import { createRoot } from 'react-dom/client'
import { PluginApps } from '../../components/PluginApps'
import { PluginDialogHost } from '../../components/PluginDialog'
import { OFFICIAL_PLUGINS } from './official'
import { parsePlugin } from './manifest'
import { upsertPlugin, removePlugin } from './store'
import { ensureHost } from './bridge'
import { getRegistry } from './registry'
import { appList } from './apps'
import { assetList, assetClear } from './assets'
import { dbAll, dbDropAll } from './db'

const lines: string[] = []
let failed = 0
const out = () => { document.getElementById('out')!.textContent = lines.join('\n') }
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  lines.push(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
  out()
}
const пауза = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const снейк = OFFICIAL_PLUGINS.find(p => p.id === 'ponoi-snake')!
  const m = parsePlugin(снейк.code)
  ok('плагин разбирается как обычный', m.id === 'ponoi-snake', m.name)
  ok('просит ровно то, чем пользуется',
    ['apps', 'storage', 'input', 'notify', 'commands'].every(p => m.permissions.includes(p as never))
    // «panel» игре не нужна: холст живёт в её собственном окне. До v1.474.0
    // приложение требовало именно её — то есть врало на экране разрешений.
    && !m.permissions.includes('panel' as never), m.permissions.join(','))

  await dbDropAll('ponoi-snake')
  await assetClear('ponoi-snake')

  const plugin: any = {
    manifest: m, code: снейк.code, enabled: true,
    installedAt: new Date().toISOString(), sourceUserId: null, storage: {},
  }
  upsertPlugin(plugin)

  createRoot(document.getElementById('root')!).render(<><PluginApps /><PluginDialogHost /></>)
  // Поднимаем плагин ТЕМ ЖЕ путём, что и приложение, — через прослойку. Зови мы
  // host напрямую, прослойка не узнала бы о нём, и её emitToPlugin молча ничего
  // не делал бы: окно плагина шлёт клавиши именно через неё. На этом проба и
  // споткнулась в первый раз.
  const host = await ensureHost()
  const { startPlugin, stopPlugin, invokePlugin, pluginLogs, pluginError } = host
  await startPlugin(plugin)
  await пауза(300)
  ok('плагин запустился без ошибок', !pluginError('ponoi-snake'), String(pluginError('ponoi-snake')))

  // Зовём команду ровно так, как это делает человек в чате.
  const cmd = getRegistry().commands.find(c => c.name === 'змейка')
  ok('команда зарегистрирована', !!cmd)
  await invokePlugin('ponoi-snake', cmd!.handler, [''])
  await пауза(700)

  const окна = appList('ponoi-snake')
  ok('окно плагина открылось', окна.length === 1 && окна[0].mode === 'window',
    JSON.stringify(окна.map(a => a.mode)))
  ok('окно нарисовано в приложении', !!document.querySelector('.plugapp'))

  const холст = document.querySelector('.plugapp canvas') as HTMLCanvasElement | null
  ok('холст в окне стоит и отдан плагину', !!холст && холст.width === 600,
    холст ? холст.width + 'x' + холст.height : 'нет')
  // Прочитать пиксели ОТСЮДА нельзя: управление холстом отдано воркеру, и это
  // правильно — иначе плагин рисовал бы не в свой холст. Поэтому картинку
  // меряет снимками внешний сценарий, а мы говорим ему, что можно начинать.
  ;(window as any).__клавиш = 0
  window.addEventListener('keydown', (e) => { (window as any).__клавиш++; (window as any).__последняя = e.key }, true)
  ;(window as any).__этап = 'играет'
  for (let i = 0; i < 300 && !(window as any).__ключиГотово; i++) await пауза(100)
  ok('снимки экрана состоялись', !!(window as any).__ключиГотово)

  // Файлы: плагин собрал звук САМ — скачивать ему неоткуда.
  const файлы = await assetList('ponoi-snake')
  ok('плагин сам собрал и сохранил свои звуки',
    файлы.length === 2 && файлы.every(f => f.kind === 'audio'),
    JSON.stringify(файлы.map(f => f.name + ':' + f.type)))

  // Доигрываем: змейка врежется в стену сама, и рекорд должен лечь в таблицу.
  for (let i = 0; i < 60; i++) {
    if ((await dbAll('ponoi-snake', 'счёт', 5)).length) break
    await пауза(500)
  }
  const очки = await dbAll('ponoi-snake', 'счёт', 50)
  ok('рекорд записан в таблицу плагина', очки.length >= 1,
    JSON.stringify(очки.map((о: any) => о.очки)))

  const журнал = pluginLogs('ponoi-snake').map(l => l.level + ':' + l.text)
  ok('в журнале плагина нет ошибок', !журнал.some(l => l.startsWith('error')),
    журнал.filter(l => l.startsWith('error')).join(' | '))

  await stopPlugin('ponoi-snake')
  await пауза(200)
  ok('окно исчезло вместе с остановленным плагином',
    appList('ponoi-snake').length === 0 && !document.querySelector('.plugapp'))

  await dbDropAll('ponoi-snake')
  await assetClear('ponoi-snake')
  // Плагин записан в localStorage, а он у file:// общий со смоуком: забытый
  // здесь плагин заставит смоук ругаться на «утечку» системы плагинов.
  removePlugin('ponoi-snake')

  await окноВопрос(host)
  await перехватВложений(host)

  lines.push('')
  lines.push('журнал: ' + журнал.join(' / '))
  lines.push(`ИТОГ страницы: пройдено ${lines.filter(l => l.startsWith('OK')).length}, провалено ${failed}`)
  out()
  ;(window as any).__failed = failed
  ;(window as any).__done = true
}

/**
 * Окно-вопрос плагина (v1.475.0).
 *
 * Проверяется настоящим щелчком по настоящим кнопкам: плагин просит форму,
 * человек её заполняет, плагин получает значения. Тут легко сделать вид, что
 * работает, — вернуть значения по умолчанию, не глядя на то, что человек
 * ввёл, — поэтому поле МЕНЯЕТСЯ, и ответ сверяется с новым значением.
 */
async function окноВопрос(host: Awaited<ReturnType<typeof ensureHost>>) {
  const КОД = `/**
 * @name Опросчик
 * @id probe-dialog
 * @version 1.0.0
 * @author проба
 * @description Проба окна-вопроса
 * @permissions ui
 */
export async function onLoad(neylivo) {
  neylivo.ui.dialog({
    title: 'Как настроить', text: 'Пояснение', ok: 'Сохранить',
    rows: [
      { type: 'text', key: 'имя', label: 'Имя', value: 'было' },
      { type: 'toggle', key: 'звук', label: 'Со звуком', value: true },
      { type: 'button', key: 'лишняя', label: 'Не должна попасть', onClick: function () {} },
    ],
  }).then(function (ответ) {
    neylivo.log('ответ:' + JSON.stringify(ответ))
  }, function (e) { neylivo.log('отказ:' + e.message) })
}
`
  const m = parsePlugin(КОД)
  const p: any = {
    manifest: m, code: КОД, enabled: true,
    installedAt: new Date().toISOString(), sourceUserId: null, storage: {},
  }
  upsertPlugin(p)
  await host.startPlugin(p)
  for (let i = 0; i < 40 && !document.querySelector('.pdlg-box'); i++) await пауза(100)

  const окно = document.querySelector('.pdlg-box')
  ok('окно-вопрос открылось', !!окно)
  ok('в шапке написано, какой плагин спрашивает',
    !!окно && /Опросчик/.test(окно.querySelector('.plugapp-tag')?.textContent ?? ''),
    окно?.querySelector('.plugapp-tag')?.textContent ?? '')
  const поля = окно?.querySelectorAll('.pdlg-row') ?? ([] as any)
  ok('кнопка в окно-вопрос не попала', поля.length === 2, 'строк: ' + поля.length)

  // Меняем поле по-настоящему: через нативный сеттер, иначе React не заметит.
  const input = окно!.querySelector('input.cfm-input') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, 'стало')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await пауза(100)
  ;(окно!.querySelector('.cfm-ok') as HTMLButtonElement).click()
  await пауза(400)

  const журнал = host.pluginLogs('probe-dialog').map(l => l.text)
  const ответ = журнал.filter(l => l.startsWith('ответ:')).pop() ?? ''
  ok('плагин получил то, что ввёл человек, а не значения по умолчанию',
    ответ.includes('"имя":"стало"') && ответ.includes('"звук":true'), ответ)
  ok('окно закрылось после ответа', !document.querySelector('.pdlg-box'))

  // Отказ — это null, а не пустой объект: «отменил» и «ничего не менял» разные
  // вещи, и плагин обязан их различать.
  await host.stopPlugin('probe-dialog')
  await host.startPlugin(p)
  for (let i = 0; i < 40 && !document.querySelector('.pdlg-box'); i++) await пауза(100)
  ;(document.querySelector('.cfm-cancel') as HTMLButtonElement).click()
  await пауза(400)
  // Берём ПОСЛЕДНЮЮ запись: журнал плагина переживает его перезапуск, и первая
  // строка тут — ответ из прошлого окна.
  const ответ2 = host.pluginLogs('probe-dialog').map(l => l.text).filter(l => l.startsWith('ответ:')).pop() ?? ''
  ok('отказ приходит как null', ответ2 === 'ответ:null', ответ2)

  await host.stopPlugin('probe-dialog')
  removePlugin('probe-dialog')
}


/**
 * Перехват вложений (v1.475.0) — официальным плагином «Чистка фотографий».
 *
 * Проверяется то, ради чего он и сделан: из фотографии пропадает геометка, а
 * картинка остаётся картинкой. Метку EXIF мы вставляем сами — иначе проверять
 * было бы нечего, и «работает» означало бы «ничего не сломалось».
 */
async function перехватВложений(host: Awaited<ReturnType<typeof ensureHost>>) {
  const чистка = OFFICIAL_PLUGINS.find(p => p.id === 'ponoi-photo-clean')!
  const m = parsePlugin(чистка.code)
  ok('плагин чистки просит перехват вложений', m.permissions.includes('messages.upload' as never),
    m.permissions.join(','))

  const p: any = {
    manifest: m, code: чистка.code, enabled: true,
    installedAt: new Date().toISOString(), sourceUserId: null, storage: {},
  }
  upsertPlugin(p)
  await host.startPlugin(p)
  await пауза(400)
  ok('плагин чистки запустился', !host.pluginError('ponoi-photo-clean'),
    String(host.pluginError('ponoi-photo-clean')))

  // Настоящая картинка → настоящий JPEG.
  const c = document.createElement('canvas')
  c.width = 60; c.height = 40
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c02020'; ctx.fillRect(0, 0, 60, 40)
  ctx.fillStyle = '#2040c0'; ctx.fillRect(10, 10, 20, 20)
  const jpeg = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/jpeg', 0.95))
  const голый = new Uint8Array(await jpeg.arrayBuffer())

  // Вставляем блок EXIF с «геометкой» сразу после начала файла — так он и
  // лежит в снимке с телефона.
  const метка = new TextEncoder().encode('Exif\0\0MakeApple GPSLatitude 55.75')
  const app1 = new Uint8Array(4 + метка.length)
  app1[0] = 0xff; app1[1] = 0xe1
  app1[2] = ((метка.length + 2) >> 8) & 0xff; app1[3] = (метка.length + 2) & 0xff
  app1.set(метка, 4)
  const сЭкзифом = new Uint8Array(голый.length + app1.length)
  сЭкзифом.set(голый.slice(0, 2), 0)
  сЭкзифом.set(app1, 2)
  сЭкзифом.set(голый.slice(2), 2 + app1.length)

  const есть = (b: Uint8Array) => new TextDecoder('latin1').decode(b).includes('GPSLatitude')
  ok('в подготовленной фотографии геометка правда есть', есть(сЭкзифом))

  const файл = new File([сЭкзифом], 'фото.jpg', { type: 'image/jpeg' })
  const r = await host.runUploadHooksHere(файл)
  ok('отправку не отменили', !r.cancel)
  const после = new Uint8Array(await r.file.arrayBuffer())
  ok('геометка из фотографии пропала', !есть(после),
    `было ${сЭкзифом.length} Б, стало ${после.length} Б`)
  ok('это по-прежнему картинка, а не мусор',
    после[0] === 0xff && после[1] === 0xd8 && (await createImageBitmap(new Blob([после]))).width === 60)

  // Чужие файлы плагин трогать не должен.
  const текст = new File([new TextEncoder().encode('просто текст')], 'з.txt', { type: 'text/plain' })
  const r2 = await host.runUploadHooksHere(текст)
  ok('файл не своего вида остаётся нетронутым', r2.file === текст && !r2.cancel)

  // Без единого перехватчика путь обязан остаться прежним — это про всех, у
  // кого плагинов нет вовсе.
  await host.stopPlugin('ponoi-photo-clean')
  const r3 = await host.runUploadHooksHere(файл)
  ok('без плагинов файл идёт тем же путём, что и раньше', r3.file === файл && !r3.cancel)

  removePlugin('ponoi-photo-clean')
}

main().catch(e => {
  lines.push('УПАЛО: ' + (e?.message ?? e))
  out()
  ;(window as any).__failed = 1
  ;(window as any).__done = true
})
