// v1.473.0: геймпад плагину.
//
// Зачем. Плагин умеет рисовать на холсте во весь экран и хранить свои данные —
// то есть игру в нём написать уже можно. Управлять ею было нечем: клавиатура
// плагину доступна только сочетаниями, которые ловит приложение, а джойстика
// не было вовсе.
//
// Почему это здесь, а не в песочнице. `navigator.getGamepads` есть только у
// страницы: у воркера его нет и быть не может. Значит, опрашивает приложение, а
// плагину уходят готовые события. Ровно тот же приём, что с холстом: приложение
// даёт СОДЕРЖИМОЕ, а не доступ.
//
// Почему опрос, а не события. У геймпада событий нет ни одного, кроме
// подключения и отключения: нажатия читаются опросом состояния, так устроен сам
// браузерный API. Поэтому опрашиваем кадрами — и ТОЛЬКО пока хоть один плагин
// на это подписан. Ни одного подписчика — ни одного кадра: иначе приложение
// жгло бы батарею у всех ради возможности, которой почти никто не пользуется.
//
// Что уходит плагину. Только изменения: «нажали кнопку», «отпустили»,
// «сдвинули ручку». Слать полное состояние шестьдесят раз в секунду значит
// разбудить воркер шестьдесят раз в секунду и ничего этим не сообщить.
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

/** Состояние одного геймпада — то, что видит плагин. */
export interface PadState {
  index: number
  id: string
  buttons: number[]
  axes: number[]
}

/** Событие: что именно изменилось. */
export interface PadEvent {
  kind: 'connect' | 'disconnect' | 'button' | 'axis'
  index: number
  id: string
  /** Номер кнопки или ручки. У connect/disconnect его нет. */
  which?: number
  /** Кнопка нажата (для 'button'). */
  pressed?: boolean
  /** Насколько: у кнопки 0…1 (курки нажимаются наполовину), у ручки −1…1. */
  value?: number
}

/**
 * Мёртвая зона ручки.
 *
 * Без неё лежащий на столе геймпад шлёт события бесконечно: ручки почти никогда
 * не возвращаются ровно в ноль. Число обычное для игр — меньше 0.15 не берут
 * почти нигде.
 */
export const DEADZONE = 0.15
/** Насколько должна сдвинуться ручка, чтобы это стало событием. */
export const AXIS_STEP = 0.05
/** С какого нажатия курок считается нажатым, если браузер не сказал сам. */
export const PRESS_AT = 0.5

/** Ручка с учётом мёртвой зоны: в зоне — ровный ноль, за ней — от нуля до края. */
export function deadzone(v: number, zone = DEADZONE): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const a = Math.abs(n)
  if (a <= zone) return 0
  const масштаб = (a - zone) / (1 - zone)
  return Math.round((n < 0 ? -масштаб : масштаб) * 1000) / 1000
}

/**
 * Что изменилось между двумя снимками.
 *
 * Отдельной чистой функцией нарочно: живого геймпада для проверки у меня нет, а
 * ошибиться здесь легче всего — «событие на каждый кадр», «отпускание
 * потерялось», «отключение не заметили». Всё это проверяется без железа.
 */
export function diffPads(было: PadState[], стало: PadState[]): PadEvent[] {
  const out: PadEvent[] = []
  const прежние = new Map(было.map(p => [p.index, p]))
  const нынешние = new Map(стало.map(p => [p.index, p]))

  for (const p of стало) {
    const b = прежние.get(p.index)
    if (!b) {
      // Новый геймпад. Состояние кнопок при подключении не разбираем: нажатая в
      // момент подключения кнопка — это не «нажали», а «уже была нажата».
      out.push({ kind: 'connect', index: p.index, id: p.id })
      continue
    }
    const n = Math.max(b.buttons.length, p.buttons.length)
    for (let i = 0; i < n; i++) {
      const до = b.buttons[i] ?? 0
      const после = p.buttons[i] ?? 0
      const былоНажато = до >= PRESS_AT
      const сталоНажато = после >= PRESS_AT
      if (былоНажато !== сталоНажато) {
        out.push({ kind: 'button', index: p.index, id: p.id, which: i, pressed: сталоНажато, value: после })
      }
    }
    const m = Math.max(b.axes.length, p.axes.length)
    for (let i = 0; i < m; i++) {
      const до = b.axes[i] ?? 0
      const после = p.axes[i] ?? 0
      // Оба уже прошли мёртвую зону при снятии снимка, здесь только порог шага:
      // иначе дрожание ручки на сотую давало бы событие каждый кадр.
      if (Math.abs(после - до) >= AXIS_STEP) {
        out.push({ kind: 'axis', index: p.index, id: p.id, which: i, value: после })
      }
    }
  }

  for (const b of было) {
    if (!нынешние.has(b.index)) out.push({ kind: 'disconnect', index: b.index, id: b.id })
  }
  return out
}

