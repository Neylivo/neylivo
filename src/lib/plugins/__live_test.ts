// v1.473.0: живые проверки системы плагинов. Запуск: npm run test:live
//
// Почему отдельно от npm run test:plugins. Тот бежит в Node, а здесь нужен
// настоящий браузер: IndexedDB, Blob, Worker, кадры экрана. Всё, что интересно
// в этом коде, происходит на стыке с ними, и чистыми функциями там не
// проверить ничего — ни что байты вернулись теми же, ни что чужой плагин
// своих файлов не видит, ни что опрос геймпада правда идёт кадрами.
//
// Проверяется не «работает ли хорошее», а в том числе и то, что плохое
// отказывает: чужое имя, разметка под видом картинки, переполнение места.
//
// Что здесь есть:
//   1–8  — свои файлы плагина: хранение, опознание, пределы, уборка;
//   9    — весь путь целиком: настоящая песочница → диспетчер → база → обратно;
//   10   — геймпад: настоящие кадры и поддельное устройство вместо железа.

import {
  assetPut, assetGet, assetInfo, assetList, assetRemove, assetClear, assetUsage,
  assetUrl, clearAssetUrls, assetUrlCount, MAX_ASSETS, MAX_ASSET_BYTES,
} from './assets'
import {
  watchGamepads, unwatchGamepads, unwatchAllGamepads, setGamepadEmit,
  gamepadsWatching, readPads, type PadEvent,
} from './gamepads'

const lines: string[] = []
let failed = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  lines.push(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
  paint()
}
const paint = () => { document.getElementById('out')!.textContent = lines.join('\n') }

async function mustThrow(name: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(name, false, 'прошло, хотя должно быть отвергнуто') }
  catch { ok(name, true) }
}

/** Настоящий PNG 1×1 — не выдумка из байтов, а файл, который правда рисуется. */
const PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
), c => c.charCodeAt(0))

/** Настоящий WAV — короткая тишина. Нужен, чтобы проверить, что звук
 *  опознаётся звуком, а не «неизвестным». */
function WAV(): Uint8Array {
  const данных = 64
  const b = new Uint8Array(44 + данных)
  const dv = new DataView(b.buffer)
  const пиши = (at: number, s: string) => { for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i) }
  пиши(0, 'RIFF'); dv.setUint32(4, 36 + данных, true); пиши(8, 'WAVE')
  пиши(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true)
  пиши(36, 'data'); dv.setUint32(40, данных, true)
  return b
}

