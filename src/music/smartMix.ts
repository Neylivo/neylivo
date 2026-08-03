// v1.442.0: «Подборка» — интересная выборка из склада одним нажатием.
//
// Зачем. В Трекотеке восемь тысяч треков, и человек либо ищет знакомое, либо
// листает список сверху. Волна (personalQueue) подбирает следующий трек, но
// только следующий — а хочется «собери мне что послушать» и нажать «играть».
//
// Здесь — сборка такой подборки. Это не новый подбор: тот же recommend, просто
// вызванный несколько раз подряд, каждый раз с учётом уже набранного. Свой
// второй алгоритм подбора развёл бы «что советуют» и «что играет» — в этом
// проекте на таком обжигались не раз.

import { recommend, type QueueTrack, type PersonalInput } from './personalQueue'
import { songKey } from './songKey'

export interface MixInput<T extends QueueTrack> extends Omit<PersonalInput<T>, 'idx'> {
  /** Сколько треков собрать. */
  size?: number
  /** С чего начать: номер трека, от которого пляшем. -1 — начать с чистого листа. */
  from?: number
}

/** Сколько треков в подборке по умолчанию: час-полтора музыки. */
export const MIX_SIZE = 25

/**
 * Собрать подборку.
 *
 * Правила те же, что у волны, плюс два своих:
 *   • одна и та же песня в другой обёртке (ремикс, ускоренная) в подборку не
 *     попадает дважды — по ключу песни, а не по id;
 *   • не больше двух треков одного исполнителя подряд — это уже проверено в
 *     самой волне, но здесь мы идём длиннее, и без явного присмотра подборка
 *     сползала бы в одного автора.
 */
export function smartMix<T extends QueueTrack>(i: MixInput<T>): T[] {
  const size = Math.max(1, Math.min(100, i.size ?? MIX_SIZE))
  const picked: T[] = []
  const usedIds = new Set<string>()
  const usedKeys = new Set<string>()
  const recent = [...(i.recent ?? [])]
  let idx = i.from ?? -1

  for (let step = 0; step < size; step++) {
    const list = recommend({ ...i, idx, recent })
    const next = list.find(s => {
      if (usedIds.has(s.track.id)) return false
      const k = songKey(s.track.name, s.track.author)
      return !(k && usedKeys.has(k))
    })
    if (!next) break
    picked.push(next.track)
    usedIds.add(next.track.id)
    const k = songKey(next.track.name, next.track.author)
    if (k) usedKeys.add(k)
    // Следующий шаг считается так, будто этот трек уже прозвучал: тогда и запрет
    // повтора, и «не больше двух одного автора подряд» работают сами.
    recent.unshift(next.track.id)
    idx = i.tracks.findIndex(t => t.id === next.track.id)
  }
  return picked
}

/** Подпись под кнопкой: «25 треков · 1 ч 34 мин». */
export function mixSummary(tracks: { dur?: number }[]): string {
  const n = tracks.length
  const sec = tracks.reduce((s, t) => s + (t.dur && t.dur > 0 ? t.dur : 0), 0)
  const word = n % 10 === 1 && n % 100 !== 11 ? 'трек' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'трека' : 'треков'
  if (!sec) return n + ' ' + word
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60)
  return n + ' ' + word + ' · ' + (h ? h + ' ч ' : '') + m + ' мин'
}
