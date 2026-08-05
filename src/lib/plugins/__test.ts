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
/** Пустой холст: плагину важно, что вызовы не падают, а не что нарисовано. */
function рисовалка() {
  const ничего = () => {}
  return new Proxy({}, {
    get: (_t, k) => (k === 'canvas' ? { width: 600, height: 160 } : ничего),
    set: () => true,
  }) as any
}

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
    hooks: [] as string[],
    canvases: [] as string[],
    dialogs: [] as string[],
    apps: [] as string[],
    headerButtons: [] as string[],
    themes: [] as string[],
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
      // v1.465.0/1.471.0/1.475.0: холст, окно и окно-вопрос. Плагин, который
      // ими пользуется, обязан доходить здесь до конца, а не падать на
      // «не функция» — иначе проверка ловит не свою ошибку.
      getCanvas: async (key: string) => {
        if (!key) throw new Error('getCanvas: нужен ключ холста')
        calls.canvases.push(String(key))
        return { width: 600, height: 160, getContext: () => рисовалка() }
      },
      dialog: async (o: any) => {
        if (!o?.title || !Array.isArray(o.rows)) throw new Error('dialog: нужны title и rows')
        calls.dialogs.push(o.title)
        return null
      },
      addHeaderButton: (o: any) => {
        if (!o?.key || typeof o.onClick !== 'function') throw new Error('addHeaderButton: нужны key и onClick')
        calls.headerButtons.push(String(o.key))
      },
      setTheme: async (c: any) => {
        if (!c || typeof c !== 'object') throw new Error('setTheme: нужен словарь цветов')
        calls.themes.push(Object.keys(c).join(','))
      },
      clearTheme: async () => {},
      addHotkey: (o: any) => {
        if (!o?.combo || typeof o.onPress !== 'function') throw new Error('addHotkey: нужны combo и onPress')
        calls.hotkeys.push(o.combo)
      },
    },
    commands: {
      // v1.475.0: два вида записи — прежний и объектом с доводами. Заглушка
      // обязана понимать оба, иначе плагин на новой записи падает здесь на
      // «команда без обработчика», хотя написан правильно.
      register: async (a: any, desc?: string, handler?: any) => {
        const объект = a && typeof a === 'object'
        const имя = объект ? a.name : a
        const опис = объект ? a.description : desc
        const обр = объект ? (a.onRun ?? a.handler) : handler
        if (typeof обр !== 'function') throw new Error('команда без обработчика')
        if (!опис) throw new Error('команда без описания')
        if (объект && a.args && !Array.isArray(a.args)) throw new Error('args: нужен список')
        calls.commands.push(имя)
      },
    },
    apps: {
      create: async (o: any) => {
        if (!o?.mode) throw new Error('apps.create: не сказан вид окна (mode)')
        calls.apps.push(o.mode)
        return calls.apps.length
      },
      update: async () => true,
      close: async () => true,
    },
    db: {
      table: () => ({
        insert: async () => 'id1', get: async () => null, all: async () => [],
        update: async () => true, remove: async () => true, count: async () => 0,
        clear: async () => 0, where: () => ({ get: async () => [] }),
      }),
      tables: async () => [],
    },
    assets: {
      put: async () => ({ name: 'f', type: 'image/png', kind: 'image', size: 1, at: 0 }),
      fetch: async () => ({ name: 'f', type: 'image/png', kind: 'image', size: 1, at: 0 }),
      get: async () => new ArrayBuffer(1), info: async () => null, list: async () => [],
      remove: async () => true, clear: async () => 0, play: async () => true,
      image: async () => ({ width: 1, height: 1 }), text: async () => '',
    },
    background: {
      every: async (ms: number, fn: any) => {
        if (typeof fn !== 'function') throw new Error('background.every: нужна функция')
        if (!(ms >= 1000)) throw new Error('background.every: слишком часто')
        return 1
      },
      stop: async () => true,
    },
    messages: {
      send: async (t: string) => { calls.sent.push(String(t)) },
      recent: async () => [],
      react: async () => true,
      remove: async () => true,
      // v1.475.0: перехватчики. Заглушка обязана уметь их принять — иначе
      // официальный плагин, который ими пользуется, падает здесь на
      // «не функция», а не на своей ошибке.
      onBeforeSend: async (fn: any) => { if (typeof fn !== 'function') throw new Error('onBeforeSend: нужна функция'); calls.hooks.push('send') },
      onBeforeRender: async (fn: any) => { if (typeof fn !== 'function') throw new Error('onBeforeRender: нужна функция'); calls.hooks.push('render') },
      onUpload: async (fn: any) => { if (typeof fn !== 'function') throw new Error('onUpload: нужна функция'); calls.hooks.push('upload') },
      // v1.477.0: «прочитал ли собеседник». В заглушке — «личка не открыта».
      readState: async () => null,
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
  'ponoi-timer': { commands: ['напомни'] },
  'ponoi-afk': { events: ['message'] },
  'ponoi-soft-light': { settings: true, events: ['settings'] },
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
    'apps.create', 'apps.update', 'apps.close',
    'services.register', 'services.unregister', 'services.connect', 'services.call',
    'db.insert', 'db.get', 'db.all', 'db.where', 'db.update', 'db.remove',
    'db.count', 'db.clear', 'db.tables',
    // v1.465.0: семь новых возможностей.
    'plugins.send', 'messages.onBeforeSend', 'messages.onBeforeRender',
    'ui.getCanvas', 'net.ws', 'net.wsSend', 'net.wsClose',
    'background.every', 'background.stop', 'ui.setTheme', 'ui.clearTheme', 'ui.addContextMenu',
    // v1.473.0: свои файлы и геймпад.
    'assets.put', 'assets.fetch', 'assets.get', 'assets.info', 'assets.list',
    'assets.remove', 'assets.clear', 'assets.play', 'input.gamepads',
    // v1.475.0
    'ui.dialog', 'messages.onUpload',
    // v1.477.0
    'messages.readState',
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
        'apps': "ponoi.apps.create({mode:'window'})",
        // v1.473.0
        'input': 'ponoi.input.gamepads()',
        'messages.upload': 'ponoi.messages.onUpload(async()=>{})',
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

  // ── Личная передача плагина (v1.468.0) ─────────────────────────────────
  console.log('\n-- Личная передача плагина --')
  {
    const g = await import('./grantCodes')

    check('код читается человеком: без похожих знаков', () => {
      // Код переписывают с экрана и диктуют голосом. Ноль и буква O, единица и
      // I/L в такой задаче — гарантированные ошибки.
      for (const плохой of ['0', 'O', '1', 'I', 'L']) {
        if (g.CODE_ALPHABET.includes(плохой)) throw new Error('в алфавите есть ' + плохой)
      }
      return g.CODE_ALPHABET.length >= 30
    })

    check('код достаточно длинный, чтобы его не перебрали', () => {
      // Код — это пропуск к чужой работе. Считаем стойкость честно: сколько
      // бит даёт длина при этом алфавите.
      const бит = g.CODE_LEN * Math.log2(g.CODE_ALPHABET.length)
      return бит >= 55
    })

    check('код берётся из криптографического источника, а не из Math.random', () => {
      // Комментарии выкидываем: в самом файле про Math.random написано словами,
      // и без этой чистки проверка ловила бы собственное пояснение вместо кода.
      const src = readFileSync('src/lib/plugins/grantCodes.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (/Math\.random/.test(src)) throw new Error('в коде передачи есть Math.random')
      return src.includes('crypto.getRandomValues')
    })

    check('генератор не сваливается в одни и те же знаки', () => {
      // Подсовываем свой источник: проверяем разбор байтов, а не сам crypto.
      let n = 0
      const код = g.makeCode(len => Uint8Array.from({ length: len }, () => n++))
      return код.length === g.CODE_LEN && new Set(код).size > 5
    })

    check('код узнаётся в любом виде, как его ни перепиши', () =>
      g.normCode('abcd-efgh-2345') === 'ABCDEFGH2345'
      && g.normCode('  ABCD EFGH 2345 ') === 'ABCDEFGH2345'
      && g.prettyCode('ABCDEFGH2345') === 'ABCD-EFGH-2345')

    check('очевидная описка ловится до похода в сеть', () =>
      !g.looksLikeCode('ABCD') && !g.looksLikeCode('ABCDEFGH234O')
      && g.looksLikeCode('abcd-efgh-2345'))

    check('срок считается от сегодня, а не от начала месяца', () => {
      // Границы месяца и года руками считают неправильно чаще всего.
      const t = Date.UTC(2026, 11, 25, 12, 0, 0)
      const iso = g.expiryFromDays(10, t)!
      const d = new Date(iso)
      return d.getUTCFullYear() === 2027 && d.getUTCMonth() === 0 && d.getUTCDate() === 4
    })

    check('«без срока» — это правда без срока, а не ноль дней', () =>
      g.expiryFromDays(0) === null && g.expiryFromDays(-5) === null && g.expiryFromDays(NaN) === null)

    check('число получений не выкрутить за пределы', () =>
      g.clampUses(0) === 1 && g.clampUses(-3) === 1 && g.clampUses(99999) === g.MAX_USES
      && g.clampUses('7') === 7 && g.clampUses('чепуха') === 1)

    check('приложение прямо говорит, что это НЕ защита от копирования', () => {
      // Соблазн промолчать тут большой, а молчание было бы обещанием, которого
      // приложение выполнить не может: плагин — обычный JavaScript.
      const t = g.GRANT_HONESTY
      if (!/не защита от копирования/i.test(t)) throw new Error('нет прямой оговорки')
      if (!/передать файл дальше/i.test(t)) throw new Error('не сказано, что файл уйдёт дальше')
      return t.length > 150
    })

    check('честная оговорка стоит на экране передачи, а не только в коде', () => {
      const ui = readFileSync('src/components/PluginGrants.tsx', 'utf8')
      return ui.includes('GRANT_HONESTY')
    })

    check('полученный плагин проходит те же разрешения, что и любой другой', () => {
      // За плагин заплатили — он от этого не стал безопаснее. Пропустить здесь
      // экран разрешений было бы худшим решением во всей этой затее.
      const ui = readFileSync('src/components/PluginGrants.tsx', 'utf8')
      return ui.includes('PermissionGate') && ui.includes('parsePlugin')
    })

    check('содержимое передачи достаётся только через функцию базы', () => {
      // Прямой select из таблицы отдал бы чужой плагин любому: правила закрыты,
      // и обходить их клиентом нельзя.
      const src = readFileSync('src/lib/plugins/grants.ts', 'utf8')
      if (/from\('plugin_grants'\)[\s\S]{0,200}select\([^)]*payload/.test(src)) {
        throw new Error('payload читается прямым запросом к таблице')
      }
      return src.includes("rpc('claim_plugin_grant'")
    })
  }

  // ── Система плагинов вне стартовой сборки (v1.469.0) ───────────────────
  console.log('\n-- Правило владения полем ввода и ленивая загрузка --')
  {
    const { CtxHolder } = await import('./hostCtx')

    // Правило существует против настоящей поломки (v1.293.0): полей ввода на
    // экране до трёх — личка, канал и ветка, — и плагин писал не в тот чат,
    // который человек видит. Проверяем именно те случаи, из-за которых оно есть.
    check('на пустое место встаёт любой', () => {
      const h = new CtxHolder<string>('пусто')
      h.claim('личка', 'ЛИЧКА', false)
      return h.current() === 'ЛИЧКА' && h.currentOwner() === 'личка'
    })

    check('чужое владение мягкой заявкой не отнимается', () => {
      // Именно это и ломалось: последний отрисовавшийся забирал контекст себе.
      const h = new CtxHolder<string>('пусто')
      h.claim('личка', 'ЛИЧКА', false)
      h.claim('канал', 'КАНАЛ', false)
      return h.current() === 'ЛИЧКА'
    })

    check('фокус перебивает: с кем человек работает, тот и владеет', () => {
      const h = new CtxHolder<string>('пусто')
      h.claim('личка', 'ЛИЧКА', false)
      h.claim('канал', 'КАНАЛ', true)
      return h.current() === 'КАНАЛ' && h.currentOwner() === 'канал'
    })

    check('свою заявку можно обновить и без фокуса', () => {
      // Поле ввода перерисовалось — контекст должен обновиться, а не застрять.
      const h = new CtxHolder<string>('пусто')
      h.claim('канал', 'КАНАЛ-1', false)
      h.claim('канал', 'КАНАЛ-2', false)
      return h.current() === 'КАНАЛ-2'
    })

    check('отпускает только владелец', () => {
      const h = new CtxHolder<string>('пусто')
      h.claim('канал', 'КАНАЛ', false)
      h.release('личка')
      const чужой = h.current()
      h.release('канал')
      return чужой === 'КАНАЛ' && h.current() === 'пусто' && !h.has()
    })

    check('после отпускания место снова свободно', () => {
      const h = new CtxHolder<string>('пусто')
      h.claim('канал', 'КАНАЛ', false)
      h.release('канал')
      h.claim('личка', 'ЛИЧКА', false)
      return h.current() === 'ЛИЧКА'
    })

    check('правило владения существует в ОДНОМ экземпляре', () => {
      // Две копии разошлись бы, и вернулась бы поломка «плагин пишет не в тот
      // чат»: до загрузки системы плагинов владение помнит прослойка, после —
      // хост, и правило у них обязано быть буквально одно.
      const host = readFileSync('src/lib/plugins/host.ts', 'utf8')
      const bridge = readFileSync('src/lib/plugins/bridge.ts', 'utf8')
      if (!host.includes('CtxHolder') || !bridge.includes('CtxHolder')) {
        throw new Error('кто-то из двоих не пользуется общим правилом')
      }
      // И ни один из них не должен решать сам, кто владелец.
      for (const [имя, src] of [['host.ts', host], ['bridge.ts', bridge]] as const) {
        if (/if\s*\(\s*!force\s*&&/.test(src)) throw new Error('в ' + имя + ' своя копия правила')
      }
      return true
    })

    check('горячий код зовёт прослойку, а не саму систему плагинов', () => {
      // Одна статическая ссылка из чата, шапки или карточки плагина в переписке
      // утаскивает всю систему плагинов в стартовую сборку — всем и всегда,
      // включая тех, у кого плагинов нет. Ловится это только замером, поэтому
      // проверка и стоит здесь, а сторож на вес — в smoke.cjs.
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      const горячие = [
        'src/components/Composer.tsx', 'src/components/MessageList.tsx',
        'src/components/ServerView.tsx', 'src/components/DMHome.tsx',
        'src/components/ThreadPanel.tsx', 'src/components/MiniProfile.tsx',
        'src/components/PluginPanels.tsx', 'src/components/PluginHeaderButtons.tsx',
        'src/components/CallRoom.tsx', 'src/App.tsx',
        'src/music/MusicPlayer.tsx', 'src/lib/plugins/install.ts',
      ]
      void readdirSync
      const плохие = горячие.filter(f => /from '[^']*plugins\/host'/.test(readFileSync(f, 'utf8')))
      if (плохие.length) throw new Error('тянут систему плагинов статически: ' + плохие.join(', '))
      return true
    })

    check('прослойка не будит систему плагинов ради события', () => {
      // Иначе первое же входящее сообщение утащило бы её за собой, и всё
      // разведение потеряло бы смысл.
      const bridge = readFileSync('src/lib/plugins/bridge.ts', 'utf8')
      const i = bridge.indexOf('export function emitPluginEvent')
      const тело = bridge.slice(i, i + 260)
      return тело.includes('host?.') && !тело.includes('поднять')
    })
  }

  // ── База плагина и WebAssembly (v1.472.0) ──────────────────────────────
  console.log('\n-- База плагина --')
  {
    const D = await import('./db')

    check('условие «равно» не путает типы', () =>
      D.matches({ n: 1 }, 'n', '=', 1) && !D.matches({ n: 1 }, 'n', '=', '1'))

    check('сравнения по порядку работают у чисел и дат', () =>
      D.matches({ n: 5 }, 'n', '>', 3) && D.matches({ n: 3 }, 'n', '>=', 3)
      && !D.matches({ n: 3 }, 'n', '>', 3)
      && D.matches({ d: new Date(2000, 0, 2) }, 'd', '>', new Date(2000, 0, 1)))

    check('у строк «больше» ничего не находит, а не отвечает наугад', () => {
      // Порядок строк зависит от языка и регистра: «Я» больше «а» или меньше —
      // вопрос без единственного ответа, и молча выбирать один из них нельзя.
      return !D.matches({ s: 'бета' }, 's', '>', 'альфа')
        && !D.matches({ s: 'бета' }, 's', '<', 'альфа')
    })

    check('отсутствующее поле ничего не находит и ничего не роняет', () =>
      !D.matches({}, 'нет', '=', 1) && !D.matches({}, 'нет', '>', 0)
      && !D.matches({}, 'нет', 'contains', 'а'))

    check('поиск по подстроке — только у строк', () =>
      D.matches({ s: 'Plasma Rifle' }, 's', 'contains', 'Rifle')
      && D.matches({ s: 'Plasma' }, 's', 'startsWith', 'Pla')
      && !D.matches({ s: 123 }, 's', 'contains', '2'))

    check('неизвестное условие не считается за правду', () =>
      !D.matches({ n: 1 }, 'n', 'выдумка' as never, 1) && !D.isOp('выдумка'))

    check('имя таблицы проверяется, а не берётся как есть', () => {
      // Имя входит в ключ записи. Разделители и черта пути там ни к чему.
      for (const плохое of ['', '  ', 'а/б', 'а\\б', 'я'.repeat(100)]) {
        try { D.checkTable(плохое); return false } catch { /* так и надо */ }
      }
      // v1.474.0: кириллица разрешена. Белый список из латиницы валил
      // настоящий плагин на таблице «счёт» — найдено живой пробой, а не
      // рассуждением.
      return D.checkTable(' inventory ') === 'inventory'
        && D.checkTable('счёт') === 'счёт'
        && D.checkTable('мои задачи') === 'мои задачи'
    })

    check('в разделителе ключа не обычный знак, а невидимый', () => {
      // Иначе плагин с именем, содержащим разделитель, залез бы в чужую
      // таблицу: ключи склеиваются строкой.
      const src = readFileSync('src/lib/plugins/db.ts', 'utf8')
      // Ищем ровно запись escape-последовательностью: настоящий нулевой байт в
      // исходнике — отдельная беда, из-за него файл считается двоичным.
      if (src.includes(' ')) throw new Error('в db.ts настоящий нулевой байт вместо записи escape')
      return src.includes("const SEP = '\\u0000'")
    })

    check('ни в одном файле системы плагинов нет настоящего нулевого байта', () => {
      // v1.473.0: проверка выше смотрела на один файл, а беда общая. Настоящий
      // нулевой байт в исходнике появляется сам собой при правке (редактор
      // вставляет знак вместо записи escape), после чего файл считается
      // двоичным: его перестают показывать поиск и разбор различий, и правка
      // рядом делается вслепую. За эту версию так вышло дважды.
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      const дир = 'src/lib/plugins/'
      const виноватые = readdirSync(дир)
        .filter(f => f.endsWith('.ts') && f !== '__test.ts')   // здесь он нарочно, вот в этой проверке
        .filter(f => readFileSync(дир + f, 'utf8').includes(String.fromCharCode(0)))
      if (виноватые.length) throw new Error('настоящий нулевой байт в: ' + виноватые.join(', '))
      return true
    })
  }

  // ── Свои файлы плагина (v1.473.0) ───────────────────────────────────────
  //
  // Сама база здесь недоступна (IndexedDB в Node нет), поэтому проверяется то,
  // на чём всё держится и где легче всего ошибиться: опознание вида по
  // содержимому, разбор присланного и правила имени.
  console.log('\n-- Свои файлы плагина --')
  {
    const A = await import('./assets')
    const байты = (...b: number[]) => new Uint8Array(b).buffer
    const текст = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

    check('картинки опознаются по первым байтам', () =>
      A.sniffAsset(байты(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2)).type === 'image/png'
      && A.sniffAsset(байты(0xff, 0xd8, 0xff, 0xe0, 1)).type === 'image/jpeg'
      && A.sniffAsset(байты(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)).type === 'image/gif')

    check('WebP и WAV не путаются, хотя начинаются одинаково', () => {
      const riff = (хвост: number[]) => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, ...хвост]).buffer
      const w = A.sniffAsset(riff([0x57, 0x45, 0x42, 0x50]))
      const a = A.sniffAsset(riff([0x57, 0x41, 0x56, 0x45]))
      return w.type === 'image/webp' && w.kind === 'image'
        && a.type === 'audio/wav' && a.kind === 'audio'
    })

    check('mp4 опознаётся по метке не с начала файла', () =>
      A.sniffAsset(байты(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32)).kind === 'video')

    check('разметка отвергается, и сказано почему', () => {
      for (const s of ['<!DOCTYPE html><html>', '<svg xmlns="x"><script/></svg>', '  <?xml version="1"?>']) {
        try { A.sniffAsset(текст(s)); return false } catch (e: any) {
          if (!/разметк/i.test(e.message)) return false
        }
      }
      return true
    })

    check('картинка с разметкой внутри — это разметка, а не картинка', () => {
      // Имя файла ни на что не влияет: смотрим только на содержимое.
      try { A.sniffAsset(текст('<svg onload="alert(1)"></svg>')); return false } catch { return true }
    })

    check('JSON и текст проходят, двоичный мусор — нет', () => {
      if (A.sniffAsset(текст('{"a":1}')).type !== 'application/json') return false
      if (A.sniffAsset(текст('обычный текст')).type !== 'text/plain') return false
      try { A.sniffAsset(байты(0x03, 0x04, 0x05, 0x06, 0x07)); return false } catch { return true }
    })

    check('пустой файл — отказ, а не запись в ноль байт', () => {
      try { A.sniffAsset(new ArrayBuffer(0)); return false } catch { return true }
    })

    check('имя файла проверяется, а не берётся как есть', () => {
      for (const плохое of ['', '   ', '../чужое', 'а/б', 'а\\б', 'я'.repeat(200)]) {
        try { A.checkAssetName(плохое); return false } catch { /* так и надо */ }
      }
      // Кириллица разрешена нарочно: плагины здесь пишут по-русски, и
      // «спрайт.png» должен работать.
      return A.checkAssetName(' sprite.png ') === 'sprite.png'
        && A.checkAssetName('спрайт героя.png') === 'спрайт героя.png'
    })

    check('байты берутся и из массива, и из base64, и из data:', () => {
      const из = (v: unknown) => new Uint8Array(A.bytesFrom(v))
      const прямо = из(new Uint8Array([1, 2, 3]))
      const b64 = из('data:image/png;base64,AAECAw==')
      const txt = из('привет')
      return прямо.length === 3 && прямо[2] === 3
        && b64.length === 4 && b64[3] === 3
        && txt.length > 6 && new TextDecoder().decode(txt) === 'привет'
    })

    check('кусок большого массива берётся именно куском', () => {
      // Uint8Array может смотреть в СЕРЕДИНУ чужого буфера. Возьми мы .buffer
      // целиком — в файл уехало бы всё, включая чужие байты до и после.
      const целое = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
      const кусок = celoe(целое)
      const got = new Uint8Array(A.bytesFrom(кусок))
      return got.length === 3 && got[0] === 1 && got[2] === 3
      function celoe(b: Uint8Array) { return b.subarray(2, 5) }
    })

    check('ссылка на файл не выдаётся плагину ни одним методом', () => {
      // Правило 2 из assets.ts: плагин знает только имя. Появись здесь метод,
      // отдающий адрес, файл можно было бы отправить сообщением или на чужой
      // сайт — а вернуть это назад уже нельзя.
      const src = readFileSync('src/lib/plugins/api.ts', 'utf8')
      const ветки = [...src.matchAll(/case '(assets\.[a-z]+)'/g)].map(m => m[1])
      if (!ветки.includes('assets.put')) throw new Error('ветки ресурсов не нашлись — проверка смотрит не туда')
      return !ветки.includes('assets.url')
        && !/case 'assets\.[a-z]+': \{[^}]*return await assetUrl/.test(src)
    })

    check('размер окна плагина не прибит в стилях', () => {
      // v1.479.0: у окошка в углу стояли width/height с !important — то есть
      // ручки по краям меняли модель, а на экране ничего не двигалось. Такое
      // расхождение показа и действия ловится только так: правилом в проверке.
      const css = readFileSync('src/styles.css', 'utf8')
      // Смотрим ВЕСЬ файл, а не кусок: первая попытка резала его по слову
      // «Телефон», а оно встречается в стилях раньше — и проверка молча
      // разбирала пустоту. Поймано нарочной поломкой.
      //
      // Телефонные правила выкидываем целиком: там окно и правда прибито к
      // экрану намеренно (окошко в углу становится шторкой на 45% высоты), и
      // это не та беда, которую мы ищем. Ищем прибитый размер на БОЛЬШОМ
      // экране, где размером распоряжается человек.
      const безТелефона = (() => {
        let out = '', i = 0
        while (i < css.length) {
          const м = css.indexOf('@media', i)
          if (м < 0) { out += css.slice(i); break }
          out += css.slice(i, м)
          let j = css.indexOf('{', м), гл = 0
          for (; j < css.length; j++) {
            if (css[j] === '{') гл++
            else if (css[j] === '}' && --гл === 0) { j++; break }
          }
          i = j
        }
        return out
      })()
      const правила = [...безТелефона.matchAll(/(\.plugapp[^{}]*)\{([^}]*)\}/g)]
      const плохо = правила
        // width/height с !important и КОНКРЕТНЫМ размером. «auto !important» в
        // телефонном блоке — это наоборот снятие размера, и оно законно.
        .filter(m => /(width|height)\s*:\s*[^;]*\d[^;]*!important/.test(m[2]))
        .map(m => m[1].trim() + ' {' + m[2].trim() + '}')
      if (плохо.length) throw new Error('размер прибит: ' + плохо.join(' | ').slice(0, 140))
      return true
    })

    check('приложение показывает свой файл, а не его адрес из плагина', () => {
      // Картинку в панели рисует общий компонент, и «asset:» он разбирает сам,
      // подставляя адрес своего же плагина. Иначе плагину пришлось бы отдать
      // настоящую ссылку — то есть нарушить правило 2.
      const panels = readFileSync('src/components/PluginPanels.tsx', 'utf8')
      const settings = readFileSync('src/components/PluginsSettings.tsx', 'utf8')
      const bridge = readFileSync('src/lib/plugins/bridge.ts', 'utf8')
      // И спрашивает адрес через прослойку: свой ленивый импорт отсюда был бы
      // вторым входом в систему плагинов (см. bridge.ts, v1.469.0).
      return panels.includes('function AssetImg') && /asset:/.test(panels)
        && panels.includes('pluginAssetUrl') && !panels.includes("import('../lib/plugins/assets')")
        && bridge.includes('assetUrlFor') && settings.includes('AssetImg')
    })
  }

  // ── Геймпад (v1.473.0) ──────────────────────────────────────────────────
  //
  // Живого геймпада у меня нет, и это ровно тот случай, когда всю смысловую
  // часть надо вынести в чистую функцию и проверить её без железа.
  console.log('\n-- Геймпад --')
  {
    const G = await import('./gamepads')
    const пад = (buttons: number[], axes: number[] = [], index = 0): any =>
      ({ index, id: 'проба', buttons, axes })

    check('изменений нет — событий нет', () =>
      G.diffPads([пад([0, 0], [0, 0])], [пад([0, 0], [0, 0])]).length === 0)

    check('нажатие и отпускание — два разных события', () => {
      const вниз = G.diffPads([пад([0])], [пад([1])])
      const вверх = G.diffPads([пад([1])], [пад([0])])
      return вниз.length === 1 && вниз[0].kind === 'button' && вниз[0].pressed === true
        && вверх.length === 1 && вверх[0].pressed === false
    })

    check('удержание не шлёт событие каждый кадр', () =>
      G.diffPads([пад([1])], [пад([1])]).length === 0)

    check('подключение и отключение замечаются', () => {
      const вкл = G.diffPads([], [пад([0])])
      const выкл = G.diffPads([пад([0])], [])
      return вкл.length === 1 && вкл[0].kind === 'connect'
        && выкл.length === 1 && выкл[0].kind === 'disconnect'
    })

    check('нажатая при подключении кнопка не считается нажатием', () => {
      // Иначе игра получала бы «выстрел» в момент подключения геймпада.
      const ev = G.diffPads([], [пад([1, 1])])
      return ev.length === 1 && ev[0].kind === 'connect'
    })

    check('мёртвая зона глушит лежащий на столе геймпад', () =>
      G.deadzone(0.1) === 0 && G.deadzone(-0.1) === 0
      && G.deadzone(1) === 1 && G.deadzone(-1) === -1
      && G.deadzone(0.5) > 0 && G.deadzone(0.5) < 0.5)

    check('дрожание ручки на сотую не становится событием', () =>
      G.diffPads([пад([], [0.5])], [пад([], [0.51])]).length === 0
      && G.diffPads([пад([], [0.5])], [пад([], [0.7])]).length === 1)

    check('курок наполовину виден как значение, а не как «нажат»', () => {
      const ev = G.diffPads([пад([0])], [пад([0.3])])
      return ev.length === 0            // 0.3 — ещё не нажатие
        && G.diffPads([пад([0])], [пад([0.9])]).length === 1
    })

    check('второй геймпад не путается с первым', () => {
      const было = [пад([0], [], 0), пад([0], [], 1)]
      const стало = [пад([0], [], 0), пад([1], [], 1)]
      const ev = G.diffPads(было, стало)
      return ev.length === 1 && ev[0].index === 1
    })

    check('без геймпадов и без API опрос отвечает пустым списком, а не падает', () =>
      Array.isArray(G.readPads()) && G.readPads().length === 0)

    check('пока никто не подписан, опроса нет', () => {
      if (G.gamepadsWatching() !== 0) return false
      G.watchGamepads('a'); G.watchGamepads('b')
      if (G.gamepadsWatching() !== 2) return false
      G.unwatchGamepads('a')
      if (G.gamepadsWatching() !== 1) return false
      G.unwatchAllGamepads()
      return G.gamepadsWatching() === 0
    })

    check('события уходят наружу одним местом', () => {
      // Иначе появилось бы второе, и одно из них однажды забыли бы снять.
      const host = readFileSync('src/lib/plugins/host.ts', 'utf8')
      return /setGamepadEmit\(/.test(host) && host.includes("emitPluginEvent('gamepad'")
    })
  }

  console.log('\n-- WebAssembly в песочнице --')
  {
    // WASM работал всегда: воркеру он доступен, и в списке вырезаемого его нет.
    // Проверка не даёт этому измениться молча — а живая проба (Electron)
    // подтвердила, что модуль правда собирается и считает.
    check('WebAssembly не вырезан из песочницы', () => {
      const kill = BOOTSTRAP_SRC.slice(BOOTSTRAP_SRC.indexOf('const KILL = ['),
        BOOTSTRAP_SRC.indexOf(']', BOOTSTRAP_SRC.indexOf('const KILL = [')))
      if (/WebAssembly/.test(kill)) throw new Error('WebAssembly попал в список вырезаемого')
      return kill.includes('fetch') && kill.includes('WebSocket')
    })
    check('в инструкции сказано, что WebAssembly работает', () =>
      PLUGIN_SPEC.includes('WebAssembly') && /разрешения не нужно|отдельного разрешения/.test(PLUGIN_SPEC))
  }

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
