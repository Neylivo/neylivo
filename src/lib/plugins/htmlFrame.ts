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

  window.neylivo = {
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

  // Псевдоним для страниц, написанных до переименования. Сразу, а не в конце:
  // ниже к объекту дописываются методы.
  window.ponoi = window.neylivo

  // ── fetch('asset:имя') ───────────────────────────────────────────────────
  //
  // Владелец попросил ровно такую запись, и она того стоит: три четверти
  // загрузчиков (текстуры, модели, шрифты, звуки) принимают адрес и зовут fetch
  // сами. Дай им blob-адрес — они его тоже примут, но написать «asset:модель»
  // короче и понятнее, а главное — это работает и там, куда адрес отдать
  // нельзя, потому что зовут не тебя.
  //
  // Подменяем ровно свой протокол. Всё остальное уходит в настоящий fetch без
  // изменений: страница вправе ходить в интернет, как любая страница.
  var настоящийFetch = window.fetch ? window.fetch.bind(window) : null
  window.fetch = function (вход, init) {
    var url = typeof вход === 'string' ? вход : (вход && вход.url) || ''
    if (url.indexOf('asset:') !== 0) {
      if (!настоящийFetch) return Promise.reject(new Error('fetch недоступен'))
      return настоящийFetch(вход, init)
    }
    var name = url.slice('asset:'.length)
    return call('assets.get', [name]).then(function (bytes) {
      if (!bytes) {
        // statusText только латиницей: это строка протокола HTTP, и кириллица
        // в ней роняет сам конструктор Response — то есть «нет файла»
        // превращалось бы в непонятную ошибку вместо честного 404.
        return new Response(null, { status: 404, statusText: 'Not Found' })
      }
      return call('assets.info', [name]).then(function (meta) {
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': (meta && meta.type) || 'application/octet-stream' },
        })
      })
    })
  }

  // ── Библиотеки ───────────────────────────────────────────────────────────
  //
  // Своим файлом (three.min.js, физика, что угодно) или ссылкой. Замерено
  // живой пробой: обычный <script> с blob-адреса внутри песочницы РАБОТАЕТ, а
  // вот import() того же blob — нет: у страницы чужое происхождение, и модуль
  // по такому адресу браузер грузить отказывается. Поэтому здесь два способа,
  // и оба честные, а не «попробуй, вдруг получится».
  neylivo.load = function (что) {
    return Promise.resolve()
      .then(function () {
        return String(что).indexOf('http') === 0 ? String(что) : neylivo.assets.url(String(что))
      })
      .then(function (src) {
        if (!src) throw new Error('нет такого файла плагина: ' + что)
        return new Promise(function (ok, no) {
          var s = document.createElement('script')
          s.onload = function () { ok(true) }
          s.onerror = function () { no(new Error('библиотека не загрузилась: ' + что)) }
          s.src = src
          document.head.appendChild(s)
        })
      })
  }

  /**
   * Модуль (import/export) из своего файла.
   *
   * Через blob-адрес НЕ выйдет — у страницы чужое происхождение. Поэтому текст
   * модуля вставляется в страницу как есть: встроенный <script type="module">
   * выполняется, а свои значения отдаёт через window.
   */
  neylivo.loadModule = function (имя, вГлобальное) {
    return call('assets.get', [String(имя)]).then(function (bytes) {
      if (!bytes) throw new Error('нет такого файла плагина: ' + имя)
      var src = new TextDecoder().decode(bytes)
      var метка = 'мод' + Math.random().toString(36).slice(2)
      return new Promise(function (ok, no) {
        var s = document.createElement('script')
        s.type = 'module'
        // Перевод строки берём ЧИСЛОМ, а не escape-последовательностью.
        //
        // Весь этот мост живёт внутри шаблонной строки TypeScript, и обратная
        // косая с буквой n превращается в НАСТОЯЩИЙ перевод строки — прямо
        // посреди кавычек готового кода. Мост тогда перестаёт разбираться
        // целиком, а падает это как «страница не поднялась»: ни ошибки, ни
        // намёка. Я поймал это дважды подряд — второй раз в собственном
        // комментарии об этой же ловушке, где та же пара знаков разорвала
        // комментарий пополам и остаток строки стал кодом.
        var НС = String.fromCharCode(10)
        s.textContent = src
          + НС + ';window[' + JSON.stringify(метка) + '] = true;'
          + (вГлобальное
            ? НС + 'try { window[' + JSON.stringify(String(вГлобальное)) + '] = eval(' + JSON.stringify(String(вГлобальное)) + ') } catch (e) {}'
            : '')
        s.onerror = function () { no(new Error('модуль не выполнился: ' + имя)) }
        document.head.appendChild(s)
        // У встроенного модуля нет onload — ждём отметки, которую он ставит сам.
        var ждал = 0
        var тик = setInterval(function () {
          if (window[метка]) { clearInterval(тик); ok(true) }
          else if (++ждал > 200) { clearInterval(тик); no(new Error('модуль не отозвался: ' + имя)) }
        }, 10)
      })
    })
  }

  // ── Встроенные библиотеки ────────────────────────────────────────────────
  //
  // neylivo.lib('three') — и на странице есть three.js, без интернета и без
  // чужого сервера. Возвращает саму библиотеку, а не «true»: строка
  // const THREE = await neylivo.lib('three') понятнее, чем помнить, в какое
  // глобальное имя она себя положила.
  //
  // Обратных кавычек в этом файле быть не должно НИГДЕ, даже в комментариях:
  // весь мост — одна шаблонная строка TypeScript, и любая из них обрывает её.
  // Это третья ловушка того же рода за две версии (первые две — обратная косая
  // с n).
  //
  // Повторный вызов ничего не грузит заново: библиотека уже в окне.
  var загруженные = {}
  neylivo.lib = function (имя) {
    имя = String(имя)
    if (загруженные[имя]) return Promise.resolve(загруженные[имя])
    return call('libs.get', [имя]).then(function (b) {
      return new Promise(function (ok, no) {
        var s = document.createElement('script')
        if (b.kind === 'module') s.type = 'module'
        s.textContent = b.code
        s.onerror = function () { no(new Error('библиотека не выполнилась: ' + имя)) }
        document.head.appendChild(s)
        // У встроенного скрипта нет onload — ждём, пока появится значение.
        var ждал = 0
        var тик = setInterval(function () {
          if (window[b.global]) {
            clearInterval(тик)
            загруженные[имя] = window[b.global]
            ok(window[b.global])
          } else if (++ждал > 600) {
            clearInterval(тик)
            no(new Error('библиотека не отозвалась: ' + имя))
          }
        }, 10)
      })
    })
  }
  neylivo.libs = function () { return call('libs.list', []) }

  // ── Игровой цикл ─────────────────────────────────────────────────────────
  //
  // requestAnimationFrame внутри страницы работает и без нас (замерено: 124
  // кадра в секунду). Но игровой цикл почти всегда пишут одинаково и одинаково
  // же ошибаются: забывают посчитать время между кадрами, и на быстром экране
  // всё летит вдвое быстрее.
  //
  // Здесь dt приходит готовым, в секундах, и ограничен сверху: после
  // переключения вкладки между кадрами проходят минуты, и герой без ограничения
  // улетал бы сквозь стену за один шаг.
  var кадровые = []
  var кадрИдёт = 0
  var прошлое = 0
  function шагКадра(now) {
    var dt = прошлое ? (now - прошлое) / 1000 : 0
    прошлое = now
    if (dt > 0.25) dt = 0.25
    for (var i = 0; i < кадровые.length; i++) {
      try { кадровые[i](dt, now) } catch (e) { console.error(e) }
    }
    кадрИдёт = requestAnimationFrame(шагКадра)
  }
  neylivo.frame = function (fn) {
    кадровые.push(fn)
    if (!кадрИдёт) кадрИдёт = requestAnimationFrame(шагКадра)
    return function () {
      var i = кадровые.indexOf(fn)
      if (i >= 0) кадровые.splice(i, 1)
      if (!кадровые.length && кадрИдёт) { cancelAnimationFrame(кадрИдёт); кадрИдёт = 0; прошлое = 0 }
    }
  }

  // ── Курсор ───────────────────────────────────────────────────────────────
  //
  // Всё это работает и напрямую (style.cursor, requestPointerLock) — но об этом
  // надо знать. Игре от первого лица нужен захват, редактору — перекрестье, и
  // писать это руками каждый раз незачем.
  neylivo.cursor = {
    set: function (вид) { document.body.style.cursor = String(вид || 'default') },
    hide: function () { document.body.style.cursor = 'none' },
    show: function () { document.body.style.cursor = 'default' },
    /** Захват для камеры от первого лица. Браузер требует нажатия человеком. */
    lock: function (el) {
      var цель = el || document.querySelector('canvas') || document.body
      return цель.requestPointerLock ? цель.requestPointerLock() : null
    },
    unlock: function () { if (document.exitPointerLock) document.exitPointerLock() },
    locked: function () { return !!document.pointerLockElement },
  }

  // ── Файлы человека ───────────────────────────────────────────────────────
  //
  // Открыть проект, сохранить сцену, загрузить модель. Работает через
  // showOpenFilePicker там, где он есть (замерено: в окне плагина есть), и
  // через обычный выбор файла там, где его нет, — чтобы плагин не приходилось
  // писать дважды.
  //
  // Это ФАЙЛЫ ЧЕЛОВЕКА, а не наши: он выбирает их сам в системном окне, и без
  // его выбора плагин не видит ничего. Поэтому разрешения тут не спрашиваются:
  // спрашивает сама система, и спрашивает нагляднее нас.
  neylivo.files = {
    /**
     * Открыть один или несколько файлов.
     * Отдаёт [{ name, size, type, text(), bytes(), file }].
     */
    open: function (opt) {
      opt = opt || {}
      var типы = opt.accept ? String(opt.accept) : ''
      var много = !!opt.multiple
      function собери(list) {
        return [].map.call(list, function (f) {
          return {
            name: f.name, size: f.size, type: f.type, file: f,
            text: function () { return f.text() },
            bytes: function () { return f.arrayBuffer() },
            url: function () { return URL.createObjectURL(f) },
          }
        })
      }
      if (window.showOpenFilePicker) {
        return window.showOpenFilePicker({ multiple: много })
          .then(function (ручки) {
            return Promise.all(ручки.map(function (h) { return h.getFile() }))
          })
          .then(собери)
          .catch(function () { return [] })   // человек передумал — это не ошибка
      }
      return new Promise(function (ok) {
        var i = document.createElement('input')
        i.type = 'file'
        if (много) i.multiple = true
        if (типы) i.accept = типы
        i.onchange = function () { ok(собери(i.files || [])) }
        // Отмену выбора файла браузер не сообщает никак: человек может закрыть
        // окно, и обещание висело бы вечно. Ждём возврата фокуса.
        window.addEventListener('focus', function once() {
          window.removeEventListener('focus', once)
          setTimeout(function () { if (!(i.files || []).length) ok([]) }, 400)
        })
        i.click()
      })
    },
    /** Сохранить данные в файл. Строка, ArrayBuffer или Blob. */
    save: function (имя, данные, тип) {
      var b = данные instanceof Blob ? данные
        : new Blob([данные], { type: тип || 'application/octet-stream' })
      if (window.showSaveFilePicker) {
        return window.showSaveFilePicker({ suggestedName: String(имя || 'файл') })
          .then(function (h) { return h.createWritable() })
          .then(function (w) { return w.write(b).then(function () { return w.close() }) })
          .then(function () { return true })
          .catch(function () { return false })
      }
      return new Promise(function (ok) {
        var a = document.createElement('a')
        a.href = URL.createObjectURL(b)
        a.download = String(имя || 'файл')
        document.body.appendChild(a)
        a.click()
        setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); ok(true) }, 100)
      })
    },
    /**
     * Перетаскивание файлов в окно.
     *
     * Браузер по умолчанию ОТКРЫВАЕТ брошенный файл вместо страницы — то есть
     * плагин исчезает, а на его месте картинка. Отменяем это здесь, чтобы
     * автору не пришлось узнавать про это на своей шкуре.
     */
    onDrop: function (fn) {
      var стоп = function (e) { e.preventDefault(); e.stopPropagation() }
      var брошено = function (e) {
        стоп(e)
        var файлы = [].map.call((e.dataTransfer && e.dataTransfer.files) || [], function (f) {
          return {
            name: f.name, size: f.size, type: f.type, file: f,
            text: function () { return f.text() },
            bytes: function () { return f.arrayBuffer() },
            url: function () { return URL.createObjectURL(f) },
          }
        })
        if (файлы.length) { try { fn(файлы) } catch (err) { console.error(err) } }
      }
      window.addEventListener('dragover', стоп)
      window.addEventListener('drop', брошено)
      return function () {
        window.removeEventListener('dragover', стоп)
        window.removeEventListener('drop', брошено)
      }
    },
  }

  // Холст одной строкой — ровно та запись, которую просил владелец.
  neylivo.canvas = function (opt) {
    opt = opt || {}
    var c = document.querySelector('canvas')
    if (!c) {
      c = document.createElement('canvas')
      c.style.display = 'block'
      c.style.width = '100%'
      c.style.height = '100%'
      ;(document.body || document.documentElement).appendChild(c)
    }
    // Размер БУФЕРА равен размеру на экране, с учётом плотности точек: иначе
    // картинка мылится на телефоне и на экранах с масштабом.
    var к = opt.dpr === false ? 1 : (window.devicePixelRatio || 1)
    var r = c.getBoundingClientRect()
    c.width = Math.max(1, Math.round((r.width || 300) * к))
    c.height = Math.max(1, Math.round((r.height || 150) * к))
    return c
  }

  // ── Ошибки страницы уходят в журнал плагина ──────────────────────────────
  //
  // Без этого автор отлаживает вслепую: страница молча не работает, консоли у
  // него нет, а в журнале плагина пусто — плагин-то как раз отработал. Я сам на
  // этом потерял час, разбирая, почему окно открылось пустым.
  window.addEventListener('error', function (e) {
    try {
      call('log', ['Ошибка в странице: ' + (e.message || 'неизвестно')
        + (e.lineno ? ' (строка ' + e.lineno + ')' : ''), 'error'])
    } catch (err) {}
  })
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason
      call('log', ['Необработанная ошибка в странице: '
        + String((r && r.message) || r), 'error'])
    } catch (err) {}
  })

  // v1.558.0: объект называется neylivo, а ponoi оставлен ПСЕВДОНИМОМ — это
  // одна и та же ссылка, поэтому страницы плагинов, написанные до
  // переименования, работают без правок.
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
    // <body> ОБЯЗАТЕЛЬНО и до всего остального.
    //
    // Без него страница, у которой нет разметки (а у игры её и нет — только
    // код), целиком разбиралась в <head>: document.body там ещё не существует,
    // и первое же обращение к нему падало с «Cannot read properties of null».
    // Выглядело это как пустое окно без единой жалобы — плагин-то отработал.
    // Поймано живой проверкой после того, как ошибки страницы стали доходить
    // до журнала.
    + '<body>'
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
  // v1.492.0: встроенные библиотеки. Ради них рамка и существует.
  'libs.list', 'libs.get',
]

/**
 * v1.499.0: странице доступно ВСЁ, что доступно потоку.
 *
 * Раньше здесь стоял короткий список, и «css» или «ui.addHotkey» со страницы
 * отвечали отказом. Отказ был из худших: возможность есть, разрешение есть, а
 * вызов не проходит — потому что зовут не оттуда.
 *
 * Разрешения при этом проверяет ТОТ ЖЕ диспетчер, что и для потока (api.ts):
 * этот список ничего не открывал сам по себе и не открывает.
 *
 * FRAME_METHODS остался как перечень того, что мост даёт удобными именами
 * (neylivo.messages.send и подобное). Всё остальное зовётся через neylivo.call.
 */
export function frameMethodAllowed(_method: string): boolean {
  return true
}