async function main() {
  // Чистое начало: база переживает прогоны, и вчерашние файлы испортили бы счёт.
  await assetClear('probe')
  await assetClear('probe2')

  // ---- 1. Байты возвращаются теми же ---------------------------------------
  const инфо = await assetPut('probe', 'sprite.png', PNG.buffer)
  ok('картинка опознана картинкой', инфо.type === 'image/png' && инфо.kind === 'image', инфо.type)
  ok('размер запомнен настоящий', инфо.size === PNG.byteLength, String(инфо.size))

  const назад = await assetGet('probe', 'sprite.png')
  const те_же = назад !== null && new Uint8Array(назад).every((b, i) => b === PNG[i])
    && назад.byteLength === PNG.byteLength
  ok('байты вернулись ровно те же', те_же)

  // ---- 2. Файл правда рисуется ---------------------------------------------
  //
  // Это и есть смысл всей затеи: «сохранилось» без «показалось» ничего не
  // стоит. Картинка проходит весь путь — база, адрес, декодер браузера.
  const url = await assetUrl('probe', 'sprite.png')
  ok('адрес выдан приложением', !!url && url.startsWith('blob:'), String(url))
  const bmp = await createImageBitmap(new Blob([назад!]))
  ok('браузер разобрал картинку', bmp.width === 1 && bmp.height === 1, `${bmp.width}×${bmp.height}`)

  const холст = document.createElement('canvas')
  холст.width = 4; холст.height = 4
  const ctx = холст.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, 4, 4)
  ok('картинка нарисовалась на холсте', ctx.getImageData(0, 0, 1, 1).data[3] > 0)

  // ---- 3. Один и тот же адрес, а не новый на каждый показ -------------------
  const снова = await assetUrl('probe', 'sprite.png')
  ok('адрес не плодится на каждую перерисовку', снова === url)

  // ---- 4. Звук, текст и JSON ------------------------------------------------
  const звук = await assetPut('probe', 'blip.wav', WAV().buffer)
  ok('звук опознан звуком', звук.kind === 'audio' && звук.type === 'audio/wav', звук.type)
  const json = await assetPut('probe', 'level.json', JSON.stringify({ уровень: 1, враги: ['слизь'] }))
  ok('JSON опознан данными', json.type === 'application/json', json.type)
  const прочитан = await assetGet('probe', 'level.json')
  ok('JSON читается обратно тем же',
    JSON.parse(new TextDecoder().decode(прочитан!)).враги[0] === 'слизь')

  // ---- 5. Чего быть не должно ----------------------------------------------
  await mustThrow('разметка не сохраняется, как её ни назови', () =>
    assetPut('probe', 'sprite2.png', '<svg onload="alert(1)"></svg>'))
  await mustThrow('двоичный мусор не сохраняется под видом данных', () =>
    assetPut('probe', 'мусор.bin', new Uint8Array([3, 4, 5, 6, 7]).buffer))
  await mustThrow('пустой файл — отказ', () => assetPut('probe', 'zero.png', new ArrayBuffer(0)))
  await mustThrow('чужое имя не проходит', () => assetPut('probe', '../чужое.png', PNG.buffer))
  await mustThrow('файл больше предела не проходит', () =>
    assetPut('probe', 'big.png', new Uint8Array(MAX_ASSET_BYTES + 1).fill(0x89).buffer))

  // ---- 6. Чужого не видно ---------------------------------------------------
  await assetPut('probe2', 'sprite.png', WAV().buffer)
  const мой = await assetInfo('probe', 'sprite.png')
  const чужой = await assetInfo('probe2', 'sprite.png')
  ok('одно имя у двух плагинов — два разных файла',
    мой!.type === 'image/png' && чужой!.type === 'audio/wav')
  const список = await assetList('probe')
  ok('в списке только свои файлы',
    !список.some(a => a.name === 'нет') && список.length === 3, String(список.length))
  const usage = await assetUsage('probe2')
  ok('место считается по своим файлам', usage.count === 1 && usage.bytes === WAV().byteLength)

  // ---- 7. Перезапись и уборка ----------------------------------------------
  const до = (await assetUsage('probe')).bytes
  const старый = (await assetInfo('probe', 'level.json'))!.size
  const новое = JSON.stringify({ уровень: 2 })
  const новый = await assetPut('probe', 'level.json', новое)
  const после = (await assetUsage('probe')).bytes
  ok('перезапись не плодит второй файл', (await assetList('probe')).length === 3)
  // Место обязано сойтись до байта: считай мы старый размер за занятое,
  // плагин упирался бы в предел, обновляя один и тот же файл.
  ok('место после перезаписи сошлось до байта',
    после === до - старый + новый.size, `${до} − ${старый} + ${новый.size} = ${после}`)

  await assetUrl('probe', 'blip.wav')
  const адресов = assetUrlCount()
  clearAssetUrls('probe')
  ok('адреса отзываются вместе с выключенным плагином',
    адресов > 0 && assetUrlCount() === 0, `было ${адресов}`)

  ok('убрать можно свой файл', await assetRemove('probe', 'blip.wav') === true)
  ok('несуществующий файл — не ошибка, а «нет такого»',
    await assetRemove('probe', 'ne-tu.png') === false)

  const сколько = await assetClear('probe')
  ok('уборка убирает всё своё и только своё',
    сколько === 2 && (await assetList('probe')).length === 0
    && (await assetList('probe2')).length === 1, String(сколько))
  await assetClear('probe2')

  // ---- 8. Предел числа файлов ----------------------------------------------
  //
  // Пятьсот записей в базу — это несколько секунд, и это нормально: предел,
  // который не проверен, однажды окажется не тем числом.
  // v1.481.0: предел подняли с 500 до 5000 — заполнять его целиком проба
  // больше не может, она на этом зависала. Проверяем то, что осталось важным
  // и проверяемым: сотни файлов кладутся и считаются верно, а перезапись
  // существующего не считается за прибавку.
  const СКОЛЬКО = 300
  for (let i = 0; i < СКОЛЬКО; i++) await assetPut('probe', 'f' + i + '.json', '{"n":' + i + '}')
  const много = await assetUsage('probe')
  ok('сотни файлов кладутся и считаются', много.count === СКОЛЬКО, String(много.count))
  await assetPut('probe', 'f0.json', '{"n":0,"снова":true}')
  ok('перезапись не увеличивает число файлов',
    (await assetUsage('probe')).count === СКОЛЬКО, String((await assetUsage('probe')).count))
  await assetClear('probe')

  // ---- 9. ВЕСЬ ПУТЬ: настоящая песочница → диспетчер → база → обратно ------
  //
  // Всё выше зовёт assets.ts напрямую, то есть проверяет хранилище, но не
  // ДОРОГУ до него. А дорога здесь самая хрупкая: байты едут из воркера через
  // postMessage, и упаковщик доводов раньше разбирал любой объект по полям —
  // ArrayBuffer от этого молча превращался в пустышку. Ловится только так.
  await живьём()

  // ---- 10. Геймпад настоящими кадрами --------------------------------------
  await геймпад()

  lines.push('')
  lines.push(`ИТОГ: пройдено ${lines.filter(l => l.startsWith('OK')).length}, провалено ${failed}`)
  paint()
  ;(window as any).__failed = failed
  ;(window as any).__done = true
}

