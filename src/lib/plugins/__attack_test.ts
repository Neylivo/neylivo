// v1.345.0: попытки сломать приложение изнутри плагина.
//
// Это не проверка «работает ли хорошее» — это проверка «выдерживает ли плохое».
// Плагин ставит человек, доверяя описанию; вредный или просто кривой плагин не
// должен уметь испортить приложение так, чтобы человек не смог его выключить.
//
// Атаки идут через НАСТОЯЩИЙ createDispatcher из api.ts — тот самый, который
// обслуживает живую песочницу. Заглушки только там, где нужен браузер.
//
// Запуск: npm run test:attack
export {}

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
}
;(globalThis as any).window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
;(globalThis as any).document = {
  head: { appendChild: () => {} }, body: { appendChild: () => {} },
  createElement: () => ({ style: {}, dataset: {}, setAttribute: () => {}, remove: () => {}, textContent: '' }),
  getElementById: () => null, querySelector: () => null,
}
;(globalThis as any).location = { hostname: 'ponoi.app' }
;(globalThis as any).fetch = async () => ({ ok: true, status: 200, text: async () => 'ok' })

const { createDispatcher } = await import('./api')
const registry = await import('./registry')
const { upsertPlugin, loadPlugins } = await import('./store')
const { ALL_PERMISSIONS, PLUGIN_EVENTS } = await import('./types')

let pass = 0, fail = 0
const ok = (n: string) => { pass++; console.log('OK   ' + n) }
const bad = (n: string, why?: string) => { fail++; console.log('ПРОБИЛ ' + n + (why ? ' — ' + why : '')) }
async function check(name: string, fn: () => boolean | Promise<boolean>) {
  try { const r = await fn(); if (r === false) bad(name); else ok(name) }
  catch (e: any) { bad(name, e?.message ?? String(e)) }
}
/** Атака должна быть отбита — то есть вызвать отказ. */
async function blocked(name: string, fn: () => Promise<unknown>) {
  try { await fn(); bad(name, 'прошло, хотя должно быть отвергнуто') }
  catch { ok(name) }
}

/** Действие, наоборот, должно пройти: иначе проверка «всё запрещено» ничего не значит. */
async function allowed(name: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(name) }
  catch (e: any) { bad(name, 'отвергнуто, хотя должно проходить: ' + (e?.message ?? e)) }
}

const sent: string[] = []
const toasts: string[] = []

function attacker(perms: string[] = [...ALL_PERMISSIONS], id = 'evil') {
  const plugin: any = {
    manifest: { id, name: 'Вредный', version: '1.0.0', author: 'кто-то', description: '', permissions: perms, hosts: ['evil.example'] },
    code: '', enabled: true, installedAt: '', sourceUserId: null, storage: {},
  }
  upsertPlugin(plugin)
  return createDispatcher(plugin, {
    sendMessage: async (t: string) => { sent.push(t) },
    toast: (t: string) => { toasts.push(t) },
  }, () => {})
}

const fn = { __fn: 'f1' } as any

console.log('── Разрешения ──')
{
  // Плагин без прав не должен уметь ничего из того, что их требует.
  const d = attacker([], 'no-perms')
  await blocked('без права нельзя отправить сообщение', () => d('messages.send', ['спам']))
  await blocked('без права нельзя добавить кнопку', () => d('ui.addComposerButton', [{ key: 'k', tooltip: 't', onClick: fn }]))
  await blocked('без права нельзя поставить css', () => d('css', ['body{display:none}']))
  await blocked('без права нельзя ходить в сеть', () => d('net.fetch', ['https://evil.example/x']))
  await blocked('без права нельзя читать сообщения', () => d('subscribe', ['message']))
  await blocked('без права нет уведомлений', () => d('notify', ['бум']))
  await blocked('без права нет хранилища', () => d('storage.set', ['k', 'v']))
  await blocked('несуществующий метод отвергается', () => d('внутренности.дай', []))
}

