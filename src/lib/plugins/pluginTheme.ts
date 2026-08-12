// v1.465.0: цвета оформления от плагина — безопасная замена полному CSS.
//
// Зачем отдельно от разрешения css. Разрешение css отдаёт плагину ВЁРСТКУ: он
// может спрятать что угодно, накрыть экран непрозрачным слоем и подделать чужое
// окно — ради этого в приложении и держится аварийный режим (?safe=1). Между тем
// девяти плагинам из десяти нужно не это, а перекрасить приложение.
//
// Здесь плагин не пишет CSS вовсе. Он присылает СЛОВАРЬ: имя цвета → цвет.
// Имена — из закрытого списка, значения — только шестизначный hex. Ни ссылок, ни
// url(), ни фигурных скобок, ни !important от плагина: строку собирает
// приложение из уже проверенных кусков, и подставить туда своё нельзя.
//
// Почему не через inline-стиль корня. Приложение само пишет эти переменные в
// document.documentElement.style при каждой смене настроек (см. settings.tsx,
// функция apply) — плагинская правка была бы стёрта первым же переключением
// темы. Поэтому цвета плагина живут отдельным <style> с !important: правило из
// таблицы с !important сильнее обычного inline-значения, и переживает apply().
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

/**
 * Что плагину можно перекрасить.
 *
 * Слева — понятное имя, справа — настоящая переменная приложения. Имена
 * приведены к тому, как их называет человек, а не к тому, как они записаны в
 * styles.css: плагин не обязан знать наши сокращения, а мы не обязаны навсегда
 * привязываться к своим именам.
 *
 * Списка достаточно для «перекрасить приложение целиком» и мало для «сломать
 * вёрстку»: ни одного размера, отступа и шрифта здесь нет намеренно.
 */
export const THEME_VARS: Record<string, string> = {
  'bg-dark': '--c-dark',        // самый тёмный слой: колонка серверов
  'bg-panel': '--c-panel',      // колонка каналов
  'bg-main': '--c-main',        // фон приложения
  'bg-content': '--c-content',  // фон переписки
  'hover': '--c-hover',         // подсветка под курсором
  'active': '--c-active',       // выбранная строка
  'accent': '--c-accent',       // цвет кнопок и ссылок
  'text': '--tx',               // основной текст
  'text-muted': '--mut',        // приглушённый текст
}

export const THEME_VAR_NAMES = Object.keys(THEME_VARS)

const HEX = /^#[0-9a-f]{6}$/i

export class ThemeError extends Error {}

/**
 * Разбор словаря от плагина.
 *
 * Неизвестное имя — ОТКАЗ, а не тихий пропуск: плагин, написавший «--bg-primary»
 * из головы, должен увидеть ошибку, а не «применилось, но ничего не изменилось».
 * Именно так выглядит самая частая поломка в этом проекте.
 *
 * Значение — только #rrggbb. Не потому, что rgb() и hsl() плохи, а потому, что
 * любое расширение синтаксиса здесь — это место, куда однажды пролезет
 * `red;} body{display:none` или `url(https://чужой-сайт)`. Один формат легко
 * проверить целиком.
 */
export function parseTheme(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ThemeError('neylivo.ui.setTheme: нужен объект вида { accent: "#ff4500" }')
  }
  const out: Record<string, string> = {}
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0) throw new ThemeError('neylivo.ui.setTheme: пустой набор цветов')
  for (const [k, v] of entries) {
    // Ведущие дефисы прощаем: их пишут по привычке из CSS, и отказ из-за них
    // выглядел бы придиркой.
    const name = k.replace(/^-+/, '').trim()
    if (!(name in THEME_VARS)) {
      throw new ThemeError(`Неизвестный цвет «${k}». Есть: ${THEME_VAR_NAMES.join(', ')}.`)
    }
    const val = String(v ?? '').trim()
    if (!HEX.test(val)) throw new ThemeError(`Цвет «${k}» должен быть вида #rrggbb, а не «${val}».`)
    out[name] = val.toLowerCase()
  }
  return out
}

/**
 * Готовая строка стилей. Собирается только из проверенных кусков: имя взято из
 * нашей же таблицы, значение прошло HEX. Ничего из присланного плагином в текст
 * не попадает буквально.
 */
export function themeCss(pluginId: string, colors: Record<string, string>): string {
  const body = Object.entries(colors)
    .map(([name, val]) => `  ${THEME_VARS[name]}: ${val} !important;`)
    .join('\n')
  return `/* тема плагина ${pluginId.replace(/[^a-z0-9-]/gi, '')} */\n:root {\n${body}\n}\n`
}

// ── Применение ──────────────────────────────────────────────────────────────
// По одному <style> на плагин: выключили плагин — сняли ровно его цвета.

const els = new Map<string, HTMLStyleElement>()

export function applyPluginTheme(pluginId: string, colors: Record<string, string>) {
  if (typeof document === 'undefined') return
  let el = els.get(pluginId)
  if (!el) {
    el = document.createElement('style')
    el.dataset.pluginTheme = pluginId
    document.head.appendChild(el)
    els.set(pluginId, el)
  }
  el.textContent = themeCss(pluginId, colors)
}

export function clearPluginTheme(pluginId: string) {
  const el = els.get(pluginId)
  if (el) { el.remove(); els.delete(pluginId) }
}

/** Аварийный режим: снять цвета всех плагинов и вернуть приложению его вид. */
export function clearAllThemes() {
  for (const [, el] of els) el.remove()
  els.clear()
}

/** Кто сейчас перекрашивает приложение — для экрана плагинов и для проверок. */
export function themedPlugins(): string[] { return [...els.keys()] }
