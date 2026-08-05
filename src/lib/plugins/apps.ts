// v1.471.0: своя область экрана у плагина.
//
// Зачем. До этого плагину были доступны только уголки: панель на сто пикселей,
// строка в настройках, кнопка. Для «покажи погоду» этого хватает, для чего-то
// большего — нет: ни игры, ни редактора, ни доски, ни визуализатора во весь
// экран так не сделать. Всё, что просил владелец, — плавающее окно, вкладка,
// полный экран, картинка-в-картинке — упирается в одно и то же: плагину негде
// развернуться.
//
// ПОЧЕМУ ЭТО ОДИН ПРИМИТИВ, А НЕ ЧЕТЫРЕ.
//
// Плавающее окно, вкладка, полный экран и PiP отличаются ровно одним — МЕСТОМ.
// Всё остальное у них общее: заголовок, содержимое, закрытие, уборка при
// выключении плагина, уборка. Сделай их четырьмя системами — и через
// пару версий они разойдутся: в одной появится закрытие по Esc, в другой нет;
// одна будет убираться за плагином, другая останется висеть. Здесь место — это
// поле `mode`, и ничего больше.
//
// ЧТО НЕ ИЗМЕНИЛОСЬ. Плагин по-прежнему не рисует ничего сам: он описывает
// СТРОКИ (те же, что в панели, включая холст), а рисует их приложение.
//
// ЧТО ИЗМЕНИЛОСЬ (v1.489.0). Шапку у окна можно убрать совсем (frameless), и
// числа окон больше нет. Выход при этом остаётся всегда и ничего не занимает:
// Esc, «назад» на телефоне и строка окна на карточке плагина в настройках.
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

import type { SettingsRow } from './registry'

/**
 * Где живёт область.
 *
 * Список закрытый — по той же причине, что у панелей и пунктов меню: «где
 * угодно» означало бы, что плагин распоряжается экраном.
 */
export type AppMode = 'window' | 'pip' | 'tab' | 'fullscreen' | 'widget'

export const APP_MODES: Record<AppMode, string> = {
  window: 'Плавающее окно, его можно двигать',
  pip: 'Маленькое окошко в углу поверх всего',
  tab: 'Отдельная вкладка в рабочей области',
  fullscreen: 'Во весь экран поверх приложения',
  // v1.480.0: свободный виджет — маленькая штука без тяжёлой шапки, которую
  // человек ставит куда хочет. Появился вместо полосы над полем ввода:
  // владелец сказал про неё прямо — «уродски», и он прав. Полоса занимала
  // место у всех и всегда, а виджет стоит там, где его поставили, и только у
  // того, кто его поставил.
  widget: 'Свободный виджет — куда поставишь, там и будет',
}

// v1.489.0: сколько окон открыть и какого размера — дело плагина.
//
// Было «не больше трёх на плагин и шести всего», а размер зажимался в
// 240..1600 на 160..1200. Ни того, ни другого больше нет: окно может быть хоть
// в пиксель, хоть больше экрана, и окон может быть сколько угодно.
//
// Границы остались только там, где число обязано быть числом (clampSize ниже):
// ширина NaN или минус миллион — это не свобода, это неотрисовываемое окно.
export const MIN_W = 1, MAX_W = 100000
export const MIN_H = 1, MAX_H = 100000

export class AppError extends Error {}