console.log('\n── Панель в приложении и музыка (v1.417.0) ──')
{
  const none = attacker([], 'no-perms-new')
  await blocked('без права нельзя поставить панель', () =>
    none('ui.addPanel', [{ slot: 'player', title: 'Т', rows: [] }]))
  await blocked('без права нельзя узнать, что играет', () => none('music.now', []))
  await blocked('без права нельзя увидеть Трекотеку', () => none('music.library', []))
  await blocked('без права нельзя нажать паузу', () => none('music.pause', []))
  await blocked('без права нельзя добавить трек', () => none('music.add', ['https://example.com/a.mp3']))

  const all = attacker([...ALL_PERMISSIONS], 'all-perms-new')
  await blocked('панель в выдуманном месте не ставится', () =>
    all('ui.addPanel', [{ slot: 'везде', title: 'Т', rows: [] }]))
  await blocked('панель без места не ставится', () => all('ui.addPanel', [{ title: 'Т', rows: [] }]))
  await allowed('панель в известном месте ставится', () =>
    all('ui.addPanel', [{ slot: 'player', title: 'Мой уголок', rows: [] }]))

  await check('в панель попадают только известные строки', async () => {
    // Всё лишнее пересобирается поштучно, а не пропускается как есть: строка с
    // чужим типом — это попытка нарисовать в окне что-то своё.
    await all('ui.addPanel', [{ slot: 'library', title: 'Т', rows: [
      { type: 'toggle', key: 'a', label: 'Норм', value: true },
      { type: 'html', key: 'b', label: '<img src=x onerror=alert(1)>' },
      { type: 'button', key: 'c', label: 'Кнопка' },
    ] }] )
    const reg2 = await import('./registry')
    const panel = reg2.getRegistry().panels.find((x: any) => x.slot === 'library')
    // Осталась одна строка: у 'html' нет такого вида, у кнопки нет обработчика.
    return !!panel && panel.rows.length === 1 && panel.rows[0].type === 'toggle'
  })

  await check('одно место — не больше трёх панелей', async () => {
    const a1 = attacker([...ALL_PERMISSIONS], 'p1')
    const a2 = attacker([...ALL_PERMISSIONS], 'p2')
    const a3 = attacker([...ALL_PERMISSIONS], 'p3')
    const a4 = attacker([...ALL_PERMISSIONS], 'p4')
    for (const [i, d] of [a1, a2, a3].entries()) {
      await d('ui.addPanel', [{ slot: 'sidebar', title: 'П' + i, rows: [] }])
    }
    try { await a4('ui.addPanel', [{ slot: 'sidebar', title: 'П4', rows: [] }]); return false }
    catch { return true }
  })

  await check('чужую панель своим id не подменить', async () => {
    const мой = attacker([...ALL_PERMISSIONS], 'мой')
    const чужой = attacker([...ALL_PERMISSIONS], 'чужой')
    await мой('ui.addPanel', [{ slot: 'player', title: 'Моя', rows: [] }])
    await чужой('ui.addPanel', [{ slot: 'player', title: 'Чужая', rows: [] }])
    const reg2 = await import('./registry')
    const мои = reg2.getRegistry().panels.filter((x: any) => x.pluginId === 'мой' && x.slot === 'player')
    return мои.length === 1 && мои[0].title === 'Моя'
  })
}

console.log('\n── События ──')
{
  // v1.397.0: событий стало семь вместо одного. Опасность ровно в том, что новое
  // событие легко завести мимо разрешения — тогда «плагин без прав» тихо начнёт
  // получать переписку. Поэтому проверяется КАЖДОЕ событие из таблицы, а не
  // список, переписанный сюда руками: допишут восьмое — оно проверится само.
  const none = attacker([], 'no-perms-ev')
  for (const [name, spec] of Object.entries(PLUGIN_EVENTS)) {
    if (!spec.permission) continue
    await blocked(`без права нельзя подписаться на «${name}»`, () => none('subscribe', [name]))
  }

  const all = attacker([...ALL_PERMISSIONS], 'all-perms-ev')
  for (const name of Object.keys(PLUGIN_EVENTS)) {
    await allowed(`с правами подписка на «${name}» проходит`, () => all('subscribe', [name]))
  }

  await blocked('на выдуманное событие подписаться нельзя', () => all('subscribe', ['всё.подряд']))
  await blocked('пустое имя события тоже не проходит', () => all('subscribe', ['']))

  // Разрешение у события должно быть то самое, а не «любое из выданных»: с одним
  // лишь context нельзя подписаться на сообщения.
  const ctxOnly = attacker(['context'], 'ctx-only')
  await blocked('context не открывает сообщения', () => ctxOnly('subscribe', ['message']))
  await allowed('context открывает смену канала', () => ctxOnly('subscribe', ['channel']))
}

