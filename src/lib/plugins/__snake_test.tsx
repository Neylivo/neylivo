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

  createRoot(document.getElementById('root')!).render(<PluginApps />)
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

  lines.push('')
  lines.push('журнал: ' + журнал.join(' / '))
  lines.push(`ИТОГ страницы: пройдено ${lines.filter(l => l.startsWith('OK')).length}, провалено ${failed}`)
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
