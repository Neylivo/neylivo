// v1.337.0: проверка того, что настройки действительно сохраняются.
//
// Зачем. «Сохранение не работает» — жалоба, которую нельзя проверить чтением
// кода: настройка может честно записаться в localStorage и тут же быть затёрта
// синхронизацией, или не иметь значения по умолчанию и исчезнуть при следующей
// загрузке. Здесь каждый ключ настроек проходит настоящий круг: записали —
// перечитали — сравнили.
//
// Запуск: npm run test:settings
export {}   // файл — модуль: иначе await на верхнем уровне не разрешён
import { CH_VIEW, CH_SEND, CH_DEFAULT, MANAGE_CHANNELS, channelPermissions, triOf, setTri, parseOverrides, mergeLegacy, stripLegacy, normOverrides, fromNorm, legacyFromOverrides, userKey, type Overrides } from './chanPerms'

// ── Заглушки браузера ────────────────────────────────────────────────────────
// Модули настроек написаны под браузер; в Node их нет, поэтому подкладываем
// минимум — ровно то, что они трогают.
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
}
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  setTimeout: setTimeout, clearTimeout: clearTimeout,
}
;(globalThis as any).document = {
  body: { style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
  documentElement: { style: { setProperty: () => {}, removeProperty: () => {} }, setAttribute: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
  head: { appendChild: () => {} },
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
  querySelector: () => null,
  getElementById: () => null,
}
// В Node navigator только для чтения — подменяем через defineProperty.
try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'ru-RU' }, configurable: true }) } catch {}

const { DEFAULTS, ACCOUNT_KEYS, loadSettings, saveSettings } = await import('./settingsStore')

let pass = 0, fail = 0
const ok = (n: string) => { pass++; console.log('OK   ' + n) }
const bad = (n: string, why?: string) => { fail++; console.log('ПРОВАЛ ' + n + (why ? ' — ' + why : '')) }
function check(name: string, fn: () => boolean | void) {
  try { const r = fn(); if (r === false) bad(name); else ok(name) }
  catch (e: any) { bad(name, e?.message ?? String(e)) }
}

/** Другое осмысленное значение того же типа — чтобы отличалось от исходного. */
function otherValue(v: unknown): unknown {
  if (typeof v === 'boolean') return !v
  if (typeof v === 'number') return v + 7
  if (typeof v === 'string') return v === 'проверка' ? 'проверка2' : 'проверка'
  if (Array.isArray(v)) return [...v, 'проверка']
  if (v && typeof v === 'object') return { ...(v as object), __проверка: 1 }
  return 'проверка'
}

console.log('── Каждая настройка переживает сохранение ──')

const keys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]
check(`настроек в списке: ${keys.length}`, () => keys.length > 20)

// Ключи, у которых «другое значение» обязано быть из своего набора: подставлять
// им произвольную строку бессмысленно — приложение их не примет.
const ENUMS: Partial<Record<string, unknown>> = {
  sendKey: 'ctrl',
  defaultServerNotif: 'mentions',
  composerStyle: 'neon',
  theme: 'light',
  lang: 'en',
}

let broken: string[] = []
for (const k of keys) {
  store.clear()
  const before = loadSettings()
  const next = (ENUMS as any)[k] ?? otherValue(before[k])
  saveSettings({ ...before, [k]: next } as any)
  const after = loadSettings()
  const same = JSON.stringify(after[k]) === JSON.stringify(next)
  if (!same) broken.push(`${String(k)}: сохранили ${JSON.stringify(next)}, прочитали ${JSON.stringify(after[k])}`)
}
if (broken.length) bad('все настройки переживают перезагрузку', broken.join('; '))
else ok('все настройки переживают перезагрузку')

// Настройка без значения по умолчанию однажды прочитается как undefined и
// «пропадёт» — для человека это выглядит как несохранившийся выбор.
check('у каждой настройки есть значение по умолчанию', () => {
  const missing = keys.filter(k => DEFAULTS[k] === undefined)
  if (missing.length) throw new Error('нет умолчания: ' + missing.join(', '))
  return true
})

// Account-настройки синхронизируются через user_prefs и накладываются ПОВЕРХ
// локальных при каждой загрузке. Если такой ключ отсутствует в DEFAULTS или
// пишется мимо синхронизации, он будет откатываться сам собой.
check('account-настройки перечислены среди обычных', () => {
  const stray = ACCOUNT_KEYS.filter(k => !(k in DEFAULTS))
  if (stray.length) throw new Error('в ACCOUNT_KEYS есть неизвестные: ' + stray.join(', '))
  return true
})

// ── v1.443.0: перекрытия прав канала ────────────────────────────────────────
// Здесь проверяется арифметика, по которой ЭКРАН показывает галки. Та же самая
// логика на настоящем Postgres прогоняется в npm run test:db — если эти два
// набора разойдутся, экран начнёт врать про то, что делает база.
console.log('\n── Права канала ──')
const роль = '11111111-1111-1111-1111-111111111111'
const иная = '22222222-2222-2222-2222-222222222222'
const кто  = '33333333-3333-3333-3333-333333333333'
const итог = (ov: Overrides, roleIds: string[] = [роль], serverPerms = 0, isOwner = false) =>
  channelPermissions({ ov, serverPerms, roleIds, userId: кто, isOwner })

check('без перекрытий даны и просмотр, и отправка', () =>
  (итог({}) & CH_SEND) !== 0 && (итог({}) & CH_VIEW) !== 0)

check('запрет для всех отбирает отправку', () => {
  const ov = setTri({}, 'everyone', CH_SEND, 'deny')
  return (итог(ov) & CH_SEND) === 0 && (итог(ov) & CH_VIEW) !== 0
})

