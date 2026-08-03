// v1.439.0: как выглядит плитка звука в саундпаде.
//
// Саундпад был списком строк: у каждого звука своя полоса с кнопками «прослушать»
// и «всем». В Discord это СЕТКА одинаковых плиток — по ней глаз находит нужный
// звук за мгновение, а нажатие ровно одно: звук уходит всем. Так и делаем, а
// раскладку выносим сюда, чтобы её можно было проверить.

/** Значок плитки. Подбирается по названию: свои звуки люди называют осмысленно. */
export function tileEmoji(name: string): string {
  const n = (name || '').toLowerCase()
  const rules: [RegExp, string][] = [
    [/смех|ржач|хаха|laugh|lol/, '😂'],
    [/крик|ор\b|ааа|scream/, '😱'],
    [/бум|взрыв|boom|explos/, '💥'],
    [/бараб|drum|бит|beat/, '🥁'],
    [/гитар|guitar|рок|rock/, '🎸'],
    [/побед|win|ура|fanfare/, '🏆'],
    [/провал|fail|печал|sad/, '📉'],
    [/кот|мяу|cat|meow/, '🐱'],
    [/соба|гав|dog|bark/, '🐶'],
    [/звонок|bell|динь/, '🔔'],
    [/мем|meme/, '🗿'],
    [/момент|запись|clip/, '⏱'],
  ]
  for (const [re, em] of rules) if (re.test(n)) return em
  return '🔊'
}

/**
 * Короткая подпись под плиткой.
 *
 * Плитка узкая, и длинное название её распирает. Обрезаем по словам и ставим
 * многоточие: «МЕЛЛСТРОЙ АМ АМ АМ МЕМ» читается и в двадцати знаках, а вот
 * разорванное посреди слова — уже нет.
 */
export function tileLabel(name: string, max = 22): string {
  const s = (name || 'Звук').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

export interface SoundLike { id: string; name: string; ownerId: string; owner: string; duration: number }

/**
 * Порядок плиток: сначала звуки сервера (они общие и их немного), потом свои,
 * потом чужие. Внутри группы — по названию, чтобы место звука не менялось от
 * того, кто когда его загрузил: рука запоминает положение, а не список.
 */
export function orderTiles<T extends SoundLike>(list: T[], meId: string): T[] {
  const rank = (c: T) => (c.ownerId === 'server' ? 0 : c.ownerId === meId ? 1 : 2)
  return [...(list ?? [])].sort((a, b) => {
    const r = rank(a) - rank(b)
    return r !== 0 ? r : (a.name || '').localeCompare(b.name || '', 'ru')
  })
}

/** Отбор по строке поиска — по названию и по имени того, кто выложил. */
export function filterTiles<T extends SoundLike>(list: T[], q: string): T[] {
  const s = (q || '').trim().toLowerCase()
  if (!s) return list
  return list.filter(c => (c.name || '').toLowerCase().includes(s) || (c.owner || '').toLowerCase().includes(s))
}

/** Громкость саундпада: 0–200%, хранится на устройстве. */
const VOL_KEY = 'ponoi_sb_vol'
export function sbVolume(): number {
  const v = parseInt(localStorage.getItem(VOL_KEY) || '100', 10)
  return isNaN(v) ? 100 : Math.max(0, Math.min(200, v))
}
export function setSbVolume(v: number) {
  const val = Math.max(0, Math.min(200, Math.round(v)))
  try { localStorage.setItem(VOL_KEY, String(val)) } catch { /* переполнено */ }
}
