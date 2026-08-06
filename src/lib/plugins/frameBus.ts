// v1.490.0: события плагина доходят и до его окна-страницы.
//
// Зачем отдельным крошечным файлом. Подписку держит компонент окна
// (PluginApps.tsx), а рассылает события прослойка (bridge.ts) — оба живут в
// горячем коде, который грузится у КАЖДОГО человека, даже без единого плагина.
// Положи это в htmlFrame.ts — и в стартовую сборку уехал бы весь текст моста
// вместе с ним; положи в host.ts — уехала бы вся система плагинов. Так уже
// было в v1.469.0, и поймал это смоук.
//
// Здесь нет ничего, кроме карты подписок: ни одного тяжёлого ввоза.

type Слушатель = (name: string, data: unknown) => void

const рамки = new Map<string, Set<Слушатель>>()

/** Окно-страница плагина хочет получать его события. Возвращает «отписаться». */
export function subscribeFrameEvents(pluginId: string, fn: Слушатель): () => void {
  const s = рамки.get(pluginId) ?? new Set<Слушатель>()
  s.add(fn)
  рамки.set(pluginId, s)
  return () => {
    const т = рамки.get(pluginId)
    if (!т) return
    т.delete(fn)
    if (!т.size) рамки.delete(pluginId)
  }
}

/**
 * Разослать событие по окнам-страницам этого плагина.
 *
 * Ошибку одной рамки не даём уронить остальных: страницу пишет автор плагина,
 * и она вправе быть сломанной — это не повод не доставить событие соседней.
 */
export function emitToFrames(pluginId: string, name: string, data: unknown): void {
  const s = рамки.get(pluginId)
  if (!s) return
  for (const fn of s) { try { fn(name, data) } catch { /* сломанная рамка — её беда */ } }
}

/** Сколько окон-страниц слушает — для проверок. */
export const frameListenerCount = (pluginId?: string): number =>
  pluginId ? (рамки.get(pluginId)?.size ?? 0) : [...рамки.values()].reduce((n, s) => n + s.size, 0)