/** Снимок состояния — из браузера. Отсутствие API это не ошибка: геймпадов
 *  просто нет, и плагин должен получить пустой список, а не отказ. */
export function readPads(): PadState[] {
  const nav: any = typeof navigator === 'undefined' ? null : navigator
  if (!nav || typeof nav.getGamepads !== 'function') return []
  let сырые: any[] = []
  try { сырые = Array.from(nav.getGamepads() ?? []) } catch { return [] }
  const out: PadState[] = []
  for (const g of сырые) {
    if (!g || g.connected === false) continue
    out.push({
      index: Number(g.index) || 0,
      // Название приходит от устройства — обрезаем, чтобы им нельзя было
      // забить ни журнал, ни событие.
      id: String(g.id ?? '').slice(0, 120),
      // Кнопка приходит объектом: у обычной value равен 1, у курка — насколько
      // нажат. Признак pressed ставит сам браузер, и он главнее нашего порога:
      // приподнимаем значение до порога, а не заменяем его единицей, чтобы
      // плагин видел настоящую силу нажатия курка.
      buttons: Array.from(g.buttons ?? []).map((b: any) =>
        typeof b === 'object'
          ? (b.pressed ? Math.max(Number(b.value) || 0, PRESS_AT) : Number(b.value) || 0)
          : Number(b) || 0),
      axes: Array.from(g.axes ?? []).map((a: any) => deadzone(Number(a) || 0)),
    })
  }
  return out
}

// ── Опрос ───────────────────────────────────────────────────────────────────

const наблюдатели = new Set<string>()
let кадр: number | null = null
let прошлое: PadState[] = []
let слать: ((ev: PadEvent) => void) | null = null

/** Кому уходят события. Ставится один раз, в host.ts. */
export function setGamepadEmit(fn: ((ev: PadEvent) => void) | null) { слать = fn }

function шаг() {
  кадр = null
  const сейчас = readPads()
  const события = diffPads(прошлое, сейчас)
  прошлое = сейчас
  if (слать) for (const e of события) { try { слать(e) } catch {} }
  if (наблюдатели.size) заказатьКадр()
}

function заказатьКадр() {
  if (кадр !== null) return
  if (typeof requestAnimationFrame === 'function') кадр = requestAnimationFrame(шаг)
  // В окружении без кадров (проверки) опрос просто не идёт: там его двигают руками.
}

/** Плагин подписался на 'gamepad'. */
export function watchGamepads(pluginId: string) {
  const первый = наблюдатели.size === 0
  наблюдатели.add(pluginId)
  if (первый) {
    // Начальное состояние берём СРАЗУ и молча: иначе первый же кадр объявил бы
    // «подключён» про геймпад, который был подключён и до плагина.
    прошлое = readPads()
    заказатьКадр()
  }
}

export function unwatchGamepads(pluginId: string) {
  наблюдатели.delete(pluginId)
  if (наблюдатели.size === 0) стоп()
}

export function unwatchAllGamepads() {
  наблюдатели.clear()
  стоп()
}

function стоп() {
  if (кадр !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(кадр)
  кадр = null
  прошлое = []
}

/** Идёт ли опрос — видно проверкам: «перестал ли он опрашивать после
 *  выключения плагина» иначе не проверить ничем. */
export function gamepadsWatching(): number { return наблюдатели.size }

/** Один шаг опроса руками — для проверок и живых проб. Заказанный кадр при
 *  этом отменяется: иначе после ручного шага их стало бы два. */
export function stepGamepads() {
  if (кадр !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(кадр)
  кадр = null
  шаг()
}