/** Настоящий плагин в настоящем воркере — и настоящий диспетчер приложения. */
async function живьём() {
  const [{ createDispatcher }, { PluginSandbox }, { upsertPlugin, removePlugin }, { getRegistry }] = await Promise.all([
    import('./api'), import('./sandbox'), import('./store'), import('./registry'),
  ])
  await assetClear('probe-live')

  // Настоящий PNG 2×2: первый пиксель красный. Пиксель и проверяем — «файл
  // сохранился» без «картинка нарисовалась» не значит ничего.
  const КОД = `
function onLoad(ponoi) {
  var b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8AAQv/BJIgBAEPOB/lhwfRKAAAAAElFTkSuQmCC'
  var bin = atob(b64)
  var bytes = new Uint8Array(bin.length)
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

  ponoi.assets.put('спрайт.png', bytes).then(function (info) {
    ponoi.log('положил:' + info.type + ':' + info.size)
    return ponoi.assets.get('спрайт.png')
  }).then(function (buf) {
    ponoi.log('назад:' + (buf && buf.byteLength) + ':' + (buf instanceof ArrayBuffer))
    return ponoi.assets.image('спрайт.png')
  }).then(function (bmp) {
    var c = new OffscreenCanvas(2, 2)
    var ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    var p = ctx.getImageData(0, 0, 1, 1).data
    ponoi.log('картинка:' + bmp.width + 'x' + bmp.height + ':' + p[0] + ',' + p[1] + ',' + p[2] + ',' + p[3])
    return ponoi.assets.put('данные.json', JSON.stringify({ уровень: 7 }))
  }).then(function () {
    return ponoi.assets.text('данные.json')
  }).then(function (t) {
    ponoi.log('текст:' + t)
    return ponoi.ui.addPanel({ slot: 'player', title: 'Проба', rows: [
      { type: 'image', key: 'pic', label: 'Спрайт', value: 'asset:спрайт.png' },
      { type: 'image', key: 'bad', label: 'Чужое', value: 'blob:https://ponoi/aaa' },
    ] })
  }).then(function () {
    return ponoi.assets.put('разметка.png', '<svg onload="alert(1)"></svg>')
  }).then(function () {
    ponoi.log('разметка:ПРОШЛА')
  }, function (e) {
    ponoi.log('разметка:' + (e.message || '').slice(0, 20))
  }).then(function () {
    // Играть картинку нечем — приложение обязано сказать это прямо, а не
    // молча ничего не сделать.
    return ponoi.assets.play('спрайт.png')
  }).then(function () {
    ponoi.log('звук-картинки:ЗАИГРАЛА')
  }, function (e) {
    ponoi.log('звук-картинки:' + (e.message || '').slice(0, 30))
  }).then(function () { ponoi.log('готово') })
}
`
  const plugin: any = {
    manifest: {
      id: 'probe-live', name: 'Проба', version: '1.0.0', author: 'я', description: '',
      permissions: ['storage', 'panel', 'ui', 'notify'], hosts: [],
    },
    code: КОД, enabled: true, installedAt: '', sourceUserId: null, storage: {},
  }
  upsertPlugin(plugin)

  const журнал: string[] = []
  const dispatch = createDispatcher(plugin, { sendMessage: async () => {}, toast: () => {} } as any, () => {})
  const sandbox = new PluginSandbox({
    onCall: async (method, args) => {
      if (method === 'log') { журнал.push(String(args[0])); return null }
      return dispatch(method, args)
    },
    onError: msg => { журнал.push('ОШИБКА:' + msg) },
  })
  await sandbox.start(КОД)
  for (let i = 0; i < 60 && !журнал.includes('готово'); i++) await new Promise(r => setTimeout(r, 200))

  const стр = (нач: string) => журнал.find(l => l.startsWith(нач)) ?? ''
  ok('плагин положил картинку прямо из песочницы', стр('положил:').includes('image/png'), стр('положил:'))
  ok('байты доехали целыми и вернулись ArrayBuffer-ом',
    /^назад:\d\d+:true$/.test(стр('назад:')), стр('назад:'))
  ok('картинка собралась и нарисовалась в песочнице',
    стр('картинка:') === 'картинка:2x2:255,0,0,255', стр('картинка:'))
  ok('текстовый файл вернулся тем же', стр('текст:').includes('"уровень":7'), стр('текст:'))
  ok('разметку не пустило и на живом пути',
    стр('разметка:').includes('Разметку'), стр('разметка:'))
  ok('картинку играть отказались, и сказано почему',
    стр('звук-картинки:').includes('image/'), стр('звук-картинки:'))
  ok('плагин не споткнулся ни разу', !журнал.some(l => l.startsWith('ОШИБКА')),
    журнал.filter(l => l.startsWith('ОШИБКА')).join(' | '))

  // Приложение видит ровно то же — а не «плагин сказал, что положил».
  const свои = await assetList('probe-live')
  ok('приложение видит те же файлы',
    свои.length === 2 && (await assetInfo('probe-live', 'спрайт.png'))!.type === 'image/png',
    JSON.stringify(свои.map(a => a.name)))

  const panel = getRegistry().panels.find(p => p.pluginId === 'probe-live')
  ok('свой файл в панель попал, чужой адрес — нет',
    (panel?.rows.length ?? 0) === 1 && (panel!.rows[0] as any).value === 'asset:спрайт.png',
    JSON.stringify(panel?.rows.map((r: any) => (r as any).value)))

  sandbox.kill()
  await assetClear('probe-live')
  // Плагин записан в localStorage, а он у file:// ОБЩИЙ со смоуком. Забудь мы
  // его убрать — смоук нашёл бы «включённый плагин» и справедливо ругался бы
  // на то, что система плагинов грузится при старте. Поймано ровно так.
  removePlugin('probe-live')
}

