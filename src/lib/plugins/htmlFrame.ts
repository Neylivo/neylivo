// v1.490.0: окно плагина с НАСТОЯЩИМ HTML.
//
// Зачем. До сих пор плагин описывал СТРОКИ, а рисовало их приложение. Для
// настройки этого хватает, для игры и визуализатора — нет: владелец попросил
// сразу семнадцать вещей, и почти все они про одно и то же — «дайте настоящую
// страницу»: canvas.getContext('webgl2'), navigator.gpu, requestAnimationFrame,
// мышь, клавиатура, AudioContext, three.js, физика, шейдеры.
//
// Половина из этого уже работала в песочнице (я замерил живой пробой:
// requestAnimationFrame, OffscreenCanvas, WebAssembly, navigator.gpu с рабочим
// адаптером и устройством), но остальное не работало и не могло: в потоке нет
// ни DOM, ни мыши, ни AudioContext, а importScripts закрыт — то есть ни одну
// стороннюю библиотеку не подключить.
//
// ПОЧЕМУ IFRAME, А НЕ ПРОСТО РАЗМЕТКА В НАШЕЙ СТРАНИЦЕ.
//
// Вставить html плагина прямо в приложение — это отдать ему всё приложение:
// его скрипт оказался бы в нашем окне, с нашим localStorage, нашими куками и
// нашей сессией. Владелец снял ограничения и сказал не бояться подделок — но
// вторую границу («плагин не может вытащить мастер-ключ сессии») он сам назвал
// нерушимой, и она держится ровно на этом.
//
// <iframe sandbox="allow-scripts"> без allow-same-origin даёт УНИКАЛЬНОЕ
// непрозрачное происхождение. Внутри — полноценная страница: свой DOM, свой
// canvas с webgl и webgpu, свой requestAnimationFrame, мышь, клавиатура,
// AudioContext, любые библиотеки с любого сайта. Наружу — ничего: ни
// document.cookie приложения, ни localStorage, ни доступа к parent.
//
// А сам объект ponoi внутри рамки есть: он ходит через postMessage в
// приложение, и там его вызовы проходят ТЕ ЖЕ проверки разрешений, что и вызовы
// из потока. Никакого второго входа в систему плагинов.
//
// Проверки: src/lib/plugins/__test.ts (единичные) и __api_test.tsx (живая, с
// настоящим WebGL и настоящей мышью).

/**
 * Мост, который встраивается в каждую рамку.
 *
 * Пишется строкой по той же причине, что и песочница воркера (bootstrap.ts): он
 * должен попасть внутрь ЦЕЛИКОМ и без сборщика, а собирать его отдельным
 * входом ради сорока строк — лишняя часть в сборке, которая однажды разойдётся
 * с этой.
 */
