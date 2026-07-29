// v1.377.0: очередь под человека, а не случайный набор.
//
// Что было. «Дальше» шло просто по порядку склада — то есть по времени, когда
// трек кто-то добавил. К самому человеку это не имело отношения никакого: он
// слушает пять песен, а очередь предлагает то, что позавчера выложил сосед.
//
// v1.399.0: очередь стала рекомендацией, а не только счётчиком прослушиваний.
//
// Считать «сколько раз слушал» — это про человека вообще, а не про то, что
// играет сейчас. После спокойной песни такой список с одинаковой охотой
// предложит и её продолжение, и что-нибудь совершенно постороннее, просто
// потому, что оно чаще игралось. Поэтому теперь у подбора несколько сигналов, и
// главный из них — похоже ли предлагаемое на то, что человек слушает прямо
// сейчас:
//
//   • тот же исполнитель — самый сильный сигнал: чаще всего дальше хотят именно
//     его же;
//   • похожее название — общие значимые слова: части одной вещи, ремиксы, живые
//     версии; слабее автора, потому что совпадение бывает случайным;
//   • сколько раз слушал сам — прежний сигнал, он никуда не делся;
//   • сколько раз слушают все — помогает, когда про человека ещё ничего не
//     известно (новый аккаунт, пустая история);
//   • только что игравшее — наоборот, отодвигается: крутить по кругу одно и то
//     же очередь не должна;
//   • незнакомое — подмешивается намеренно. Без этого очередь схлопывается в
//     бесконечное повторение любимой пятёрки, и нового человек не услышит
//     никогда.
//
// Числа подобраны так, чтобы ни один сигнал не был решающим в одиночку: один
// общий исполнитель не перевешивает сотню прослушиваний, а сотня прослушиваний
// не перекрывает совсем свежий трек того же автора. Порядок склада остаётся
// последним разрешителем ничьих — от него выдача устойчива и не «прыгает» при
// каждом пересчёте.

export interface QueueTrack {
  id: string
  /** Название — по нему ищется сходство. Без него сигнал просто не работает. */
  name?: string
  /** Исполнитель, если известен. */
  author?: string
  /** Сколько раз трек слушали все вместе. */
  plays?: number
}

export interface PersonalInput<T extends QueueTrack> {
  /** Весь склад в его обычном порядке. */
  tracks: T[]
  /** Номер того, что играет сейчас. */
  idx: number
  /** Сколько раз я слушал каждый трек. */
  plays: Record<string, number>
  /** Когда слушал в последний раз (мс). Нужен только для разрешения ничьих. */
  lastAt?: Record<string, number>
  /** Что играло только что, от свежего к старому: это отодвигается назад. */
  recent?: string[]
  /** Сколько незнакомого подмешать. */
  freshCount?: number
}

/** Почему трек предложен — показывается человеку в очереди. */
export type Why = 'author' | 'similar' | 'mine' | 'popular' | 'fresh' | 'order'

export const WHY_LABEL: Record<Why, string> = {
  author: 'тот же исполнитель',
  similar: 'похоже на то, что играет',
  mine: 'ты это часто слушаешь',
  popular: 'это часто слушают',
  fresh: 'ещё не слушал',
  order: 'дальше по списку',
}

export interface Suggestion<T> { track: T; why: Why; score: number }

/** Слова названия, по которым имеет смысл искать сходство. */
const NOISE = new Set([
  'official', 'video', 'audio', 'lyrics', 'lyric', 'remaster', 'remastered', 'hd', 'the', 'feat', 'ft',
  'prod', 'live', 'version', 'mix', 'remix', 'клип', 'официальный', 'премьера', 'песня',
])
function words(s: string): string[] {
  return (s || '').toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3 && !NOISE.has(w))
}

function norm(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Подбор следующего — по убыванию пригодности, с объяснением каждой строки.
 * Текущий трек в список не попадает: он уже играет.
 */
export function recommend<T extends QueueTrack>(i: PersonalInput<T>): Suggestion<T>[] {
  const { tracks, idx, plays } = i
  const lastAt = i.lastAt ?? {}
  const recent = i.recent ?? []
  const fresh = i.freshCount ?? 3
  const cur = tracks[idx]
  const rest = tracks.filter((_, n) => n !== idx)
  if (rest.length === 0) return []

  const curAuthor = norm(cur?.author)
  const curWords = new Set(words(cur?.name ?? ''))
  const pos = new Map(tracks.map((t, n) => [t.id, n]))
  // Незнакомое подмешиваем от начала склада: там лежит добавленное раньше, то
  // есть то, до чего человек так и не дошёл.
  const freshIds = new Set(rest.filter(t => (plays[t.id] ?? 0) === 0).slice(0, fresh).map(t => t.id))

  const out: Suggestion<T>[] = rest.map(t => {
    const mine = plays[t.id] ?? 0
    const sameAuthor = !!curAuthor && norm(t.author) === curAuthor
    const common = words(t.name ?? '').filter(w => curWords.has(w)).length

    let score = 0
    const reasons: [Why, number][] = []

    if (sameAuthor) { score += 100; reasons.push(['author', 100]) }
    if (common > 0) { const v = Math.min(60, 30 * common); score += v; reasons.push(['similar', v]) }
    if (mine > 0) { const v = 25 * Math.log2(1 + mine); score += v; reasons.push(['mine', v]) }
    const all = t.plays ?? 0
    if (all > 0) { const v = 8 * Math.log2(1 + all); score += v; reasons.push(['popular', v]) }
    if (freshIds.has(t.id)) { score += 20; reasons.push(['fresh', 20]) }

    // Только что игравшее — назад. Чем свежее, тем сильнее отодвигаем, иначе
    // «дальше» будет предлагать то, что человек уже слышал минуту назад.
    const r = recent.indexOf(t.id)
    if (r >= 0) score -= 120 - Math.min(100, r * 20)

    reasons.sort((a, b) => b[1] - a[1])
    return { track: t, why: reasons[0]?.[0] ?? 'order', score }
  })

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const l = (lastAt[b.track.id] ?? 0) - (lastAt[a.track.id] ?? 0)
    if (l !== 0) return l
    return (pos.get(a.track.id) ?? 0) - (pos.get(b.track.id) ?? 0)
  })
  return out
}

/**
 * Прежнее имя — только треки, без объяснений. Остаётся, потому что зовущим его
 * местам объяснение не нужно, а два разных подбора развели бы очередь и то, что
 * реально играет: этим уже обжигались (v1.398.0).
 */
export function personalOrder<T extends QueueTrack>(i: PersonalInput<T>): T[] {
  return recommend(i).map(s => s.track)
}