/**
 * Геймпад настоящими кадрами.
 *
 * Настоящего геймпада у меня нет — вместо него подставлен navigator.getGamepads,
 * который отдаёт ровно ту форму, что отдал бы браузер. Железо этим не заменить,
 * и это сказано прямо; зато проверяется то, чего не видно в чистых функциях:
 * что опрос правда идёт кадрами, что события доходят и что после отписки кадры
 * ПРЕКРАЩАЮТСЯ — забытый опрос это севшая батарея у всех.
 */
async function геймпад() {
  const пад = {
    index: 0, id: 'Проба Pad (Vendor: 0000)', connected: true,
    buttons: [{ pressed: false, value: 0 }, { pressed: false, value: 0 }], axes: [0, 0],
  }
  let подключён = true
  const прежний = (navigator as any).getGamepads
  ;(navigator as any).getGamepads = () => (подключён ? [пад] : [])

  const пришло: PadEvent[] = []
  setGamepadEmit(ev => { пришло.push(ev) })
  const кадры = (n: number) => new Promise<void>(r => {
    let i = 0
    const шаг = () => { if (++i >= n) r(); else requestAnimationFrame(шаг) }
    requestAnimationFrame(шаг)
  })

  try {
    ok('подставленный геймпад читается', readPads().length === 1 && readPads()[0].buttons.length === 2)

    watchGamepads('игра')
    await кадры(3)
    ok('уже подключённый геймпад не объявляется «подключённым»', пришло.length === 0,
      JSON.stringify(пришло))

    пад.buttons[0] = { pressed: true, value: 1 }
    await кадры(3)
    ok('нажатие дошло само, без опроса из плагина',
      пришло.some(e => e.kind === 'button' && e.which === 0 && e.pressed === true))

    const было = пришло.length
    await кадры(5)
    ok('удержание не шлёт событие каждый кадр', пришло.length === было, `${было} → ${пришло.length}`)

    пад.buttons[0] = { pressed: false, value: 0 }
    пад.axes[0] = 0.9
    await кадры(3)
    ok('отпускание и ручка доходят',
      пришло.some(e => e.kind === 'button' && e.pressed === false)
      && пришло.some(e => e.kind === 'axis' && (e.value ?? 0) > 0.5))

    пад.axes[0] = 0.905
    const до = пришло.length
    await кадры(4)
    ok('дрожание ручки на сотую молчит', пришло.length === до)

    подключён = false
    await кадры(3)
    ok('отключение замечено', пришло.some(e => e.kind === 'disconnect'))

    unwatchGamepads('игра')
    подключён = true
    пад.buttons[1] = { pressed: true, value: 1 }
    const итог = пришло.length
    await кадры(6)
    ok('после отписки опрос прекращается совсем',
      gamepadsWatching() === 0 && пришло.length === итог, `${итог} → ${пришло.length}`)
  } finally {
    unwatchAllGamepads()
    setGamepadEmit(null)
    ;(navigator as any).getGamepads = прежний
  }
}

main().catch(e => {
  lines.push('УПАЛО: ' + (e?.message ?? e))
  paint()
  ;(window as any).__failed = 1
  ;(window as any).__done = true
})