console.log('\n── Сеть ──')
{
  const d = attacker()
  await blocked('чужой домен не пустят', () => d('net.fetch', ['https://not-declared.example/x']))
  await blocked('к самому приложению ходить нельзя', () => d('net.fetch', ['https://ponoi.app/api']))
  await blocked('http без шифрования не пустят', () => d('net.fetch', ['http://evil.example/x']))
  await blocked('file:// не пустят', () => d('net.fetch', ['file:///etc/passwd']))
  await blocked('чужой метод не пустят', () => d('net.fetch', ['https://evil.example/x', { method: 'DELETE' }]))
}

console.log('\n── Наводнение интерфейса ──')
{
  const d = attacker()
  const before = registry.getRegistry().composerButtons.length
  let err = ''
  try { for (let i = 0; i < 5000; i++) await d('ui.addComposerButton', [{ key: 'k' + i, tooltip: 'x', onClick: fn }]) }
  catch (e: any) { err = String(e?.message ?? e) }
  const added = registry.getRegistry().composerButtons.length - before
  await check(`кнопок композера не больше разумного (добавлено ${added}${err ? ', отказ: ' + err.slice(0, 40) : ''})`,
    () => added <= 20)
}
{
  const d = attacker([...ALL_PERMISSIONS], 'evil2')
  let err = ''
  const before = registry.getRegistry().commands.length
  try { for (let i = 0; i < 3000; i++) await d('commands.register', ['ко' + i, 'опис', fn]) }
  catch (e: any) { err = String(e?.message ?? e) }
  const added = registry.getRegistry().commands.length - before
  await check(`команд не больше разумного (добавлено ${added}${err ? ', отказ: ' + err.slice(0, 40) : ''})`,
    () => added <= 30)
}
{
  const d = attacker([...ALL_PERMISSIONS], 'evil3')
  let err = ''
  const before = registry.getRegistry().messageActions.length
  try { for (let i = 0; i < 3000; i++) await d('ui.addMessageAction', [{ key: 'a' + i, label: 'x', onClick: fn }]) }
  catch (e: any) { err = String(e?.message ?? e) }
  const added = registry.getRegistry().messageActions.length - before
  await check(`действий над сообщением не больше разумного (добавлено ${added})`, () => added <= 20)
}

console.log('\n── Наводнение чатом и уведомлениями ──')
{
  const d = attacker([...ALL_PERMISSIONS], 'evil4')
  sent.length = 0
  let err = ''
  try { for (let i = 0; i < 200; i++) await d('messages.send', ['спам ' + i]) }
  catch (e: any) { err = String(e?.message ?? e) }
  await check(`нельзя залить чат сотнями сообщений (ушло ${sent.length}${err ? ', отказ: ' + err.slice(0, 40) : ''})`,
    () => sent.length <= 30)
}
{
  const d = attacker([...ALL_PERMISSIONS], 'evil5')
  toasts.length = 0
  try { for (let i = 0; i < 500; i++) await d('notify', ['бум ' + i]) } catch { /* отказ — тоже защита */ }
  await check(`нельзя завалить экран уведомлениями (показано ${toasts.length})`, () => toasts.length <= 30)
}

console.log('\n── Оформление ──')
{
  const d = attacker([...ALL_PERMISSIONS], 'evil6')
  await blocked('гигантский css не примут', () => d('css', ['a{}'.repeat(200000)]))
  // Накрыть приложение непрозрачным слоем и не дать до него добраться — самый
  // простой способ сделать Ponoi неработающим, при этом «легальными» средствами.
  await check('после вредного css остаётся способ его снять', async () => {
    await d('css', ['*{display:none!important}'])
    const mod = await import('./registry')
    // Аварийный режим обязан отключать оформление плагинов целиком.
    return typeof (mod as any).setPluginsDisabled === 'function'
  })
}

console.log('\n── Хранилище ──')
{
  const d = attacker([...ALL_PERMISSIONS], 'evil7')
  await blocked('огромное значение в хранилище не влезет', () => d('storage.set', ['k', 'я'.repeat(200000)]))
}

console.log('\n── Чужое ──')
{
  const a = attacker([...ALL_PERMISSIONS], 'plug-a')
  const b = attacker([...ALL_PERMISSIONS], 'plug-b')
  await a('commands.register', ['занято', 'моя', fn])
  await blocked('чужую команду не перехватить', () => b('commands.register', ['занято', 'подмена', fn]))
  await check('чужое хранилище не прочитать', async () => {
    await a('storage.set', ['секрет', 'мой'])
    const got = await b('storage.get', ['секрет'])
    return got === null
  })
}

console.log(`\nИТОГ: пройдено ${pass}, пробито ${fail}`)
process.exit(fail ? 1 : 0)
