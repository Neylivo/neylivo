// v1.465.0: разговор плагинов между собой.
//
// Зачем. Плагин был островом: он мог дотянуться до приложения и до интернета, но
// не до соседа. Значит, каждый плагин обязан уметь всё сам — и плагин-график не
// мог опереться на плагин-математику, а плагин-переводчик на плагин-словарь.
// Никакой экосистемы из таких островов не выйдет.
//
// Что здесь. Только правила пересылки. Само хождение сообщений — в host.ts, там
// живут песочницы; проверка разрешения — в api.ts, там живут все проверки.
// Здесь то, что можно проверить отдельно и чем нельзя пренебречь.
//
// ГЛАВНОЕ ПРАВИЛО: через это письмо нельзя передать функцию.
//
// В песочнице функция при отправке превращается в метку {__fn: 'cb7'} — по ней
// приложение зовёт обработчик ВНУТРИ того плагина, который её прислал. Если бы
// такая метка доехала до соседа, сосед получил бы кнопку, нажимающую чужой код в
// чужом плагине с чужими разрешениями: плагин без разрешения на сеть попросил бы
// соседа сходить в интернет. Поэтому метки вырезаются, а не пересылаются.
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

/** Насколько глубоко разрешено вкладывать данные. Глубже — почти наверняка цикл. */
export const IPC_MAX_DEPTH = 8
/** Сколько знаков занимает письмо в JSON. Больше — это уже не письмо, а файл. */
export const IPC_MAX_BYTES = 256 * 1024
/** Длина имени события. */
export const IPC_MAX_EVENT = 60

export class IpcError extends Error {}

/**
 * Очистка письма: остаются только данные, которые можно записать в JSON.
 *
 * Функции и метки функций вырезаются (см. выше — это утечка прав). Всё
 * непередаваемое (Map, Set, класс, undefined) превращается в null, а не роняет
 * пересылку: плагин, приславший лишнее, должен получить письмо без него, а не
 * молчание.
 */
export function sanitizeIpc(v: unknown, depth = 0): unknown {
  if (depth > IPC_MAX_DEPTH) return null
  if (v === null) return null
  const t = typeof v
  if (t === 'string' || t === 'boolean') return v
  if (t === 'number') return Number.isFinite(v as number) ? v : null
  if (t === 'function' || t === 'undefined' || t === 'symbol' || t === 'bigint') return null
  if (Array.isArray(v)) return v.slice(0, 5000).map(x => sanitizeIpc(x, depth + 1))
  if (t === 'object') {
    // Метка функции — то самое, ради чего эта очистка и написана.
    if (isFnLike(v)) return null
    const src = v as Record<string, unknown>
    // Обычный объект, а не Date/Map/RegExp: у тех своё содержимое, и через
    // JSON они всё равно не проедут в узнаваемом виде.
    if (v instanceof Date) return (v as Date).toISOString()
    const out: Record<string, unknown> = {}
    let n = 0
    for (const k of Object.keys(src)) {
      if (++n > 500) break
      out[k] = sanitizeIpc(src[k], depth + 1)
    }
    return out
  }
  return null
}

/** Метка функции из песочницы — {__fn: 'cb7'}. */
function isFnLike(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as { __fn?: unknown }).__fn === 'string'
}

/** Есть ли где-нибудь внутри метка функции. Нужно проверкам: очистка обязана
 *  вырезать их на любой глубине, а не только на верхнем уровне. */
export function hasFnRef(v: unknown, depth = 0): boolean {
  if (depth > IPC_MAX_DEPTH + 2 || !v || typeof v !== 'object') return false
  if (isFnLike(v)) return true
  if (Array.isArray(v)) return v.some(x => hasFnRef(x, depth + 1))
  return Object.values(v as Record<string, unknown>).some(x => hasFnRef(x, depth + 1))
}

/** Имя события письма. Пустое и слишком длинное — отказ с объяснением. */
export function checkEventName(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) throw new IpcError('ponoi.plugins.send: вторым доводом нужно имя события')
  return s
}

/**
 * Готовое к пересылке письмо или отказ.
 *
 * Размер меряется ПОСЛЕ очистки: иначе можно было бы прислать огромный объект из
 * одних функций, пройти по размеру и заставить приложение его обходить.
 */
export function packIpc(event: unknown, data: unknown): { event: string; data: unknown } {
  const ev = checkEventName(event)
  const clean = sanitizeIpc(data)
  let size = 0
  // Ссылки на самих себя очистка обрывает сама: глубже IPC_MAX_DEPTH идёт null,
  // то есть цикла в очищенных данных не остаётся. Но полагаться на рассуждение
  // там, где можно поймать, — плохая привычка: не сосчиталось, значит не шлём.
  try { size = JSON.stringify(clean ?? null).length } catch {
    throw new IpcError('Такие данные переслать нельзя')
  }
  if (size > IPC_MAX_BYTES) {
    throw new IpcError(`Письмо слишком большое: ${Math.round(size / 1024)} КБ, можно до ${IPC_MAX_BYTES / 1024} КБ`)
  }
  return { event: ev, data: clean }
}
