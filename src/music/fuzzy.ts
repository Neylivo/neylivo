// v1.442.0: поиск по складу, который прощает опечатки.
//
// Что было. Поиск сравнивал строки через `includes`: одна лишняя буква, другая
// раскладка или «ё» вместо «е» — и трек «не найден», хотя он лежит прямо тут.
// На складе в восемь тысяч песен это означало «поиск не работает»: человек ведь
// не знает, что ошибся, он видит пустоту.
//
// Здесь: приведение к общему виду, расстояние между словами и подсказка
// «возможно, вы имели в виду». Всё чистыми функциями — иначе это не проверить.

/** Раскладка: что получается, если печатать русский текст в английской. */
const LAYOUT: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
  a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
  z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю',
}

/** Перевести строку из английской раскладки в русскую. */
export function fromEnLayout(s: string): string {
  return (s || '').toLowerCase().split('').map(c => LAYOUT[c] ?? c).join('')
}

/**
 * Общий вид строки: без регистра, без «ё», без знаков и лишних пробелов.
 *
 * «ё» → «е» намеренно: половина людей его не печатает, и «Ёлка» против «Елка»
 * — это не разные исполнители, а одна и та же опечатка у половины склада.
 */
export function norm(s: string | undefined | null): string {
  return (s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * Расстояние Дамерау — Левенштейна с потолком.
 *
 * Потолок обязателен: без него сравнение длинных названий стоит их произведения,
 * а сравнивать приходится со всем складом на каждое нажатие клавиши. Дошли до
 * потолка — дальше считать незачем, ответ уже «не похоже».
 */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2: number[] = new Array(b.length + 1)
  let prev: number[] = new Array(b.length + 1)
  let cur: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let best = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      // Перестановка соседних букв («леат» вместо «лета») — одна ошибка, а не две.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1)
      }
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev2.splice(0, prev2.length, ...prev)
    const t = prev; prev = cur; cur = t
  }
  return prev[b.length]
}

/** Сколько ошибок прощаем слову такой длины: коротким — меньше. */
export function allowedSlips(len: number): number {
  if (len <= 3) return 0
  if (len <= 5) return 1
  if (len <= 9) return 2
  return 3
}

/**
 * Похоже ли слово запроса на слово названия.
 *
 * Начало слова важнее конца: человек печатает сначала, а не с середины, поэтому
 * «нача» находит «начало» без всякой нечёткости, а вот «ночало» — уже через неё.
 */
export function wordMatches(needle: string, hay: string): boolean {
  if (!needle) return true
  if (hay.startsWith(needle) || hay.includes(needle)) return true
  return editDistance(needle, hay, allowedSlips(needle.length)) <= allowedSlips(needle.length)
}

/**
 * Насколько строка подходит под запрос. 0 — не подходит вовсе.
 *
 * Число, а не «да/нет», потому что список надо ещё и упорядочить: точное
 * совпадение должно стоять выше, чем найденное через две опечатки.
 */
export function matchScore(query: string, text: string): number {
  const q = norm(query), t = norm(text)
  if (!q) return 1
  if (!t) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 700
  if (t.includes(q)) return 500
  const qw = q.split(' ').filter(Boolean)
  const tw = t.split(' ').filter(Boolean)
  if (!qw.length || !tw.length) return 0
  let hit = 0, exact = 0
  for (const w of qw) {
    const found = tw.find(x => wordMatches(w, x))
    if (!found) continue
    hit++
    if (found === w || found.startsWith(w)) exact++
  }
  if (hit < qw.length) return 0            // нашлось не всё, что искали
  return 200 + exact * 40 - Math.min(100, t.length)
}

export interface Searchable { name?: string; author?: string }

/** Подходит ли трек под запрос — с учётом и названия, и исполнителя. */
export function trackScore<T extends Searchable>(query: string, t: T, title?: string, author?: string): number {
  const a = matchScore(query, title ?? t.name ?? '')
  const b = matchScore(query, author ?? t.author ?? '')
  // Ещё одна попытка — на случай не той раскладки. Считается только если прямая
  // не дала ничего: иначе «fyfybc» случайно находило бы английские названия.
  if (a === 0 && b === 0) {
    const q2 = fromEnLayout(query)
    if (q2 !== query.toLowerCase()) {
      return Math.max(matchScore(q2, title ?? t.name ?? ''), matchScore(q2, author ?? t.author ?? ''))
    }
  }
  return Math.max(a, b)
}

/**
 * Подсказка «возможно, вы имели в виду» — самое близкое из того, что есть.
 *
 * Показывается только когда прямой поиск не нашёл ничего: подсказывать при
 * непустой выдаче значит спорить с человеком, который уже нашёл нужное.
 */
export function suggestQuery(query: string, names: string[], max = 1): string[] {
  const q = norm(query)
  if (!q || q.length < 3) return []
  const seen = new Set<string>()
  const scored: { name: string; d: number }[] = []
  for (const raw of names) {
    const n = norm(raw)
    if (!n || seen.has(n)) continue
    seen.add(n)
    // Сравниваем и целиком, и по первому слову: люди ищут одним словом чаще.
    const d = Math.min(editDistance(q, n, 4), editDistance(q, n.split(' ')[0] ?? '', 4))
    if (d <= allowedSlips(q.length) + 1) scored.push({ name: raw, d })
  }
  scored.sort((a, b) => a.d - b.d || a.name.length - b.name.length)
  return scored.slice(0, max).map(s => s.name)
}
