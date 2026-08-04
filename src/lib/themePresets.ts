// v1.460.0: свои темы — наборами, а не одним набором цветов.
//
// Что было. Свои цвета задавались, но набор был РОВНО ОДИН. Собрал тему под
// вечер, захотел светлую на день — старую надо запомнить на бумажке и потом
// вбить заново по шести полям. И поделиться ею было нечем: тема жила в
// хранилище браузера и наружу не выходила никак.
//
// Что теперь: сохранённые темы со своими названиями, переключение между ними и
// код для обмена — короткая строка, которую можно кинуть другу в чат.
//
// Почему код, а не файл. Тема — это шесть цветов; файл ради двадцати байт это
// издевательство. Строку можно вставить прямо в переписку, и она останется
// читаемой.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

export interface ThemeColors {
  dark: string
  content: string
  panel: string
  hover: string
  active: string
  accent: string
}

export interface Preset {
  /** Имя, которое дал человек. */
  name: string
  colors: ThemeColors
  /** Когда сохранили (мс) — по нему список идёт свежими сверху. */
  at: number
}

export const COLOR_KEYS: (keyof ThemeColors)[] = ['dark', 'content', 'panel', 'hover', 'active', 'accent']

/** Сколько тем храним. Больше — это уже не «свои темы», а свалка. */
export const MAX_PRESETS = 24
export const MAX_NAME = 40

const KEY = 'ponoi_theme_presets_v1'

const HEX = /^#[0-9a-f]{6}$/i

/** Цвет или null. Мусор не пропускаем: одна кривая строка в наборе — и тема
 *  применится наполовину, а выглядеть это будет как сломанное приложение. */
export function okColor(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return HEX.test(s) ? s.toLowerCase() : null
}

/** Полный ли это набор цветов. */
export function okColors(v: unknown): ThemeColors | null {
  if (!v || typeof v !== 'object') return null
  const out = {} as ThemeColors
  for (const k of COLOR_KEYS) {
    const c = okColor((v as any)[k])
    if (!c) return null
    out[k] = c
  }
  return out
}

export function loadPresets(): Preset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .map((p: any) => {
        const c = okColors(p?.colors)
        const name = String(p?.name ?? '').trim().slice(0, MAX_NAME)
        return c && name ? { name, colors: c, at: Number(p?.at) || 0 } : null
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.at - a.at) as Preset[]
  } catch { return [] }
}

function save(list: Preset[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PRESETS))) } catch { /* переполнено */ }
}

/** Добавить или заменить по имени. Одинаковое имя — замена, а не второй такой
 *  же пункт: иначе список забивается «Моя тема», «Моя тема», «Моя тема». */
export function addPreset(list: readonly Preset[], name: string, colors: ThemeColors, now = Date.now()): Preset[] {
  const имя = String(name ?? '').trim().slice(0, MAX_NAME) || 'Без названия'
  const без = list.filter(p => p.name.toLowerCase() !== имя.toLowerCase())
  const next = [{ name: имя, colors, at: now }, ...без].slice(0, MAX_PRESETS)
  save(next)
  return next
}

export function removePreset(list: readonly Preset[], name: string): Preset[] {
  const next = list.filter(p => p.name.toLowerCase() !== String(name).toLowerCase())
  save(next)
  return next
}

// ── Обмен темой ─────────────────────────────────────────────────────────────
//
// Вид кода: `ponoi-theme:<имя>:<6 цветов через дефис, без решёток>`. Читаемый
// намеренно — по нему видно, что это тема, а не непонятная строка, которую
// страшно вставлять.

export const CODE_PREFIX = 'ponoi-theme:'

export function encodeTheme(name: string, c: ThemeColors): string {
  const имя = String(name ?? '').trim().slice(0, MAX_NAME).replace(/[:\s]+/g, ' ') || 'Тема'
  return CODE_PREFIX + имя + ':' + COLOR_KEYS.map(k => c[k].replace('#', '')).join('-')
}

/** Разобрать код. null — это не тема: молча применять чужую строку нельзя. */
export function decodeTheme(code: string): { name: string; colors: ThemeColors } | null {
  const s = String(code ?? '').trim()
  if (!s.toLowerCase().startsWith(CODE_PREFIX)) return null
  const тело = s.slice(CODE_PREFIX.length)
  const i = тело.lastIndexOf(':')
  if (i <= 0) return null
  const name = тело.slice(0, i).trim().slice(0, MAX_NAME)
  const части = тело.slice(i + 1).split('-').map(x => x.trim())
  if (части.length !== COLOR_KEYS.length) return null
  const colors = {} as ThemeColors
  for (let k = 0; k < COLOR_KEYS.length; k++) {
    const c = okColor('#' + части[k])
    if (!c) return null
    colors[COLOR_KEYS[k]] = c
  }
  return name ? { name, colors } : null
}
