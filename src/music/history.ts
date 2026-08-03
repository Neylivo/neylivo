// v1.440.0: история прослушанного с ходом вперёд.
//
// Что было. История хранилась стопкой, и «назад» её РАЗБИРАЛО: трек снимался
// насовсем. Поэтому «вперёд» после «назад» возвращаться было некуда — очередь
// заново придумывала следующий, и человек уже не мог вернуться к тому, что
// только что слушал. В любом проигрывателе (и в браузере) это работает иначе:
// назад и вперёд ходят по ОДНОМУ И ТОМУ ЖЕ списку.
//
// Теперь история — список с указателем, как история страниц: шаг назад двигает
// указатель, шаг вперёд возвращает по тому же пути, а новый трек, включённый
// не из истории, обрезает всё, что было впереди, и дописывается в конец.

export interface Hist {
  /** Что играло, от старого к новому. */
  list: string[]
  /** Где мы сейчас. -1 — истории ещё нет. */
  at: number
}

export const emptyHist: Hist = { list: [], at: -1 }

/** Сколько шагов помним. Дальше человек всё равно не возвращается. */
export const HIST_MAX = 60

/**
 * Записать включённый трек.
 *
 * `fromHistory` — трек включён нашими же кнопками «назад»/«вперёд»: тогда
 * ничего не пишем, только двигаем указатель (это делает back/forward).
 */
export function pushPlayed(h: Hist, id: string): Hist {
  if (!id) return h
  if (h.at >= 0 && h.list[h.at] === id) return h          // тот же трек подряд
  // Включили что-то новое, стоя в середине истории: всё, что было впереди,
  // больше не наше будущее — как в браузере при переходе по новой ссылке.
  const kept = h.list.slice(0, h.at + 1)
  const list = [...kept, id]
  const over = list.length - HIST_MAX
  return over > 0 ? { list: list.slice(over), at: list.length - over - 1 } : { list, at: list.length - 1 }
}

/**
 * Шаг назад. `has` — жив ли ещё этот трек в складе (его могли удалить).
 * Вернёт null, если возвращаться некуда.
 */
export function back(h: Hist, has: (id: string) => boolean): { hist: Hist; target: string } | null {
  for (let i = h.at - 1; i >= 0; i--) {
    if (has(h.list[i])) return { hist: { ...h, at: i }, target: h.list[i] }
  }
  return null
}

/** Шаг вперёд по той же истории. null — впереди ничего, нужен новый подбор. */
export function forward(h: Hist, has: (id: string) => boolean): { hist: Hist; target: string } | null {
  for (let i = h.at + 1; i < h.list.length; i++) {
    if (has(h.list[i])) return { hist: { ...h, at: i }, target: h.list[i] }
  }
  return null
}

/** Есть ли куда идти — для показа кнопок. */
export const canBack = (h: Hist, has: (id: string) => boolean): boolean => back(h, has) !== null
export const canForward = (h: Hist, has: (id: string) => boolean): boolean => forward(h, has) !== null

/** Что играло только что, от свежего к старому — для запрета повторов в волне. */
export function recentIds(h: Hist, limit = 40): string[] {
  const out: string[] = []
  for (let i = h.at; i >= 0 && out.length < limit; i--) {
    if (!out.includes(h.list[i])) out.push(h.list[i])
  }
  return out
}
