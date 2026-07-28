// v1.377.0: очередь под человека, а не случайный набор.
//
// Что было. «Дальше» шло просто по порядку склада — то есть по времени, когда
// трек кто-то добавил. К самому человеку это не имело отношения никакого: он
// слушает пять песен, а очередь предлагает то, что позавчера выложил сосед.
//
// Что стало. Впереди — то, что он сам слушает чаще; при равенстве — то, что
// слушал недавно. Но не только: если оставить один этот порядок, очередь
// схлопнется в бесконечное повторение любимой пятёрки, и ничего нового человек
// не услышит никогда. Поэтому в конец подмешивается то, что он не слушал вовсе.
//
// Порядок склада тоже не выбрасываем: при равных числах он даёт устойчивость —
// одинаковый список у всех не «прыгает» от пересчёта к пересчёту.

export interface QueueTrack { id: string }

export interface PersonalInput<T extends QueueTrack> {
  /** Весь склад в его обычном порядке. */
  tracks: T[]
  /** Номер того, что играет сейчас. */
  idx: number
  /** Сколько раз я слушал каждый трек. */
  plays: Record<string, number>
  /** Когда слушал в последний раз (мс). Нужен только для разрешения ничьих. */
  lastAt?: Record<string, number>
  /** Сколько незнакомого подмешать в конец. */
  freshCount?: number
}

/**
 * Что играть дальше — по убыванию «моего» интереса, с добавкой незнакомого.
 * Текущий трек в список не попадает: он уже играет.
 */
export function personalOrder<T extends QueueTrack>(i: PersonalInput<T>): T[] {
  const { tracks, idx, plays } = i
  const lastAt = i.lastAt ?? {}
  const fresh = i.freshCount ?? 3
  const rest = tracks.filter((_, n) => n !== idx)
  if (rest.length === 0) return []

  const known = rest.filter(t => (plays[t.id] ?? 0) > 0)
  const unknown = rest.filter(t => (plays[t.id] ?? 0) === 0)

  // Порядок склада запоминаем: он разрешает ничьи и делает выдачу устойчивой.
  const pos = new Map(tracks.map((t, n) => [t.id, n]))
  known.sort((a, b) => {
    const d = (plays[b.id] ?? 0) - (plays[a.id] ?? 0)
    if (d !== 0) return d
    const l = (lastAt[b.id] ?? 0) - (lastAt[a.id] ?? 0)
    if (l !== 0) return l
    return (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)
  })

  // Незнакомое берём от начала склада — там лежит добавленное раньше, то есть
  // то, до чего человек так и не дошёл.
  const head = unknown.slice(0, fresh)
  const tail = unknown.slice(fresh)
  return [...known, ...head, ...tail]
}
