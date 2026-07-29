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
    // Окно рисует приложение, плагин получает только ответ: своё окно он подделал
    // бы под любое окно Ponoi, а спросить пароль «от имени приложения» нельзя.
    confirm: (opt) => call('ui.confirm', [opt || {}]),
    prompt: (opt) => call('ui.prompt', [opt || {}]),
  },
  clipboard: {
    write: (text) => call('clipboard.write', [String(text)]),
  },
  me: () => call('me', []),
  channel: () => call('channel', []),
  commands: {
    register: (name, description, handler) => call('commands.register', [String(name), String(description), handler]),
  },
  messages: {
    send: (text) => call('messages.send', [String(text)]),
  },
  storage: {
    get: (key) => call('storage.get', [String(key)]),
    set: (key, value) => call('storage.set', [String(key), value]),
    remove: (key) => call('storage.remove', [String(key)]),
    keys: () => call('storage.keys', []),
  },
  net: {
    fetch: (url, init) => call('net.fetch', [String(url), init || {}]),
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
