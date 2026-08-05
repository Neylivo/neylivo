// v1.465.0: работа по расписанию, когда панель плагина закрыта.
//
// СНАЧАЛА ЧЕСТНО О ТОМ, ЧЕГО ЗДЕСЬ НЕТ.
//
// Плагин и раньше не переставал работать со свёрнутой панелью: он живёт в
// воркере, а воркер не привязан ни к какой панели, и обычный setInterval внутри
// него тикал всегда. Поэтому «фоновый режим» — это НЕ «теперь плагин может
// работать в фоне»: он мог. Если бы этот файл только заводил таймер, он был бы
// ровно той кнопкой-обманкой, которых в этом проекте уже хватило.
//
// ЧТО ЭТО ДАЁТ НА САМОМ ДЕЛЕ — четыре вещи, каждой из которых раньше не было:
//
//   1. ЧЕЛОВЕК ВИДИТ. Таймер внутри воркера не видно ниоткуда: плагин ходит в
//      сеть раз в минуту, а узнать об этом нельзя. Задача, заведённая здесь,
//      показана на карточке плагина, с её сроком и с кнопкой «остановить».
//   2. ЧЕЛОВЕК РАЗРЕШИЛ. Разрешение background видно при установке и названо
//      прямо: «работать по расписанию, даже когда его окно закрыто».
//   3. ОШИБКИ НЕ ПРОПАДАЮТ. Исключение внутри setInterval в воркере тонуло
//      молча. Здесь вызов идёт через invokePlugin — упавший обработчик попадает
//      в журнал плагина, и видно, на чём он спотыкается.
//   4. ДОГОН ПОСЛЕ ПРОСТОЯ. Браузер придерживает таймеры у спрятанной вкладки
//      (обычно не чаще раза в минуту). Задача с расписанием в пять секунд
//      после возвращения на вкладку срабатывает сразу, а не ждёт следующего
//      круга, и при этом НЕ отрабатывает все пропущенные разы подряд — иначе
//      плагин, проспавший час, выплюнул бы семьсот вызовов залпом.
//
// Проверки: src/lib/plugins/__test.ts.

/** Чаще этого нельзя: секундный круг — уже достаточно для «моментально». */
export const MIN_EVERY_MS = 1000
/** Реже — незачем: сутки в миллисекундах. */
/** Сколько задач у одного плагина. */

export class BackgroundError extends Error {}

export interface Task {
  id: number
  pluginId: string
  everyMs: number
  /** Когда должна была сработать в следующий раз (мс). */
  dueAt: number
  /** Сколько раз отработала — видно человеку, помогает понять, живая ли она. */
  runs: number
  /** Название для экрана: плагин пишет своё, иначе «Задача». */
  label: string
}

const tasks = new Map<number, Task>()
let seq = 0
let timer: ReturnType<typeof setInterval> | null = null

const listeners = new Set<() => void>()
export function subscribeTasks(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

/** Кто зовёт обработчик плагина. Подставляет host.ts — сюда не тянется песочница. */
type Runner = (pluginId: string, taskId: number) => void
let runner: Runner = () => {}
export function setTaskRunner(fn: Runner) { runner = fn }

/**
 * Что должно сработать к этому моменту, и какой у них следующий срок.
 *
 * Отдельной чистой функцией: здесь единственное непростое место всего файла —
 * догон. Проверить его «на глаз» нельзя, а проверкой — можно.
 *
 * Правило догона: срок сдвигается ОТ СЕЙЧАС, а не от прежнего срока. Иначе после
 * часа в спящей вкладке задача с пятисекундным кругом обнаружила бы семьсот
 * пропущенных сроков и отработала бы их подряд.
 */
export function dueNow(all: Task[], now: number): { run: Task[]; next: Map<number, number> } {
  const run: Task[] = []
  const next = new Map<number, number>()
  for (const t of all) {
    if (t.dueAt > now) continue
    run.push(t)
    next.set(t.id, now + t.everyMs)
  }
  return { run, next }
}

/** Круг опроса. Мелкий нарочно: сроки у задач разные, а таймер один. */
const TICK_MS = 500

function ensureTimer() {
  if (timer || tasks.size === 0) return
  timer = setInterval(tick, TICK_MS)
}
function stopTimerIfIdle() {
  if (timer && tasks.size === 0) { clearInterval(timer); timer = null }
}

function tick() {
  const now = Date.now()
  const { run, next } = dueNow([...tasks.values()], now)
  for (const t of run) {
    const cur = tasks.get(t.id)
    if (!cur) continue
    cur.dueAt = next.get(t.id) ?? now + cur.everyMs
    cur.runs++
    runner(cur.pluginId, cur.id)
  }
  if (run.length) notify()
}

export function addTask(pluginId: string, everyMs: number, label: string): Task {
  const ms = Math.round(Number(everyMs))
  if (!Number.isFinite(ms) || ms < MIN_EVERY_MS) {
    throw new BackgroundError(`Слишком часто: не чаще раза в ${MIN_EVERY_MS / 1000} с.`)
  }
  let mine = 0
  for (const [, t] of tasks) if (t.pluginId === pluginId) mine++

  const t: Task = {
    id: ++seq, pluginId, everyMs: ms, dueAt: Date.now() + ms, runs: 0,
    label: String(label || '').trim().slice(0, 60) || 'Задача',
  }
  tasks.set(t.id, t)
  ensureTimer()
  notify()
  return t
}

export function removeTask(pluginId: string, id: number): boolean {
  const t = tasks.get(id)
  // Чужую задачу остановить нельзя: иначе один плагин выключал бы другому всю
  // его работу перебором номеров.
  if (!t || t.pluginId !== pluginId) return false
  tasks.delete(id)
  stopTimerIfIdle()
  notify()
  return true
}

/** Человек нажал «остановить» на карточке плагина. Здесь владелец не проверяется:
 *  это действие самого человека, а не плагина. */
export function stopTaskByUser(id: number): boolean {
  const ok = tasks.delete(id)
  stopTimerIfIdle()
  if (ok) notify()
  return ok
}

export function clearTasks(pluginId: string) {
  for (const [id, t] of [...tasks]) if (t.pluginId === pluginId) tasks.delete(id)
  stopTimerIfIdle()
  notify()
}

/** Аварийный режим: снять все задачи всех плагинов. */
export function clearAllTasks() {
  tasks.clear()
  stopTimerIfIdle()
  notify()
}

export function taskList(pluginId?: string): Task[] {
  const all = [...tasks.values()]
  return pluginId ? all.filter(t => t.pluginId === pluginId) : all
}