check('роль возвращает то, что отобрано у всех', () => {
  let ov = setTri({}, 'everyone', CH_SEND, 'deny')
  ov = setTri(ov, роль, CH_SEND, 'allow')
  return (итог(ov) & CH_SEND) !== 0 && (итог(ov, [иная]) & CH_SEND) === 0
})

check('личное разрешение сильнее запрета роли', () => {
  let ov = setTri({}, роль, CH_SEND, 'deny')
  ov = setTri(ov, userKey(кто), CH_SEND, 'allow')
  return (итог(ov) & CH_SEND) !== 0
})

check('личный запрет сильнее разрешения роли', () => {
  let ov = setTri({}, роль, CH_SEND, 'allow')
  ov = setTri(ov, userKey(кто), CH_SEND, 'deny')
  return (итог(ov) & CH_SEND) === 0
})

check('порядок ролей на итог не влияет', () => {
  let ov = setTri({}, роль, CH_SEND, 'deny')
  ov = setTri(ov, иная, CH_SEND, 'allow')
  // Запреты всех ролей применяются раньше разрешений, поэтому «разрешено».
  return итог(ov, [роль, иная]) === итог(ov, [иная, роль])
       && (итог(ov, [роль, иная]) & CH_SEND) !== 0
})

check('владельца и управляющего каналами перекрытия не запирают', () => {
  const ov = setTri({}, 'everyone', CH_SEND, 'deny')
  return (итог(ov, [роль], 0, true) & CH_SEND) !== 0
      && (итог(ov, [роль], MANAGE_CHANNELS) & CH_SEND) !== 0
})

check('галка показывает ровно то, что записано', () => {
  let ov = setTri({}, роль, CH_VIEW, 'deny')
  ov = setTri(ov, роль, CH_SEND, 'allow')
  return triOf(ov, роль, CH_VIEW) === 'deny'
      && triOf(ov, роль, CH_SEND) === 'allow'
      && triOf(ov, иная, CH_SEND) === 'default'
})

check('возврат в «по умолчанию» убирает пустую запись', () => {
  const ov = setTri(setTri({}, роль, CH_SEND, 'deny'), роль, CH_SEND, 'default')
  return Object.keys(ov).length === 0
})

check('мусор из базы не открывает доступ', () => {
  const ov = parseOverrides({ everyone: { a: 'всё', d: null }, плохое: 5, [роль]: { d: CH_SEND } })
  return (channelPermissions({ ov, serverPerms: 0, roleIds: [роль], userId: кто, isOwner: false }) & CH_SEND) === 0
      && triOf(ov, 'everyone', CH_SEND) === 'default'
})

check('старая настройка «только для чтения» переносится в перекрытие', () => {
  const ov = mergeLegacy({}, { send: 'deny' })
  return triOf(ov, 'everyone', CH_SEND) === 'deny'
      && !('send' in stripLegacy({ send: 'deny' }))
})

check('перенос не затирает уже настроенное перекрытие', () => {
  const было = setTri({}, 'everyone', CH_SEND, 'allow')
  return triOf(mergeLegacy(было, { send: 'deny' }), 'everyone', CH_SEND) === 'allow'
})

check('запрет для всех остаётся и в старой карте — на случай неприменённой миграции', () => {
  const запрет = setTri({}, 'everyone', CH_SEND, 'deny')
  const снято  = setTri(запрет, 'everyone', CH_SEND, 'default')
  return legacyFromOverrides(запрет, {}).send === 'deny'
      && !('send' in legacyFromOverrides(снято, { send: 'deny' }))
})

check('запрет роли в старую карту не попадает', () =>
  // Иначе «нельзя одной роли» превратилось бы в «нельзя всем».
  !('send' in legacyFromOverrides(setTri({}, роль, CH_SEND, 'deny'), {})))

check('сравнение «изменилось ли» не зависит от порядка ключей', () =>
  normOverrides({ everyone: { a: 0, d: CH_SEND }, [роль]: { a: CH_SEND, d: 0 } })
    === normOverrides({ [роль]: { a: CH_SEND, d: 0 }, everyone: { a: 0, d: CH_SEND } }))

check('«Сбросить» возвращает ровно те же перекрытия', () => {
  // Кнопка сброса восстанавливает состояние из сохранённой строки: если разбор
  // теряет хоть один бит, человек увидит не то, что лежит в базе.
  let было = setTri({}, 'everyone', CH_VIEW, 'deny')
  было = setTri(было, роль, CH_SEND, 'allow')
  было = setTri(было, userKey(кто), CH_SEND, 'deny')
  return normOverrides(fromNorm(normOverrides(было))) === normOverrides(было)
})

console.log('\n── Ломаем нарочно ──')
check('проверка замечает перекрытие, которое не применяется', () => {
  // Как если бы запрет сохранялся, но арифметика его не учитывала.
  const ov = setTri({}, 'everyone', CH_SEND, 'deny')
  const мимо = (0 | CH_DEFAULT) & ~0   // «забыли» вычесть запрет
  return (мимо & CH_SEND) !== 0 && (итог(ov) & CH_SEND) === 0   // расхождение видно
})

check('проверка замечает настройку, которая не сохраняется', () => {
  store.clear()
  const before = loadSettings()
  // Пишем «мимо» — как если бы ключа не было в сохраняемом объекте.
  saveSettings({ ...before, compact: !before.compact } as any)
  store.set('ponoi_settings', JSON.stringify({ ...before }))
  const after = loadSettings()
  return after.compact === before.compact   // значение НЕ поменялось — поломка видна
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