export interface PluginApp {
  id: number
  pluginId: string
  title: string
  mode: AppMode
  icon: string
  rows: SettingsRow[]
  /** Размер для window и pip. Для tab и fullscreen не используется. */
  w: number
  h: number
  /** Где стоит окно — человек его двигает, плагин на это не влияет. */
  x: number | null
  y: number | null
  /**
   * Можно ли тянуть за края (v1.479.0). По умолчанию да: «окно, размер
   * которого не поменять» — это не окно, а картинка. Плагин может отказаться
   * от растягивания, если у него всё нарисовано под один размер.
   */
  resizable: boolean
  /** Ниже этого окно не сожмётся: содержимое должно оставаться видимым. */
  minW: number
  minH: number
  /** Развёрнуто ли на весь экран — по двойному щелчку по шапке. */
  max: boolean
  /** Размер и место ДО разворота, чтобы вернуть их обратно. */
  before: { x: number | null; y: number | null; w: number; h: number } | null
  /**
   * Окно без рамки (v1.487.0).
   *
   * Шапка, рамка и тень убираются: остаётся голое содержимое. Нужно всему, что
   * рисуется целиком само, — часам, накладке поверх игры, шару, который летает
   * между двумя окнами: наша шапка в таком окне выглядит чужой наклейкой.
   *
   * ЧТО ПРИ ЭТОМ НЕ ПРОПАДАЕТ. Шапка не удаляется, а прячется до наведения:
   * подвёл указатель — снова видно имя плагина и крестик. Плюс Esc закрывает
   * окно всегда, и перехватить его плагин не может (см. PluginApps.tsx). Без
   * этого «без рамки» означало бы окно, которое не убрать и которое выдаёт себя
   * за само приложение.
   */
  frameless: boolean
  /** Прозрачная подложка: фон, рамка и тень убираются совсем. */
  transparent: boolean
  /** Спрятано ли окно (apps.hide). Не закрыто: содержимое и холст живы. */
  hidden: boolean
  /** Переезжать и менять размер плавно, а не мгновенно. */
  smooth: boolean
}

/**
 * Память о месте окна (v1.479.0).
 *
 * Зачем. Человек поставил окно туда, где ему удобно, — и при следующем
 * открытии оно снова оказывалось посреди экрана. То есть настройка была, но не
 * держалась дольше одного раза, а это худший вид настройки.
 *
 * Ключ — плагин и заголовок окна, а не его номер: номер выдаётся заново при
 * каждом открытии. Хранится на устройстве: место окна — дело этого экрана, и
 * на телефоне оно другое.
 */
const МЕСТА_КЛЮЧ = 'ponoi_plugin_app_places_v1'
type Место = { x: number | null; y: number | null; w: number; h: number; max?: boolean }

