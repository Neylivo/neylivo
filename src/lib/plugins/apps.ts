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
// выключении плагина, предел на число. Сделай их четырьмя системами — и через
// пару версий они разойдутся: в одной появится закрытие по Esc, в другой нет;
// одна будет убираться за плагином, другая останется висеть. Здесь место — это
// поле `mode`, и ничего больше.
//
// ЧТО НЕ ИЗМЕНИЛОСЬ. Плагин по-прежнему не рисует ничего сам: он описывает
// СТРОКИ (те же, что в панели, включая холст), а рисует их приложение. Даже во
// весь экран у окна остаётся наша шапка с именем плагина и кнопкой закрытия,
// которую плагин убрать не может, — иначе «полный экран» стал бы способом
// подделать приложение целиком и не дать себя закрыть.
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

import type { SettingsRow } from './registry'

/**
 * Где живёт область.
 *
 * Список закрытый — по той же причине, что у панелей и пунктов меню: «где
 * угодно» означало бы, что плагин распоряжается экраном.
 */
export type AppMode = 'window' | 'pip' | 'tab' | 'fullscreen'

export const APP_MODES: Record<AppMode, string> = {
  window: 'Плавающее окно, его можно двигать',
  pip: 'Маленькое окошко в углу поверх всего',
  tab: 'Отдельная вкладка в рабочей области',
  fullscreen: 'Во весь экран поверх приложения',
}

/** Сколько областей может открыть один плагин. Больше — это уже не приложение. */
export const MAX_APPS_PER_PLUGIN = 3
/** Сколько всего открытых областей. Иначе несколько плагинов застроят экран. */
export const MAX_APPS_TOTAL = 6

export const MIN_W = 240, MAX_W = 1600
export const MIN_H = 160, MAX_H = 1200

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
}): PluginApp {
  let mine = 0
  for (const [, x] of apps) if (x.pluginId === pluginId) mine++
  if (mine >= MAX_APPS_PER_PLUGIN) {
    throw new AppError(`Открытых окон у одного плагина не больше ${MAX_APPS_PER_PLUGIN} — закрой ненужные.`)
  }
  if (apps.size >= MAX_APPS_TOTAL) {
    throw new AppError(`На экране уже ${MAX_APPS_TOTAL} окон от плагинов.`)
  }
  const app: PluginApp = {
    id: ++seq, pluginId,
    title: a.title, mode: a.mode, icon: a.icon, rows: a.rows,
    w: clampSize(a.w, MIN_W, MAX_W, 480),
    h: clampSize(a.h, MIN_H, MAX_H, 360),
    x: null, y: null,
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
}): boolean {
  const a = apps.get(id)
  if (!a || a.pluginId !== pluginId) return false
  if (patch.title !== undefined) a.title = patch.title
  if (patch.rows !== undefined) a.rows = patch.rows
  if (patch.mode !== undefined) a.mode = patch.mode
  if (patch.w !== undefined) a.w = clampSize(patch.w, MIN_W, MAX_W, a.w)
  if (patch.h !== undefined) a.h = clampSize(patch.h, MIN_H, MAX_H, a.h)
  notify()
  return true
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
  notify()
}

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
