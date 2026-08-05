// v1.469.0: тонкая прослойка между приложением и системой плагинов.
//
// ЗАЧЕМ. Система плагинов весит 87 КБ и до этой версии ехала в стартовую сборку
// целиком — потому что её звали из чата, из шапки, из списка сообщений, то есть
// из самого горячего кода. Стартовый вес подошёл к потолку (515 КБ из 520), и
// следующая крупная возможность просто не влезла бы.
//
// Но её и не нужно грузить: у человека БЕЗ ПЛАГИНОВ она не делает ничего. А
// таких большинство — плагины ставят единицы.
//
// Что здесь. Те же имена, что раньше приходили из host.ts, но настоящий host
// подгружается только тогда, когда плагины действительно есть. Приложение
// продолжает звать их как звало: ни один вызывающий не должен знать, загружено
// что-то или нет.
//
// ЧТО НЕЛЬЗЯ БЫЛО ПОТЕРЯТЬ. Пока хост не загружен, кто-то обязан помнить, в
// какое поле ввода плагин будет писать (см. hostCtx.ts): иначе плагин,
// поставленный при открытом чате, отправлял бы сообщение «в никуда» до первого
// клика по полю. Правило владения здесь ТО ЖЕ САМОЕ, что в host.ts, — общий
// класс, а не вторая копия: две копии разошлись бы, и вернулась бы поломка
// «плагин пишет не в тот чат».
//
// Проверки: src/lib/plugins/__test.ts.

import type { FnRef } from './sandbox'
import type { HostContext } from './api'
import { CtxHolder } from './hostCtx'
import { loadPlugins } from './store'
import { pluginsDisabled } from './registry'

type Host = typeof import('./host')

let host: Host | null = null
let loading: Promise<Host> | null = null

/** Контекст, пока настоящего хоста нет. Отдаётся ему при загрузке. */
const пока = new CtxHolder<{ owner: string; ctx: HostContext } | null>(null)

/** Есть ли смысл вообще что-то грузить. */
function естьПлагины(): boolean {
  if (pluginsDisabled()) return false
  try { return loadPlugins().some(p => p.enabled) } catch { return false }
}

async function поднять(): Promise<Host> {
  if (host) return host
  if (!loading) {
    loading = import('./host').then(m => {
      host = m
      // Передаём накопленное владение: человек мог открыть чат до того, как
      // плагины понадобились. Force — потому что владелец уже выбран здесь по
      // тому же правилу, и переигрывать его хосту незачем.
      const c = пока.current()
      if (c) m.claimHostContext(c.owner, c.ctx, true)
      return m
    })
  }
  return loading
}

/** Загружен ли хост — для проверок и для решений «а надо ли будить». */
export const hostLoaded = () => host !== null

// ── То, что зовут из горячего кода ──────────────────────────────────────────

/**
 * Событие плагинам. Если хоста нет, значит не запущено ни одного плагина —
 * и событие некому получать. Молча пропускаем и НИЧЕГО НЕ ГРУЖУСЬ: иначе
 * первое же входящее сообщение утащило бы за собой всю систему плагинов, и вся
 * затея потеряла бы смысл.
 */
export function emitPluginEvent(name: string, data: unknown): void {
  host?.emitPluginEvent(name, data)
}

export function emitToPlugin(pluginId: string, name: string, data: unknown): void {
  host?.emitToPlugin(pluginId, name, data)
}

/**
 * Позвать обработчик плагина. Сюда попадают только по нажатию на то, что плагин
 * сам добавил, — а значит, он уже запущен и хост уже загружен. Но если нет,
 * честно поднимаем: отказ был бы враньём.
 */
export async function invokePlugin(pluginId: string, ref: FnRef, args: unknown[] = []): Promise<unknown> {
  const h = host ?? await поднять()
  return h.invokePlugin(pluginId, ref, args)
}

export function claimHostContext(owner: string, next: HostContext, force: boolean): void {
  if (host) { host.claimHostContext(owner, next, force); return }
  // Правило НЕ переписываем — отдаём его тому же классу, что и у хоста. Копия
  // правила здесь однажды разошлась бы с оригиналом, и плагин снова начал бы
  // писать не в тот чат; ровно эту поломку правило и закрывает.
  пока.claim(owner, { owner, ctx: next }, force)
}

export function releaseHostContext(owner: string): void {
  if (host) { host.releaseHostContext(owner); return }
  пока.release(owner)
}

/**
 * Поднять включённые плагины при старте приложения.
 *
 * Здесь и решается всё: если включённых плагинов нет, система плагинов не
 * грузится вовсе — ни байта. Список плагинов лежит в localStorage и читается
 * без неё.
 */
export async function startEnabledPlugins(): Promise<void> {
  if (!естьПлагины()) return
  const h = await поднять()
  await h.startEnabledPlugins()
}

/**
 * Плагин поставили или включили прямо сейчас — экран плагинов зовёт это, чтобы
 * прослойка узнала о хосте и передала ему накопленное владение контекстом.
 * Без этого только что поставленный плагин не знал бы, в какой чат писать, до
 * первого клика по полю ввода.
 */
export async function ensureHost(): Promise<Host> { return поднять() }