function читатьМеста(): Record<string, Место> {
  try {
    const v = JSON.parse(localStorage.getItem(МЕСТА_КЛЮЧ) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

function писатьМесто(ключ: string, м: Место) {
  try {
    const все = читатьМеста()
    все[ключ] = м
    // Не даём списку расти вечно: помним последние полсотни окон.
    const ключи = Object.keys(все)
    if (ключи.length > 50) for (const k of ключи.slice(0, ключи.length - 50)) delete все[k]
    localStorage.setItem(МЕСТА_КЛЮЧ, JSON.stringify(все))
  } catch { /* переполнено — просто не запомним */ }
}

export const placeKey = (pluginId: string, title: string) => pluginId + '\u0000' + title

/** Забытое место окна — для проверок и для восстановления при открытии. */
export function savedPlace(pluginId: string, title: string): Место | null {
  flushPlaces()
  return читатьМеста()[placeKey(pluginId, title)] ?? null
}

export function forgetPlaces() {
  try { localStorage.removeItem(МЕСТА_КЛЮЧ) } catch {}
}

const apps = new Map<number, PluginApp>()
let seq = 0

const listeners = new Set<() => void>()
export function subscribeApps(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

export function isMode(v: unknown): v is AppMode {
  return typeof v === 'string' && v in APP_MODES
}

/** Число в своих границах: область с высотой в миллион не должна быть возможна. */
export function clampSize(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function openApp(pluginId: string, a: {
  title: string; mode: AppMode; icon: string; rows: SettingsRow[]; w?: unknown; h?: unknown
  x?: unknown; y?: unknown; resizable?: unknown; minW?: unknown; minH?: unknown
  frameless?: unknown; transparent?: unknown; smooth?: unknown
}): PluginApp {
  // v1.479.0: место и размер берём из памяти этого устройства, если человек их
  // уже выбирал. Плагин своим размером их не перебивает: он предлагает
  // размер по умолчанию, а решает человек — и его решение должно держаться.
  const было = savedPlace(pluginId, a.title)
  const minW = clampSize(a.minW, MIN_W, MAX_W, MIN_W)
  const minH = clampSize(a.minH, MIN_H, MAX_H, MIN_H)
  const app: PluginApp = {
    id: ++seq, pluginId,
    title: a.title, mode: a.mode, icon: a.icon, rows: a.rows,
    // Размер по умолчанию свой у каждого вида: окошко в углу должно быть
    // маленьким, обычное окно — рабочим. Раньше это стояло в стилях жёстко и
    // мешало человеку менять размер (см. .plugapp-pip в styles.css).
    w: было ? clampSize(было.w, minW, MAX_W, 480)
      : clampSize(a.w, minW, MAX_W, a.mode === 'pip' ? 300 : a.mode === 'widget' ? 280 : 480),
    h: было ? clampSize(было.h, minH, MAX_H, 360)
      : clampSize(a.h, minH, MAX_H, a.mode === 'pip' ? 200 : a.mode === 'widget' ? 160 : 360),
    // Плагин МОЖЕТ предложить место (например, чтобы окно не легло на другое
    // своё), но память человека главнее.
    x: было ? было.x : (a.x === undefined ? null : clampSize(a.x, 0, 10000, 0)),
    y: было ? было.y : (a.y === undefined ? null : clampSize(a.y, 0, 10000, 0)),
    resizable: a.resizable === undefined ? true : !!a.resizable,
    minW, minH,
    max: !!(было && было.max),
    before: null,
    frameless: !!a.frameless,
    transparent: !!a.transparent,
    hidden: false,
    smooth: !!a.smooth,
  }
  apps.set(app.id, app)
  notify()
  return app
}

/**
 * Обновить своё окно. Чужое — нельзя: иначе один плагин переписывал бы содержимое
 * другого перебором номеров.
 */
export function updateApp(pluginId: string, id: number, patch: {
  title?: string; rows?: SettingsRow[]; mode?: AppMode; w?: unknown; h?: unknown
  x?: unknown; y?: unknown; resizable?: unknown; minW?: unknown; minH?: unknown
  frameless?: unknown; transparent?: unknown; hidden?: unknown; smooth?: unknown
}): boolean {
  const a = apps.get(id)
  if (!a || a.pluginId !== pluginId) return false
  if (patch.title !== undefined) a.title = patch.title
  if (patch.rows !== undefined) a.rows = patch.rows
  if (patch.mode !== undefined) a.mode = patch.mode
  // v1.487.0: вид окна плагин меняет на лету — и рамку, и прозрачность, и то,
  // видно ли его вообще. Всё это про ЕГО собственный прямоугольник: ни чужого
  // окна, ни приложения вокруг это не касается.
  if (patch.frameless !== undefined) a.frameless = !!patch.frameless
  if (patch.transparent !== undefined) a.transparent = !!patch.transparent
  if (patch.hidden !== undefined) a.hidden = !!patch.hidden
  if (patch.smooth !== undefined) a.smooth = !!patch.smooth
  if (patch.minW !== undefined) a.minW = clampSize(patch.minW, MIN_W, MAX_W, a.minW)
  if (patch.minH !== undefined) a.minH = clampSize(patch.minH, MIN_H, MAX_H, a.minH)
  if (patch.resizable !== undefined) a.resizable = !!patch.resizable
  if (patch.w !== undefined) a.w = clampSize(patch.w, a.minW, MAX_W, a.w)
  if (patch.h !== undefined) a.h = clampSize(patch.h, a.minH, MAX_H, a.h)
  // v1.485.0: место плагин двигает СВОБОДНО.
  //
  // Раньше здесь стоял запрет: тронул окно человек — и плагин больше не мог
  // его переставить. Правило было моё, и владелец прямо попросил снять: «дай
  // полный доступ делать как угодно». Оно и мешало по делу — окно, которое
  // плагин анимирует (например, гоняет шар между двумя окнами), после первого
  // же перетаскивания застывало.
  //
  // Что осталось: пока человек ДЕРЖИТ окно мышью, движение плагина
  // игнорируется (см. тащат ниже) — иначе окно дёргалось бы прямо под рукой.
  if (!тащат.has(id)) {
    if (patch.x !== undefined) a.x = clampSize(patch.x, 0, 10000, a.x ?? 0)
    if (patch.y !== undefined) a.y = clampSize(patch.y, 0, 10000, a.y ?? 0)
  }
  notify()
  return true
}

/** Окна, которые человек ДЕРЖИТ прямо сейчас: пока держит, плагин их не двигает. */
const тащат = new Set<number>()

/** Человек взял окно в руку / отпустил. Зовёт компонент окна. */
export function holdApp(id: number, держит: boolean) {
  if (держит) тащат.add(id); else тащат.delete(id)
}

export function closeApp(pluginId: string, id: number): boolean {
  const a = apps.get(id)
  if (!a || a.pluginId !== pluginId) return false
  apps.delete(id)
  notify()
  return true
}

/** Человек нажал крестик. Владельца не проверяем: это его собственное действие. */
export function closeAppByUser(id: number): boolean {
  const ok = apps.delete(id)
  if (ok) notify()
  return ok
}

/** Куда человек перетащил окно. Хранится здесь, а не у плагина: место окна —
 *  дело человека, и плагин не должен возвращать его обратно. */
export function moveApp(id: number, x: number, y: number) {
  const a = apps.get(id)
  if (!a) return
  a.x = x
  a.y = y
  запомнить(a)
  notify()
}

/** Человек потянул за край. Размер — его дело, как и место. */
export function resizeApp(id: number, w: number, h: number, x?: number, y?: number) {
  const a = apps.get(id)
  if (!a || !a.resizable) return
  a.w = clampSize(w, a.minW, MAX_W, a.w)
  a.h = clampSize(h, a.minH, MAX_H, a.h)
  // Тянут за левый или верхний край — окно ещё и переезжает.
  if (x !== undefined) a.x = Math.max(0, Math.round(x))
  if (y !== undefined) a.y = Math.max(0, Math.round(y))
  a.max = false
  запомнить(a)
  notify()
}

/**
 * Развернуть на весь экран и обратно — двойным щелчком по шапке.
 *
 * Это НЕ режим fullscreen: тот выбирает плагин, а этот — человек, и вернуть
 * окно он может тем же движением. Прежние размер и место запоминаются, иначе
 * «развернул — свернул» теряло бы обжитое место.
 */
export function toggleMaxApp(id: number, screen: { w: number; h: number }): boolean {
  const a = apps.get(id)
  if (!a) return false
  if (a.max && a.before) {
    a.x = a.before.x; a.y = a.before.y; a.w = a.before.w; a.h = a.before.h
    a.max = false
    a.before = null
  } else {
    a.before = { x: a.x, y: a.y, w: a.w, h: a.h }
    a.x = 0; a.y = 0
    a.w = clampSize(screen.w, a.minW, MAX_W, a.w)
    a.h = clampSize(screen.h, a.minH, MAX_H, a.h)
    a.max = true
  }
  запомнить(a)
  notify()
  return a.max
}

/** Прижать окно к половине экрана — как в Windows, перетаскиванием к краю. */
export function snapApp(id: number, side: 'left' | 'right' | 'top' | 'bottom', screen: { w: number; h: number }) {
  const a = apps.get(id)
  if (!a) return
  const пополам = side === 'left' || side === 'right'
  a.w = clampSize(пополам ? Math.round(screen.w / 2) : screen.w, a.minW, MAX_W, a.w)
  a.h = clampSize(пополам ? screen.h : Math.round(screen.h / 2), a.minH, MAX_H, a.h)
  a.x = side === 'right' ? screen.w - a.w : 0
  a.y = side === 'bottom' ? screen.h - a.h : 0
  a.max = false
  запомнить(a)
  notify()
}

/**
 * Запомнить место — но НЕ на каждое движение мыши.
 *
 * v1.479.0: перетаскивание окна вызывает это по нескольку десятков раз в
 * секунду, и каждый вызов — это JSON.stringify всего списка окон и запись в
 * localStorage. Запись синхронная: на слабой машине она и есть та «тормозящая
 * мышь», которой быть не должно. Пишем не чаще раза в треть секунды, а
 * последнее положение дописываем обязательно — иначе потерялось бы ровно то,
 * на чём человек остановился.
 */
let когдаПисали = 0
let отложено: ReturnType<typeof setTimeout> | null = null
/** Что не успели записать. Держим отдельно от таймера: отменить таймер и
 *  ПОТЕРЯТЬ последнее положение — ровно та ошибка, которую поймала проба. */
let ждёт: { ключ: string; м: Место } | null = null

function записатьСейчас() {
  if (!ждёт) return
  писатьМесто(ждёт.ключ, ждёт.м)
  ждёт = null
  когдаПисали = Date.now()
}

function запомнить(a: PluginApp) {
  if (a.mode !== 'window' && a.mode !== 'pip' && a.mode !== 'widget') return
  ждёт = { ключ: placeKey(a.pluginId, a.title), м: { x: a.x, y: a.y, w: a.w, h: a.h, max: a.max } }
  if (Date.now() - когдаПисали >= 300) { записатьСейчас(); return }
  if (отложено) clearTimeout(отложено)
  отложено = setTimeout(() => { отложено = null; записатьСейчас() }, 300)
}

/**
 * Дописать отложенное немедленно.
 *
 * Нужно всем, кто спрашивает «а где стоит окно» сразу после того, как его
 * подвинули: проверки, закрытие окна, уборка за плагином. Без этого последнее
 * движение человека терялось бы — и настройка, которая теряется, хуже, чем её
 * отсутствие.
 */
export function flushPlaces() {
  if (отложено) { clearTimeout(отложено); отложено = null }
  записатьСейчас()
}

/**
 * Виджет плагина, выросший из панели «в чат» (v1.480.0).
 *
 * Один на плагин: повторный ui.addPanel обновляет его, а не открывает второй.
 * Иначе плагин, рисующий панель заново на каждое событие (а так делают все),
 * за минуту завалил бы экран копиями.
 *
 * Карта лежит ЗДЕСЬ, а не рядом с диспетчером: за плагином убирает cleanup.ts,
 * а он зовётся из горячего кода. Потяни он api.ts — вся система плагинов
 * уехала бы в стартовую сборку всем и каждому (так и вышло, поймал смоук).
 */
const виджеты = new Map<string, number>()

export const widgetOf = (pluginId: string): number | undefined => виджеты.get(pluginId)
export const setWidgetOf = (pluginId: string, id: number) => { виджеты.set(pluginId, id) }
export function forgetWidget(pluginId: string) { виджеты.delete(pluginId) }
export function forgetAllWidgets() { виджеты.clear() }

/**
 * Где окно НА САМОМ ДЕЛЕ — измеренное окном приложения.
 *
 * Зачем отдельно от x/y модели. Пока человек не двигал окно, его место задаёт
 * не модель, а вёрстка: «по центру», «в углу». В модели там null, и плагин
 * получал бы null вместо координат — то есть ровно ту беду, ради которой всё
 * это и делается. Компонент меряет себя и кладёт настоящий прямоугольник сюда.
 */
const прямоугольники = new Map<number, { x: number; y: number; w: number; h: number }>()

export function setAppRect(id: number, r: { x: number; y: number; w: number; h: number }) {
  прямоугольники.set(id, r)
}

/**
 * Где стоит окно и какого оно размера (v1.485.0).
 *
 * Зачем. Плагин живёт в отдельном воркере: перетаскивание обрабатывает
 * приложение, а плагин об этом не знал ничего. Владелец описал это точно:
 * «плагин считает, что окна стоят на месте». Нарисовать что-то, связанное с
 * положением окон, было невозможно.
 *
 * Отдаём только СВОИ окна: чужие — не его дело.
 */
export function appGeometry(pluginId: string, id: number): (PluginApp & { screenW: number; screenH: number }) | null {
  const a = apps.get(id)
  if (!a || a.pluginId !== pluginId) return null
  const r = прямоугольники.get(id)
  return {
    ...a,
    // Измеренное главнее модели: оно и есть то, что человек видит на экране.
    x: r ? r.x : a.x,
    y: r ? r.y : a.y,
    w: r ? r.w : a.w,
    h: r ? r.h : a.h,
    screenW: экранШ(), screenH: экранВ(),
  }
}

const экранШ = () => (typeof document === 'undefined' ? 0 : document.documentElement.clientWidth)
const экранВ = () => (typeof document === 'undefined' ? 0 : document.documentElement.clientHeight)

/** Размер экрана — чтобы плагин мог посчитать, куда ставить окно. */
export const screenSize = () => ({ w: экранШ(), h: экранВ() })

export function appList(pluginId?: string): PluginApp[] {
  const all = [...apps.values()]
  return pluginId ? all.filter(a => a.pluginId === pluginId) : all
}

export function clearApps(pluginId: string) {
  for (const [id, a] of [...apps]) if (a.pluginId === pluginId) apps.delete(id)
  notify()
}

/** Аварийный режим: убрать все области всех плагинов. */
export function clearAllApps() {
  apps.clear()
  notify()
}
