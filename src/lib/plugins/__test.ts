// v1.333.0: проверка плагинов «от нас» и загрузчика песочницы.
//
// Зачем. Плагин — это строка с кодом: опечатка в нём не ловится ни tsc, ни
// сборкой, она вылезет только когда человек нажмёт «Установить» и увидит
// «плагин не запустился». Здесь каждый официальный плагин по-настоящему
// разбирается, запускается тем же способом, что и в песочнице, и обязан
// зарегистрировать то, что обещает в описании.
//
// Запуск: npm run test:plugins
import { parsePlugin } from './manifest'
import { OFFICIAL_PLUGINS } from './official'
import { ALL_PERMISSIONS } from './types'
import { TEMPLATES, buildFile, draftFrom, draftFromTemplate, slugify } from './editorDraft'

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

/** Заглушка ponoi: записывает всё, что плагин попросил, и ничего не делает. */
function stubPonoi() {
  const calls = {
    commands: [] as string[],
    settingsPages: [] as any[],
    events: [] as string[],
    css: 0,
    sent: [] as string[],
    notified: [] as string[],
  }
  const ponoi: any = {
    css: (t: string) => { calls.css++; if (typeof t !== 'string') throw new Error('css: не строка') },
    ui: {
      addComposerButton: () => {},
      addMessageAction: () => {},
      addSettingsPage: (o: any) => {
        if (!o?.title || !Array.isArray(o.rows)) throw new Error('addSettingsPage: нет title/rows')
        for (const r of o.rows) {
          if (!r?.key || !r?.label) throw new Error('строка настроек без key/label')
          if (!['toggle', 'text', 'select', 'button'].includes(r.type)) throw new Error('неизвестный тип строки: ' + r.type)
          if (r.type === 'select' && !(Array.isArray(r.options) && r.options.length)) throw new Error('select без вариантов')
        }
        calls.settingsPages.push(o)
      },
    },
    commands: {
      register: async (name: string, desc: string, handler: any) => {
        if (typeof handler !== 'function') throw new Error('команда без обработчика')
        if (!desc) throw new Error('команда без описания')
        calls.commands.push(name)
      },
    },
    messages: { send: async (t: string) => { calls.sent.push(String(t)) } },
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    net: { fetch: async () => ({ ok: true, status: 200, body: '' }) },
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

  console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
  process.exit(fail ? 1 : 0)
})()
