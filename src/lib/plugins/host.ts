import { PluginSandbox, type FnRef } from './sandbox'
import { createDispatcher, taskHandlers, type HostContext } from './api'
import { clearPlugin, pluginsDisabled } from './registry'
import { loadPlugins, getPlugin, subscribePlugins } from './store'
import type { InstalledPlugin } from './types'
// v1.465.0: за плагином надо убирать не только то, что он добавил в интерфейс.
import { cleanupPlugin } from './cleanup'
import { setTaskRunner } from './background'
import { runBeforeUpload, hasInterceptors } from './middleware'
import { setGamepadEmit } from './gamepads'
// v1.473.0: адрес своего файла плагина отдаётся наружу отсюда — чтобы у панели
// был ОДИН вход в систему плагинов, а не второй ленивый (см. bridge.ts).
export { assetUrl as assetUrlFor } from './assets'
import { CtxHolder } from './hostCtx'

// v1.286.0: связывает всё вместе — поднимает песочницы включённых плагинов, роутит
// вызовы в api.ts, раздаёт события и гасит сломавшихся. Один плагин не должен
// ронять ни приложение, ни соседние плагины: любая его ошибка максимум выключает
// его самого и записывается в pluginErrors, чтобы её было видно в настройках.

interface Running {
  sandbox: PluginSandbox
  /** События, на которые плагин реально подписался, — чтобы не будить остальных. */
  subs: Set<string>
}

const running = new Map<string, Running>()
const errors = new Map<string, string>()

