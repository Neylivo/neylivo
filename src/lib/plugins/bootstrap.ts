// v1.286.0: код, который выполняется ВНУТРИ Worker'а плагина. Живёт строкой, а не
// отдельным модулем, потому что воркер поднимается из Blob-URL: так гарантируется,
// что рядом с кодом плагина не окажется ничего из бандла приложения (ни supabase,
// ни наших модулей), а только то, что написано здесь.
//
// Задача этого файла — снять с воркера всё, чем можно дотянуться наружу, и оставить
// плагину единственный канал связи: объект ponoi поверх postMessage.

export const WORKER_BOOTSTRAP = String.raw`
'use strict'
;(function () {

// ---- 1. Отключаем всё, чем можно выйти за пределы песочницы --------------------
//
// Worker и так не видит localStorage (там лежит сессия Supabase), document.cookie и
// DOM — это гарантия браузера. Здесь убираем то, что браузер воркеру всё-таки даёт:
//
//   Worker/SharedWorker — САМОЕ важное. Вложенный воркер получил бы свежую область
//     видимости, где ничего из этого списка не вырезано, и вся песочница потеряла бы
//     смысл. Всё остальное ниже держится на том, что этих двух здесь нет.
//   importScripts    — подгрузка постороннего кода в обход файла, который человек видел.
//   fetch/XHR/WS/SSE — сеть напрямую; вместо неё ponoi.net.fetch с проверкой домена.
//   indexedDB/caches — тот же origin, что у приложения (в ponoiMedia лежат вложения).
//   sendBeacon       — тихая отправка данных, обходит любые проверки сети.
const KILL = [
  'Worker', 'SharedWorker', 'importScripts',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'indexedDB', 'caches', 'openDatabase',
]
for (const k of KILL) {
  try { delete self[k] } catch (e) {}
  // Часть из них — неудаляемые свойства прототипа: перекрываем собственным полем,
  // которое честно объясняет, почему не работает, вместо «undefined is not a function».
  try {
    Object.defineProperty(self, k, {
      configurable: false, enumerable: false,
      get() { throw new Error(k + ' недоступен плагинам: код выполняется в песочнице. Всё, что можно, доступно через объект ponoi (сеть — ponoi.net.fetch, хранилище — ponoi.storage).') },
    })
  } catch (e) {}
}
try { Object.defineProperty(self.navigator, 'sendBeacon', { value: undefined, configurable: false }) } catch (e) {}

// ---- 2. Мост с приложением -----------------------------------------------------
let seq = 0
const pending = new Map()        // id вызова -> {resolve, reject}
const callbacks = new Map()      // handle -> функция плагина
let cbSeq = 0

// Функции нельзя передать через postMessage, поэтому при отправке аргументов каждая
// функция заменяется меткой {__fn: handle}; когда приложению нужно её вызвать (клик
// по кнопке плагина и т.п.), оно шлёт 'invoke' с этой меткой обратно.
function packArgs(v, depth) {
  depth = depth || 0
  if (depth > 8) return null
  if (typeof v === 'function') {
    const h = 'cb' + (++cbSeq)
    callbacks.set(h, v)
    return { __fn: h }
  }
  if (Array.isArray(v)) return v.map(x => packArgs(x, depth + 1))
  // v1.473.0: двоичное едет как есть. Разбирать его по полям нельзя: у
  // ArrayBuffer своих полей нет вовсе, и картинка, отданная в ponoi.assets.put,
  // приезжала бы в приложение пустым объектом — то есть молча портилась.
  // postMessage такие значения умеет копировать сам.
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (typeof Blob !== 'undefined' && v instanceof Blob)) return v
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) out[k] = packArgs(v[k], depth + 1)
    return out
  }
  return v
}

function call(method, args) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    self.postMessage({ k: 'call', id: id, method: method, args: packArgs(args) })
  })
}

// ---- 3. Объект ponoi, который видит плагин -------------------------------------
// Тонкая обёртка: вся настоящая логика и все проверки разрешений — на стороне
// приложения (src/lib/plugins/api.ts). Здесь ничего не решается, чтобы плагину
// нечего было обходить.
const listeners = new Map()      // имя события -> [обработчики]

const fmt = (a) => a.map(x => {
  try { return typeof x === 'string' ? x : JSON.stringify(x) } catch (e) { return String(x) }
}).join(' ')

const ponoi = {
  css: (text) => call('css', [String(text)]),
  ui: {
    addComposerButton: (opt) => call('ui.addComposerButton', [opt]),
    addMessageAction: (opt) => call('ui.addMessageAction', [opt]),
    addSettingsPage: (opt) => call('ui.addSettingsPage', [opt]),
    // v1.417.0: своя панель в плеере, Трекотеке или колонке слева.
    addPanel: (opt) => call('ui.addPanel', [opt]),
    // v1.419.0: горячая клавиша. Сочетание обязано быть с двумя модификаторами
    // (Ctrl+Shift+K и подобные) — иначе плагин молча отобрал бы у человека
    // обычную букву.
    addHotkey: (opt) => call('ui.addHotkey', [opt]),
    // Окно рисует приложение, плагин получает только ответ: своё окно он подделал
    // бы под любое окно Ponoi, а спросить пароль «от имени приложения» нельзя.
    confirm: (opt) => call('ui.confirm', [opt || {}]),
    prompt: (opt) => call('ui.prompt', [opt || {}]),
    // v1.475.0: целая форма вместо одного вопроса. Ответ — объект со
    // значениями строк, либо null, если человек отказался.
    dialog: (opt) => call('ui.dialog', [opt || {}]),
    // v1.465.0: свой пункт в меню по правой кнопке — сообщения, выделенного
    // текста или человека.
    addContextMenu: (opt) => call('ui.addContextMenu', [opt || {}]),
    // v1.465.0: цвета оформления. Не CSS: словарь «имя цвета → #rrggbb», список
    // имён закрытый (см. pluginTheme.ts). Вёрстку этим не сломать.
    setTheme: (colors) => call('ui.setTheme', [colors || {}]),
    clearTheme: () => call('ui.clearTheme', []),
    // v1.465.0: холст панели. Возвращает НАСТОЯЩИЙ OffscreenCanvas — он не
    // копируется, а передаётся сюда, поэтому дальше работает обычный
    // getContext('2d'|'webgl') и всё, что к нему прилагается.
    //
    // Строку { type: 'canvas', key: '…' } надо сперва объявить в панели: холст
    // живёт в ней, и без неё показывать его негде.
    getCanvas: (key) => call('ui.getCanvas', [String(key)]),
    // v1.467.0: своя кнопка в шапке приложения — единственном месте, которое
    // видно на любом экране.
    addHeaderButton: (opt) => call('ui.addHeaderButton', [opt || {}]),
  },
  // v1.467.0: настройки одним объявлением. Возвращает текущие значения — уже с
  // подставленными значениями по умолчанию, так что читать их по одному через
  // storage.get не нужно.
  settings: {
    registerSchema: (rows) => call('settings.registerSchema', [Array.isArray(rows) ? rows : []]),
  },
  // v1.471.0: своя область экрана — окно, вкладка, полный экран или маленькое
  // окошко в углу. Отличаются только полем mode. Содержимое описывается теми же
  // строками, что и панель, включая { type: 'canvas' } — через него и делается
  // всё живое: игры, редакторы, визуализаторы.
  // v1.479.0: у окна появились место, минимальный размер и запрет
  // растягивания — { x, y, width, height, minWidth, minHeight, resizable }.
  // Всё это ПРЕДЛОЖЕНИЕ: человек двигает и тянет окно как хочет, и его выбор
  // запоминается. Вернуть окно на своё место плагин не может — иначе он
  // отбирал бы у человека им же переставленное.
  apps: {
    create: (opt) => call('apps.create', [opt || {}]),
    update: (id, patch) => call('apps.update', [Number(id), patch || {}]),
    close: (id) => call('apps.close', [Number(id)]),
  },
  // v1.472.0: своё хранилище таблицами. ponoi.storage — это пары ключ-значение
  // на несколько килобайт; здесь настоящие таблицы с отбором.
  //
  // Вид записи цепочкой (table('x').where(...).get()) собирается прямо здесь: он
  // читается куда лучше, чем db.where('x', 'qty', '>', 0), а приложению всё
  // равно уходит один вызов.
  db: {
    table: (name) => ({
      insert: (row) => call('db.insert', [String(name), row]),
      get: (id) => call('db.get', [String(name), String(id)]),
      all: (limit) => call('db.all', [String(name), Number(limit) || 1000]),
      update: (id, patch) => call('db.update', [String(name), String(id), patch || {}]),
      remove: (id) => call('db.remove', [String(name), String(id)]),
      count: () => call('db.count', [String(name)]),
      clear: () => call('db.clear', [String(name)]),
      where: (field, op, value) => ({
        get: (limit) => call('db.where', [String(name), String(field), String(op), value, Number(limit) || 1000]),
      }),
    }),
    tables: () => call('db.tables', []),
  },
  // v1.473.0: свои файлы — картинки, звуки, шрифты, данные. Плагин это один
  // файл кода: спрайту, звуку и шрифту в нём места нет, и до сих пор их
  // приходилось держать на чужом сайте, откуда они однажды пропадают.
  //
  // Ссылки на файл наружу НЕ уходит: плагин знает только имя. В панели он
  // пишет { type: 'image', value: 'asset:имя' }, настоящий адрес подставляет
  // приложение при показе — своему же плагину.
  assets: {
    put: (name, data) => call('assets.put', [String(name), data]),
    // Скачать один раз и пользоваться без интернета. Отдельно от net.fetch:
    // тот отдаёт текст, а картинка, прочитанная как текст, портится навсегда.
    fetch: (name, url) => call('assets.fetch', [String(name), String(url)]),
    get: (name) => call('assets.get', [String(name)]),
    info: (name) => call('assets.info', [String(name)]),
    list: () => call('assets.list', []),
    remove: (name) => call('assets.remove', [String(name)]),
    clear: () => call('assets.clear', []),
    play: (name, volume) => call('assets.play', [String(name), volume === undefined ? 1 : Number(volume)]),
    // Готовая картинка для холста. Собирается ЗДЕСЬ, из полученных байтов:
    // createImageBitmap в воркере есть, и городить это каждому вручную незачем.
    image: async (name) => {
      const buf = await call('assets.get', [String(name)])
      if (!buf) throw new Error('Файла «' + name + '» у плагина нет')
      return await createImageBitmap(new Blob([buf]))
    },
    // Свой файл текстом — для JSON, уровней, таблиц.
    text: async (name) => {
      const buf = await call('assets.get', [String(name)])
      if (!buf) throw new Error('Файла «' + name + '» у плагина нет')
      return new TextDecoder().decode(buf)
    },
  },
  // v1.473.0: геймпад. Опрашивает приложение — у воркера getGamepads нет и быть
  // не может. Плагину уходят ИЗМЕНЕНИЯ через ponoi.on('gamepad'), а этот вызов
  // отдаёт состояние прямо сейчас: игре, которая рисует кадр, нужно именно оно.
  input: {
    gamepads: () => call('input.gamepads', []),
  },
  // v1.472.0: плагин как библиотека. register оставляет функции У СЕБЯ —
  // наружу уходят только метки, по которым приложение зовёт их обратно.
  // connect отдаёт имена методов, и объект собирается здесь же, на месте.
  services: {
    register: (name, methods) => call('services.register', [String(name), methods || {}]),
    unregister: (name) => call('services.unregister', [String(name)]),
    connect: async (name) => {
      const имена = await call('services.connect', [String(name)])
      const обёртка = {}
      for (const м of имена) {
        обёртка[м] = (arg) => call('services.call', [String(name), м, arg])
      }
      return обёртка
    },
  },
  // v1.465.0: разговор с другими плагинами. Разрешение ipc нужно ОБОИМ: и тому,
  // кто шлёт, и тому, кто подписан на событие 'ipc'.
  plugins: {
    send: (pluginId, event, data) => call('plugins.send', [String(pluginId), String(event), data]),
  },
  // v1.465.0: работа по расписанию. Отличие от обычного setInterval здесь не в
  // том, что «иначе не работало» (работало), а в том, что задачу видно человеку
  // на карточке плагина и он может её остановить. См. background.ts.
  background: {
    every: (ms, handler, label) => {
      if (typeof handler !== 'function') throw new Error('ponoi.background.every: вторым доводом нужна функция')
      return call('background.every', [Number(ms), handler, String(label || '')])
    },
    stop: (id) => call('background.stop', [Number(id)]),
  },
  clipboard: {
    write: (text) => call('clipboard.write', [String(text)]),
  },
  me: () => call('me', []),
  channel: () => call('channel', []),
  // v1.419.0: приложение вокруг. Список серверов и каналов — то же, что в
  // колонке слева; open — то же, что щёлкнуть по каналу мышью.
  servers: () => call('servers', []),
  channels: (serverId) => call('channels', [String(serverId)]),
  open: (target) => call('open', [target || {}]),
  status: {
    get: () => call('status.get', []),
    set: (text) => call('status.set', [String(text)]),
  },
  sound: {
    play: (name) => call('sound.play', [String(name || 'chime')]),
  },
  commands: {
    // v1.475.0: два вида записи. Прежний — имя, описание, обработчик. Новый —
    // один объект с доводами и подсказками; они и показываются человеку прямо
    // в поле ввода, пока он печатает.
    register: (a, description, handler) => (a && typeof a === 'object'
      ? call('commands.register', [a])
      : call('commands.register', [String(a), String(description), handler])),
  },
  messages: {
    send: (text) => call('messages.send', [String(text)]),
    // v1.419.0: то, что уже на экране, и то, что человек делает с сообщением
    // сам. Работает только с открытым чатом — тем же, куда пишет send.
    // v1.477.0: просмотрено ли моё сообщение — { at, seenLabel, on }.
    // null означает «это не личный разговор» или «отметки выключены».
    readState: () => call('messages.readState', []),
    // v1.481.0: любой канал, а не только открытый. Пересылка, ответчики,
    // разбор переписки — всё это отсюда.
    //   const каналы = await ponoi.messages.channels()
    //   const было = await ponoi.messages.in(id).recent(50)
    //   await ponoi.messages.in(id).send('привет')
    channels: () => call('messages.anyList', []),
    in: (channelId) => ({
      recent: (limit) => call('messages.anyRecent', [String(channelId), Number(limit) || 50]),
      send: (text) => call('messages.anySend', [String(channelId), String(text)]),
    }),
    recent: (limit) => call('messages.recent', [Number(limit) || 20]),
    react: (messageId, emoji) => call('messages.react', [String(messageId), String(emoji)]),
    remove: (messageId) => call('messages.remove', [String(messageId)]),
    // v1.465.0: перехватчики. Обработчик получает { content, channelId } и
    // возвращает либо строку, либо { content }, либо { cancel: true }. Вернул
    // что-то другое или упал — текст остаётся прежним: сломанный плагин не
    // должен отбирать у человека возможность написать сообщение.
    onBeforeSend: (fn) => {
      if (typeof fn !== 'function') throw new Error('ponoi.messages.onBeforeSend: нужна функция')
      return call('messages.onBeforeSend', [fn])
    },
    onBeforeRender: (fn) => {
      if (typeof fn !== 'function') throw new Error('ponoi.messages.onBeforeRender: нужна функция')
      return call('messages.onBeforeRender', [fn])
    },
    // v1.475.0: файл ДО отправки в сеть. Обработчик получает
    // { name, type, size, bytes } и возвращает { bytes }, { bytes, name, type }
    // или { cancel: true }. Вернул что-то другое или упал — файл уходит как
    // был: сломанный плагин не должен отбирать возможность отправить файл.
    onUpload: (fn) => {
      if (typeof fn !== 'function') throw new Error('ponoi.messages.onUpload: нужна функция')
      return call('messages.onUpload', [fn])
    },
  },
  storage: {
    get: (key) => call('storage.get', [String(key)]),
    set: (key, value) => call('storage.set', [String(key), value]),
    remove: (key) => call('storage.remove', [String(key)]),
    keys: () => call('storage.keys', []),
    clear: () => call('storage.clear', []),
  },
  net: {
    fetch: (url, init) => call('net.fetch', [String(url), init || {}]),
    // Разбор ответа — здесь, в песочнице: JSON.parse на стороне приложения
    // ничего бы не дал плагину сверх того, что он и так получает, а вот
    // упавший разбор чужого ответа уронил бы чужой код. Бросает понятную
    // ошибку вместо «Unexpected token < in JSON».
    json: async (url, init) => {
      const r = await call('net.fetch', [String(url), init || {}])
      try { return { ok: r.ok, status: r.status, data: JSON.parse(r.body) } }
      catch (e) { throw new Error('Ответ ' + url + ' — не JSON: ' + String(r.body).slice(0, 120)) }
    },
    // v1.447.0: ответ по кускам — то, ради чего в плагине вообще возможна своя
    // ИИ-модель. В v1.445.0 это было сделано во всём, кроме самого главного:
    // ветка диспетчера, правила, документация и штурм появились, а СЮДА метод
    // не добавили — то есть для плагина ponoi.net.stream просто не существовал.
    // Ровно тот случай, про который в этом проекте сказано: «настройка есть»
    // не значит «работает».
    stream: (url, init, onChunk) => {
      if (typeof onChunk !== 'function') throw new Error('ponoi.net.stream: третьим доводом нужна функция — ей приходят куски ответа')
      return call('net.stream', [String(url), init || {}, onChunk])
    },
    // v1.465.0: постоянное соединение. Сам сокет живёт в приложении (в песочнице
    // WebSocket вырезан вместе с fetch — иначе проверку домена можно было бы
    // обойти), плагин получает ручку с send/close и обработчиками.
    //
    // Пришедшее до того, как повесили onMessage, не теряется, а ждёт в очереди:
    // соединение открывается мгновенно, а обработчик вешают строкой ниже — без
    // очереди первые сообщения пропадали бы, и это выглядело бы как «иногда не
    // приходит».
    ws: async (url) => {
      const ждут = []
      let наСообщение = null, наЗакрытие = null, наОткрытие = null
      let закрыт = false
      const id = await call('net.ws', [String(url), {
        onOpen: () => { if (наОткрытие) наОткрытие() },
        onMessage: (t) => { if (наСообщение) отдать(t); else ждут.push(t) },
        onClose: (code, reason) => { закрыт = true; if (наЗакрытие) наЗакрытие(code, reason) },
      }])
      function отдать(t) { try { наСообщение(t) } catch (e) { self.postMessage({ k: 'err', error: String((e && e.message) || e) }) } }
      return {
        id: id,
        get closed() { return закрыт },
        send: (data) => call('net.wsSend', [id, typeof data === 'string' ? data : JSON.stringify(data)]),
        close: () => call('net.wsClose', [id]),
        onMessage: (fn) => {
          наСообщение = fn
          const очередь = ждут.splice(0, ждут.length)
          for (const t of очередь) отдать(t)
        },
        onClose: (fn) => { наЗакрытие = fn },
        onOpen: (fn) => { наОткрытие = fn },
      }
    },
  },
  // v1.333.0: эффект своего голоса в звонке. Плагин только выбирает — обработка
  // звука целиком в приложении, сюда не попадает ни одного сэмпла.
  voice: {
    list: () => call('voice.effects', []),
    current: () => call('voice.current', []),
    // Отвечает false, если звонка сейчас нет: менять нечего.
    setEffect: (id) => call('voice.setEffect', [String(id)]),
  },
  // v1.417.0: музыка. Плагин видит, что играет, и нажимает те же кнопки, что и
  // человек. Звука ему не достаётся.
  music: {
    now: () => call('music.now', []),
    library: () => call('music.library', []),
    play: () => call('music.play', []),
    pause: () => call('music.pause', []),
    next: () => call('music.next', []),
    prev: () => call('music.prev', []),
    queue: (trackId) => call('music.queue', [String(trackId)]),
    add: (url) => call('music.add', [String(url)]),
  },
  notify: (text) => call('notify', [String(text)]),
  // Промис ОБЯЗАТЕЛЬНО возвращается наружу: подписка может быть отклонена (нет
  // разрешения messages.read), и без return этот отказ становился бы необработанным
  // — плагин не смог бы его поймать, даже написав try/catch по всем правилам.
  on: (name, fn) => {
    const arr = listeners.get(name) || []
    arr.push(fn)
    listeners.set(name, arr)
    return call('subscribe', [String(name)])
  },
  // v1.397.0: три уровня. Строки видны в настройках плагина, в его журнале:
  // предупреждение и ошибку там видно отдельно от обычного вывода.
  log: (...a) => call('log', [fmt(a), 'log']),
  warn: (...a) => call('log', [fmt(a), 'warn']),
  error: (...a) => call('log', [fmt(a), 'error']),
}

// ---- 4. Приём сообщений от приложения ------------------------------------------
self.onmessage = async (e) => {
  const m = e.data || {}

  if (m.k === 'init') {
    try {
      // Плагин получает ponoi аргументом, а не через глобал: так видно, откуда он
      // берётся, и нельзя случайно затереть его объявлением своей переменной.
      // v1.333.0: код выполняется через new Function, то есть НЕ как модуль — а в
      // документации плагина (manifest.ts) с самого начала стоял пример с
      // "export function onLoad". Такой плагин падал сразу на "Unexpected token
      // export": то есть по нашей же инструкции написать рабочий плагин было
      // нельзя. Снимаем ведущее export у объявлений верхнего уровня — работают и
      // форма из документации, и обычная function onLoad.
      const code = m.code.replace(/^[ \t]*export[ \t]+(default[ \t]+)?(?=(async[ \t]+)?(function|const|let|var|class)\b)/gm, '')
      const factory = new Function('ponoi', 'module', 'exports',
        code + '\nreturn (typeof onLoad === "function" ? onLoad : (module.exports && module.exports.onLoad) || (exports && exports.onLoad));')
      const mod = { exports: {} }
      const onLoad = factory(ponoi, mod, mod.exports)
      if (typeof onLoad === 'function') await onLoad(ponoi)
      self.postMessage({ k: 'ready' })
    } catch (err) {
      self.postMessage({ k: 'fail', error: String((err && err.message) || err) })
    }
    return
  }

  if (m.k === 'res') {
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error))
    return
  }

  if (m.k === 'invoke') {
    const fn = callbacks.get(m.fn)
    let ok = true, value = null, error = ''
    try { value = fn ? await fn.apply(null, m.args || []) : null }
    catch (err) { ok = false; error = String((err && err.message) || err) }
    // Результат обработчика может быть чем угодно — например, изменённым текстом
    // сообщения; отдаём как есть, приложение само решит, что с ним делать.
    self.postMessage({ k: 'res', id: m.id, ok: ok, value: ok ? packArgs(value) : null, error: error })
    return
  }

  if (m.k === 'ev') {
    for (const fn of listeners.get(m.name) || []) {
      try { fn(m.data) } catch (err) { self.postMessage({ k: 'err', error: String((err && err.message) || err) }) }
    }
    return
  }
}

// Необработанный отказ внутри плагина не должен выглядеть как «приложение молчит».
self.onunhandledrejection = (e) => {
  self.postMessage({ k: 'err', error: 'Необработанная ошибка: ' + String((e.reason && e.reason.message) || e.reason) })
}

})()
`