export const FRAME_BRIDGE = `<script>
(function () {
  var seq = 0
  var ждут = {}
  var слушатели = {}

  function call(method, args) {
    var id = ++seq
    return new Promise(function (resolve, reject) {
      ждут[id] = { resolve: resolve, reject: reject }
      parent.postMessage({ ponoi: 1, k: 'call', id: id, method: method, args: args || [] }, '*')
    })
  }

  window.addEventListener('message', function (e) {
    var m = e.data
    if (!m || m.ponoi !== 1) return
    if (m.k === 'res') {
      var p = ждут[m.id]
      if (!p) return
      delete ждут[m.id]
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error))
      return
    }
    if (m.k === 'ev') {
      var сп = слушатели[m.name] || []
      for (var i = 0; i < сп.length; i++) {
        try { сп[i](m.data) } catch (err) { console.error(err) }
      }
    }
  })

  // Тот же объект, что в потоке, только собранный по имени метода: держать два
  // списка методов значило бы обречь их разойтись.
  function ветка(имена) {
    var o = {}
    имена.forEach(function (имя) {
      var путь = имя
      var короткое = имя.indexOf('.') >= 0 ? имя.slice(имя.indexOf('.') + 1) : имя
      o[короткое] = function () { return call(путь, [].slice.call(arguments)) }
    })
    return o
  }

  window.ponoi = {
    __frame: true,
    call: call,
    on: function (name, fn) {
      (слушатели[name] = слушатели[name] || []).push(fn)
      return call('subscribe', [String(name)])
    },
    log: function () { return call('log', [[].slice.call(arguments).join(' '), 'log']) },
    warn: function () { return call('log', [[].slice.call(arguments).join(' '), 'warn']) },
    error: function () { return call('log', [[].slice.call(arguments).join(' '), 'error']) },
    notify: function (t) { return call('notify', [String(t)]) },
    me: function () { return call('me', []) },
    channels: function () { return call('channels', []) },
    servers: function () { return call('servers', []) },
    currentChannel: function () { return call('currentChannel', []) },
    messages: ветка(['messages.send', 'messages.recent', 'messages.react', 'messages.remove']),
    storage: ветка(['storage.get', 'storage.set', 'storage.remove', 'storage.keys']),
    net: ветка(['net.fetch', 'net.json']),
    music: ветка(['music.now', 'music.library', 'music.play', 'music.pause', 'music.next', 'music.prev']),
    apps: ветка(['apps.create', 'apps.update', 'apps.close', 'apps.where', 'apps.all', 'apps.screen',
      'apps.hide', 'apps.show']),
    db: ветка(['db.insert', 'db.get', 'db.all', 'db.update', 'db.remove', 'db.count', 'db.clear', 'db.tables']),
    ui: ветка(['ui.setTheme', 'ui.clearTheme']),
    plugins: ветка(['plugins.send']),
    // Свои файлы плагина. Отдаются БАЙТАМИ — рамке достаётся содержимое, а не
    // адрес: ссылка на файл, утёкшая наружу, открыла бы его кому угодно.
    assets: {
      get: function (n) { return call('assets.get', [String(n)]) },
      put: function (n, d) { return call('assets.put', [String(n), d]) },
      list: function () { return call('assets.list', []) },
      info: function (n) { return call('assets.info', [String(n)]) },
      remove: function (n) { return call('assets.remove', [String(n)]) },
      /**
       * Готовый blob: адрес — чтобы отдать его прямо в <img>, в fetch и в
       * загрузчик модели.
       *
       * assets.get отдаёт СЫРЫЕ байты, а тип лежит отдельно (assets.info):
       * спрашиваем оба, иначе браузер получил бы application/octet-stream и
       * отказался бы показывать картинку.
       */
      url: function (n) {
        // Имена внутри моста ЛАТИНСКИЕ намеренно. Он уезжает в srcdoc рамки
        // как есть, минуя сборщик, и одна буква «о» кириллицей уже стоила мне
        // отказа «o is not defined» на ровном месте — поймано живой пробой.
        return call('assets.get', [String(n)]).then(function (bytes) {
          if (!bytes) return null
          return call('assets.info', [String(n)]).then(function (meta) {
            var type = (meta && meta.type) || 'application/octet-stream'
            return URL.createObjectURL(new Blob([bytes], { type: type }))
          })
        })
      },
    },
  }

  parent.postMessage({ ponoi: 1, k: 'ready' }, '*')
})()
</script>`

/**
 * Полный документ рамки.
 *
 * Мост идёт ПЕРВЫМ: код плагина ожидает, что window.ponoi уже есть, — иначе
 * пришлось бы объяснять в документации, что надо дождаться какого-то события,
 * и половина плагинов сломалась бы на пустом месте.
 *
 * Стили сброшены до нуля: рамка — это своё окно, а не кусок нашего оформления,
 * и никакие наши отступы в ней ни к чему.
 */
export function frameDoc(html: string): string {
  return '<!doctype html><meta charset="utf-8">'
    + '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;'
    + 'background:transparent;color:#dbdee1;font:14px system-ui,sans-serif}'
    + 'canvas{display:block}</style>'
    + FRAME_BRIDGE
    + String(html ?? '')
}

/**
 * Что рамке можно звать (v1.490.0).
 *
 * Список закрытый и НЕ совпадает с полным списком методов. Причина одна: рамка
 * живёт в главном потоке страницы, и всё, что отдаёт наружу ссылки или функции
 * обратного вызова, здесь работало бы иначе, чем в потоке. Метод, которого тут
 * нет, отвечает внятным отказом, а не тишиной.
 *
 * Разрешения при этом проверяются ТЕ ЖЕ и в том же месте (api.ts): этот список
 * ничего не открывает сам по себе.
 */
export const FRAME_METHODS: readonly string[] = [
  'log', 'notify', 'subscribe', 'me', 'channels', 'servers', 'currentChannel',
  'messages.send', 'messages.recent', 'messages.react', 'messages.remove',
  'storage.get', 'storage.set', 'storage.remove', 'storage.keys',
  'net.fetch', 'net.json',
  'music.now', 'music.library', 'music.play', 'music.pause', 'music.next', 'music.prev',
  'apps.create', 'apps.update', 'apps.close', 'apps.where', 'apps.all', 'apps.screen',
  'apps.hide', 'apps.show',
  'db.insert', 'db.get', 'db.all', 'db.update', 'db.remove', 'db.count', 'db.clear', 'db.tables',
  'ui.setTheme', 'ui.clearTheme',
  'plugins.send',
  'assets.get', 'assets.put', 'assets.list', 'assets.info', 'assets.remove',
]

export function frameMethodAllowed(method: string): boolean {
  return FRAME_METHODS.includes(method)
}
