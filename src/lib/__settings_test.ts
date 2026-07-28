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

console.log('\n── Ломаем нарочно ──')
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