const listeners = new Set<() => void>()
export function subscribePluginState(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

export function pluginError(id: string): string | null { return errors.get(id) ?? null }
export function isRunning(id: string): boolean { return running.has(id) }

/**
 * Журнал плагина (v1.397.0).
 *
 * ponoi.log уходил только в консоль браузера. В приложении на телефоне и в
 * десктопной сборке её нет вовсе, а значит, и отладки не было: плагин молчит, а
 * почему — неизвестно. Держим последние строки у себя и показываем в настройках
 * плагина, рядом с ним самим.
 *
 * Кольцо на 200 строк: журнал не должен расти вечно, а тому, кто отлаживает,
 * нужен хвост, а не вся история.
 */
export type LogLevel = 'log' | 'warn' | 'error'
export interface LogLine { at: number; level: LogLevel; text: string }
const LOG_MAX = 200
const logs = new Map<string, LogLine[]>()

export function pluginLog(id: string, level: LogLevel, text: string) {
  const arr = logs.get(id) ?? []
  arr.push({ at: Date.now(), level, text })
  if (arr.length > LOG_MAX) arr.splice(0, arr.length - LOG_MAX)
  logs.set(id, arr)
  notify()
}
export function pluginLogs(id: string): LogLine[] { return logs.get(id) ?? [] }
export function clearPluginLog(id: string) { logs.delete(id); notify() }

// Контекст подставляет приложение: он зависит от того, какой канал открыт сейчас,
// поэтому живёт изменяемой ссылкой, а не копируется в каждый плагин при старте.
const ПУСТО: HostContext = {
  sendMessage: async () => { throw new Error('Нет открытого канала') },
  toast: () => {},
}
// v1.469.0: правило владения вынесено в hostCtx.ts. Не ради красоты: с этой
// версии система плагинов грузится не сразу, и до её загрузки владение помнит
// прослойка (bridge.ts). Две копии правила разошлись бы — и вернулась бы
// поломка «плагин пишет не в тот чат», против которой правило и написано.
const держатель = new CtxHolder<HostContext>(ПУСТО)
const ctx = { get current() { return держатель.current() } }

// v1.293.0: у контекста есть ВЛАДЕЛЕЦ, и это важно — см. hostCtx.ts, там
// написано, против какой поломки это правило.
export function claimHostContext(owner: string, next: HostContext, force: boolean) {
  держатель.claim(owner, next, force)
}

export function releaseHostContext(owner: string) {
  держатель.release(owner)
}

export async function startPlugin(plugin: InstalledPlugin): Promise<void> {
  await stopPlugin(plugin.manifest.id)
  errors.delete(plugin.manifest.id)

  const subs = new Set<string>()
  // Диспетчер создаётся один раз, а не на каждый вызов: внутри него живут проверки
  // разрешений, и пересобирать их на каждый чих незачем.
  const dispatch = createDispatcher(plugin, {
    sendMessage: text => ctx.current.sendMessage(text),
    toast: text => ctx.current.toast(text),
    // v1.445.0: поток отдаёт куски ответа обработчику плагина. Ищем песочницу
    // по имени, а не держим ссылку: диспетчер создаётся раньше песочницы, и к
    // моменту первого потока плагин уже запущен.
    invoke: (ref, args) => invokePlugin(plugin.manifest.id, ref, args),
    // v1.465.0: письмо соседнему плагину.
    ipcSend: (from, to, event, data) => deliverIpc(from, to, event, data),
    // v1.472.0: вызов метода службы выполняется в ЧУЖОМ плагине — том, кто её
    // предлагает. Поэтому отдельно от invoke, который зовёт обработчик своего.
    invokeIn: (pid, ref, a2) => invokePlugin(pid, ref, a2),
  }, ev => subs.add(ev))
  const sandbox = new PluginSandbox({
    onCall: dispatch,
    // Ошибка ВО ВРЕМЯ работы (висячий промис, исключение в обработчике события) —
    // не приговор: записываем, показываем в настройках, но плагин продолжает жить.
    // Убиваем только за провал загрузки — там плагин заведомо не в рабочем состоянии.
    onError: msg => {
      errors.set(plugin.manifest.id, msg)
      // Ошибка попадает и в журнал: там она встаёт по времени между строками
      // самого плагина, и видно, на чём именно он споткнулся.
      pluginLog(plugin.manifest.id, 'error', msg)
      notify()
    },
  })
  running.set(plugin.manifest.id, { sandbox, subs })

  try {
    await sandbox.start(plugin.code)
    notify()
  } catch (err: any) {
    fail(plugin.manifest.id, err?.message ?? String(err))
    throw err
  }
}

function fail(id: string, message: string) {
  errors.set(id, message)
  pluginLog(id, 'error', message)
  const r = running.get(id)
  if (r) { r.sandbox.kill(); running.delete(id) }
  clearPlugin(id)
  cleanupPlugin(id)
  notify()
}

export async function stopPlugin(id: string): Promise<void> {
  const r = running.get(id)
  if (r) { r.sandbox.kill(); running.delete(id) }
  clearPlugin(id)
  cleanupPlugin(id)
  notify()
}

// Фоновая задача пришла по сроку — зовём обработчик плагина. Упавший обработчик
// не убивает ни задачу, ни плагин: причина попадает в его журнал, и видно, что
// именно ломается раз в минуту.
// v1.473.0: события геймпада. Опрос живёт в gamepads.ts и ничего не знает ни о
// плагинах, ни о подписках — он только замечает изменения. Кому их отдать,
// знает вот это место, и оно же единственное: emitPluginEvent сам разошлёт
// событие ровно тем, кто на него подписался.
setGamepadEmit(ev => emitPluginEvent('gamepad', ev))

setTaskRunner((pluginId, taskId) => {
  const h = taskHandlers.get(taskId)
  if (!h || h.pluginId !== pluginId) return
  invokePlugin(pluginId, h.fn, []).catch(() => { /* уже записано в журнал */ })
})

/**
 * Доставка письма между плагинами (v1.465.0).
 *
 * Два условия, и оба обязательны:
 *   • адресат запущен — иначе доставлять некуда;
 *   • адресат ПОДПИСАН на 'ipc' — а подписаться на него без разрешения ipc
 *     нельзя (таблица событий в types.ts). Это и есть согласие получателя:
 *     плагин, ни о чём не просивший, чужих данных не получит.
 *
 * Отправитель подставляется здесь и только здесь: в письме от плагина поля from
 * нет вовсе, поэтому подделать его нельзя ничем.
 */
function deliverIpc(from: string, to: string, event: string, data: unknown): boolean {
  const r = running.get(to)
  if (!r || !r.subs.has('ipc')) return false
  r.sandbox.emit('ipc', { from, event, data })
  return true
}

/** Поднять все включённые плагины. Вызывается один раз при старте приложения. */
export async function startEnabledPlugins(): Promise<void> {
  // v1.345.0: аварийный режим. Если плагин испортил приложение настолько, что до
  // настроек не добраться, человек включает его адресом ?safe=1 или сочетанием
  // клавиш — и ни один плагин не запускается вовсе.
  if (pluginsDisabled()) return
  for (const p of loadPlugins()) {
    if (!p.enabled) continue
    // Последовательно, а не Promise.all: у каждого свой таймаут на загрузку, и
    // десяток одновременно стартующих воркеров на слабой машине только мешал бы
    // друг другу. Плагинов единицы — разница неощутима.
    try { await startPlugin(p) } catch { /* причина уже записана в errors, идём дальше */ }
  }
}

/**
 * Прогнать файл через перехватчики вложений (v1.475.0).
 *
 * Здесь, а не в прослойке: сюда стекаются песочницы, и звать обработчик плагина
 * умеет только это место. Прослойка спрашивает нас, только если система вообще
 * загружена, — у человека без плагинов этот код не выполняется никогда.
 */
export async function runUploadHooksHere(file: File): Promise<{ file: File; cancel: boolean; by: string | null }> {
  if (!hasInterceptors('upload')) return { file, cancel: false, by: null }
  const bytes = await file.arrayBuffer()
  const out = await runBeforeUpload(
    { name: file.name, type: file.type, size: bytes.byteLength, bytes },
    (pid, fn, args) => invokePlugin(pid, fn, args),
  )
  if (out.cancel) return { file, cancel: true, by: out.by }
  if (out.bytes === bytes && out.name === file.name && out.type === file.type) {
    return { file, cancel: false, by: null }
  }
  return {
    file: new File([out.bytes], out.name, { type: out.type || file.type }),
    cancel: false, by: null,
  }
}

/** Разослать событие тем плагинам, которые на него подписаны. */
export function emitPluginEvent(name: string, data: unknown) {
  for (const [, r] of running) {
    if (r.subs.has(name)) r.sandbox.emit(name, data)
  }
}

/**
 * Событие конкретному плагину, минуя подписку. Нужно для его собственных настроек:
 * человек трогает переключатель на странице ЭТОГО плагина — адресат очевиден, и
 * требовать от плагина отдельной подписки на такое было бы лишней церемонией.
 */
export function emitToPlugin(pluginId: string, name: string, data: unknown) {
  running.get(pluginId)?.sandbox.emit(name, data)
}

/** Вызвать обработчик плагина (клик по его кнопке, его слэш-команда). */
export async function invokePlugin(pluginId: string, ref: FnRef, args: unknown[] = []): Promise<unknown> {
  const r = running.get(pluginId)
  if (!r) throw new Error('Плагин не запущен')
  try {
    return await r.sandbox.invoke(ref, args)
  } catch (err: any) {
    // Упавший обработчик — не повод убивать плагин целиком (в отличие от ошибки
    // при загрузке): показываем причину и живём дальше.
    ctx.current.toast(`Плагин «${getPlugin(pluginId)?.manifest.name ?? pluginId}»: ${err?.message ?? err}`)
    throw err
  }
}

// Список плагинов мог измениться в другой вкладке — держим запущенное в согласии
// с сохранённым, иначе удалённый там плагин остался бы работать здесь.
subscribePlugins(() => {
  for (const id of [...running.keys()]) {
    const p = getPlugin(id)
    if (!p || !p.enabled) void stopPlugin(id)
  }
})
