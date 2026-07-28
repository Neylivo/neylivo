import type { InstalledPlugin } from './types'

// v1.286.0: где живут установленные плагины. localStorage, а не БД — плагин ставится
// на КОНКРЕТНОЕ устройство: на телефоне и на десктопе набор может (и должен) быть
// разным, а тащить чужой исполняемый код между устройствами автоматически — ровно то,
// чего делать не стоит. Заодно не нужна ни таблица, ни миграция.

const KEY = 'ponoi.plugins'
/** Потолок на всё хранилище плагинов: в localStorage около 5 МБ на origin, и выжрать
 *  его целиком нельзя — там же лежат настройки, черновики и кэши приложения. */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024

const listeners = new Set<() => void>()
export function subscribePlugins(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

let cache: InstalledPlugin[] | null = null

export function loadPlugins(): InstalledPlugin[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    cache = Array.isArray(arr) ? arr.filter(p => p && p.manifest && typeof p.code === 'string') : []
  } catch {
    // Битый JSON не должен обезоруживать всё приложение — начинаем с пустого списка.
    cache = []
  }
  return cache!
}

/**
 * @param silent не будить подписчиков. Нужно для записей в storage самого плагина:
 *   от них состав и включённость плагинов не меняются, а host.ts по этому сигналу
 *   сверяет запущенное с сохранённым — гонять сверку на каждый ponoi.storage.set
 *   бессмысленно (и однажды уже приводило к остановке плагина посреди его же вызова).
 */
function persist(list: InstalledPlugin[], silent = false) {
  const json = JSON.stringify(list)
  if (json.length > MAX_TOTAL_BYTES) {
    throw new Error('Не хватает места: суммарный размер плагинов больше 2 МБ. Удали ненужные.')
  }
  try {
    localStorage.setItem(KEY, json)
  } catch {
    throw new Error('Не удалось сохранить — в хранилище браузера кончилось место.')
  }
  cache = list
  if (!silent) notify()
}

export function getPlugin(id: string): InstalledPlugin | undefined {
  return loadPlugins().find(p => p.manifest.id === id)
}

/** Ставит новый плагин или обновляет существующий с тем же id, сохраняя его данные. */
export function upsertPlugin(p: InstalledPlugin) {
  const list = loadPlugins()
  const i = list.findIndex(x => x.manifest.id === p.manifest.id)
  if (i < 0) persist([...list, p])
  else persist(list.map((x, n) => (n === i ? { ...p, storage: x.storage } : x)))
}

export function removePlugin(id: string) {
  persist(loadPlugins().filter(p => p.manifest.id !== id))
}

export function setEnabled(id: string, enabled: boolean) {
  persist(loadPlugins().map(p => (p.manifest.id === id ? { ...p, enabled } : p)))
}

export function readStorage(id: string, key: string): unknown {
  return getPlugin(id)?.storage?.[key]
}

export function writeStorage(id: string, key: string, value: unknown) {
  persist(loadPlugins().map(p => (
    p.manifest.id === id ? { ...p, storage: { ...p.storage, [key]: value } } : p
  )), true)
}

export function deleteStorage(id: string, key: string) {
  persist(loadPlugins().map(p => {
    if (p.manifest.id !== id) return p
    const next = { ...p.storage }
    delete next[key]
    return { ...p, storage: next }
  }), true)
}

/**
 * Ключи, которые плагин у себя завёл (v1.360.0).
 *
 * Без этого своё же хранилище нельзя было ни обойти, ни почистить: get брал по
 * известному ключу, а узнать, какие ключи есть, было неоткуда — плагину
 * приходилось вести отдельный список ключей вручную, и тот рассыхался.
 */
export function listStorage(id: string): string[] {
  return Object.keys(getPlugin(id)?.storage ?? {})
}
