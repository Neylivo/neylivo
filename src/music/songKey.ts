// v1.440.0: когда две записи — одна и та же песня.
//
// Зачем. Очередь не повторяется по id трека, но в складе лежат ремиксы,
// ускоренные версии, «slowed + reverb», каверы и клипы одной и той же вещи —
// у них разные id и разные ссылки, а песня одна. Человек слышит её три раза
// подряд в разных обёртках и справедливо считает, что очередь сломалась.
//
// Здесь — ключ песни: название и исполнитель, очищенные от всего, что говорит
// про ВЕРСИЮ, а не про саму вещь. Совпали ключи — считаем одной песней.

/** Пометки версий, которые к самой песне отношения не имеют. */
const VERSION_WORDS = [
  // ускорение и замедление
  'sped up', 'spedup', 'speed up', 'speedup', 'sped', 'спидап', 'ускоренная', 'ускорено', 'ускорен',
  'slowed', 'slow', 'замедленная', 'замедлено', 'замедлен', 'reverb', 'реверб',
  'nightcore', 'найткор', 'daycore',
  // переработки
  'remix', 'ремикс', 'rmx', 'mashup', 'мэшап', 'bootleg', 'edit', 'flip', 'rework', 'refix',
  'cover', 'кавер', 'acoustic', 'акустика', 'unplugged', 'instrumental', 'инструментал', 'minus', 'минус',
  'karaoke', 'караоке', 'live', 'лайв', 'концерт', 'концертная',
  // издания
  'remaster', 'remastered', 'ремастер', 'radio edit', 'extended', 'original mix', 'club mix',
  'version', 'версия', 'vers', 'ver',
  // мусор из названий роликов
  'official video', 'official audio', 'official', 'video', 'audio', 'lyrics', 'lyric', 'клип',
  'премьера', 'песня', 'music video', 'mv', 'hd', 'hq', '4k', '8d', 'bass boosted', 'басс',
]

/** Всё, что после этих слов, — соавторы, а не название. */
const FEAT_RE = /\s(feat\.?|ft\.?|при участии|совместно с|x|х)\s.+$/iu

function base(s: string | undefined): string {
  let v = (s || '').toLowerCase()
  // Скобки и всё в них: там почти всегда как раз версия.
  v = v.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ')
  // Хвост после тире с пометкой версии: «Песня - Sped Up».
  v = v.replace(FEAT_RE, ' ')
  for (const w of VERSION_WORDS) {
    v = v.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'giu'), ' ')
  }
  // Отдельные хвосты вида «x2», «2x», «120 bpm».
  v = v.replace(/\b\d+\s?(bpm|x)\b/gi, ' ').replace(/\bx\s?\d+\b/gi, ' ')
  // Всё, кроме букв и цифр, — в пробел: тире, точки, эмодзи, разное написание.
  v = v.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return v
}

/**
 * Ключ песни. Пустой — если после чистки ничего не осталось (название состояло
 * из одних пометок): такие сравнивать нельзя, иначе всё безымянное склеится.
 */
export function songKey(name: string | undefined, author?: string | undefined): string {
  let t = base(name)
  if (!t) return ''
  const a = base(author)
  // Имя исполнителя часто повторяется в самом названии («ДДТ — Осень»), особенно
  // у роликов с YouTube. Убираем его из названия, иначе одна и та же песня
  // получит два разных ключа — на этом проверка меня и поймала.
  if (a) {
    if (t.startsWith(a + ' ')) t = t.slice(a.length + 1)
    else if (t.endsWith(' ' + a)) t = t.slice(0, -(a.length + 1))
  }
  if (!t) return ''
  // Исполнитель в ключ входит, но мягко: у ускоренных версий его часто пишут
  // иначе или не пишут вовсе, поэтому решает всё же название.
  return a ? a + '|' + t : t
}

/** Одна ли это песня. Пустые ключи не совпадают ни с чем, включая себя. */
export function sameSong(aName?: string, aAuthor?: string, bName?: string, bAuthor?: string): boolean {
  const ka = songKey(aName, aAuthor), kb = songKey(bName, bAuthor)
  if (!ka || !kb) return false
  if (ka === kb) return true
  // Исполнитель мог не совпасть (у одного он в названии, у другого в поле) —
  // сравниваем ещё и по одному названию.
  const ta = ka.includes('|') ? ka.split('|')[1] : ka
  const tb = kb.includes('|') ? kb.split('|')[1] : kb
  return ta === tb
}
