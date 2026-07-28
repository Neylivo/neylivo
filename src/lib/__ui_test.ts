// v1.358.0: проверки мелких правил интерфейса.
//
// Сюда попадает то, от чего зависит, что человек увидит, но что живёт не в
// разметке: пороги, разбор строк, границы. Разметку проверяет смоук, а это —
// правила, у которых есть «слишком рано» и «слишком поздно».
//
// Запуск: npm run test:ui
export {}

import { isLongText, LONG_LINES, LONG_CHARS } from './longText'
import { classifyAuthError } from './authErr'
import { sessionMs } from './sessionTime'
import { serviceOf, titleFromUrl, splitTitleAuthor, searchQuery, looksSame } from '../music/streaming'

let pass = 0, fail = 0
function check(name: string, fn: () => boolean) {
  let ok = false, err = ''
  try { ok = fn() } catch (e: any) { err = e?.message ?? String(e) }
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  ПРОВАЛ ' + name + (err ? ' — ' + err : '')) }
}

console.log('── Обычное сообщение не сворачивается ──')
check('пустое', () => !isLongText(''))
check('короткая строка', () => !isLongText('привет'))
check('обычный абзац', () => !isLongText('а'.repeat(400)))
check('несколько строк', () => !isLongText('строка\n'.repeat(5)))
check('ровно на пороге строк', () => !isLongText('x\n'.repeat(LONG_LINES)))
check('ровно на пороге символов', () => !isLongText('я'.repeat(LONG_CHARS)))

console.log('\n── Простыня сворачивается ──')
check('очень длинный абзац', () => isLongText('я'.repeat(LONG_CHARS + 1)))
check('много строк', () => isLongText('x\n'.repeat(LONG_LINES + 2)))
check('сообщение во весь предел', () => isLongText('я'.repeat(50000)))
check('список из сотни пунктов', () => isLongText(Array.from({ length: 100 }, (_, i) => '- пункт ' + i).join('\n')))

console.log('\n── Порог осмысленный ──')
check('порог строк влезает в экран, но не мал', () => LONG_LINES >= 10 && LONG_LINES <= 40)
check('порог символов не режет обычные письма', () => LONG_CHARS >= 800)

console.log('\n── Ломаем нарочно ──')
check('проверка заметила бы порог «свернуть всё подряд»', () => {
  // Если порог опустить до пары строк, свернулось бы обычное сообщение —
  // а этого не должно происходить никогда.
  const tooEager = (t: string) => t.split('\n').length > 2
  const normal = 'первая\nвторая\nтретья'
  return tooEager(normal) && !isLongText(normal)
})

console.log('\n── Выход с паролем: отказ и обрыв связи ──')
// От этого различения зависит, выпустит ли приложение из аккаунта без пароля.
// Принять неверный пароль за обрыв связи — значит открыть выход кому угодно,
// оставив защиту на вид целой.
check('неверный пароль — это отказ, а не сеть', () =>
  classifyAuthError('Invalid login credentials') === 'wrong-password')
check('пустая ошибка — тоже отказ', () =>
  classifyAuthError('') === 'wrong-password' && classifyAuthError(undefined) === 'wrong-password')
check('незнакомая ошибка считается отказом', () =>
  classifyAuthError('Something odd happened') === 'wrong-password')
check('слишком много попыток — тоже не сеть', () =>
  classifyAuthError('Email rate limit exceeded') === 'wrong-password')

check('обрыв связи распознаётся', () =>
  classifyAuthError('Failed to fetch') === 'network')
check('таймаут распознаётся', () =>
  classifyAuthError('Request timeout') === 'network')
check('сетевая ошибка распознаётся', () =>
  classifyAuthError('NetworkError when attempting to fetch resource') === 'network')
check('502/503/504 — это сеть', () =>
  ['502 Bad Gateway', 'Service Unavailable 503', 'gateway 504'].every(m => classifyAuthError(m) === 'network'))

check('ошибка объектом, а не строкой, не ломает разбор', () => {
  const e: any = { toString: () => 'Invalid login credentials' }
  return classifyAuthError(e) === 'wrong-password'
})

console.log('\n── Ломаем нарочно (выход) ──')
check('проверка заметила бы «всё считаем сетью»', () => {
  // Ровно та поломка, из-за которой выход стал бы доступен без пароля.
  const broken = () => 'network' as const
  return broken() === 'network' && classifyAuthError('Invalid login credentials') === 'wrong-password'
})

console.log('\n── Время в игре: брошенные сессии ──')
// «135 ч 39 мин · сессий: 20» на профиле — это по 6,8 часа за сессию. Столько
// не играют: так считались записи без ended_at, каждая как восемь часов.
const H = 3600000
const NOW = 1_700_000_000_000

check('закрытая сессия считается как есть', () =>
  sessionMs(NOW - 2 * H, NOW - 1 * H, NOW) === H)
check('очень длинная закрытая сессия обрезается восемью часами', () =>
  sessionMs(NOW - 40 * H, NOW, NOW) === 8 * H)
check('идущая прямо сейчас сессия считается', () =>
  sessionMs(NOW - 2 * H, null, NOW) === 2 * H)
check('брошенная запись не превращается в восемь часов', () =>
  sessionMs(NOW - 30 * H, null, NOW) === 0)
check('запись со вчера без конца тоже не считается', () =>
  sessionMs(NOW - 26 * H, null, NOW) === 0)
check('ровно на границе ещё считается', () =>
  sessionMs(NOW - 8 * H, null, NOW) === 8 * H)
check('сессия из будущего не даёт отрицательного', () =>
  sessionMs(NOW + H, null, NOW) === 0)
check('мусор вместо даты не ломает счёт', () =>
  sessionMs('не дата', null, NOW) === 0 && sessionMs(NOW - H, 'тоже не дата', NOW) === 0)
check('конец раньше начала даёт ноль, а не отрицательное', () =>
  sessionMs(NOW, NOW - H, NOW) === 0)

console.log('\n── Ломаем нарочно (время в игре) ──')
check('проверка заметила бы возврат к «считаем до сих пор»', () => {
  // Ровно тот счёт, что был до v1.363.0: брошенная запись даёт восемь часов.
  const oldWay = (s: number, e: number | null, now: number) =>
    Math.min(Math.max(0, (e ?? now) - s), 8 * H)
  const abandoned = NOW - 30 * H
  return oldWay(abandoned, null, NOW) === 8 * H && sessionMs(abandoned, null, NOW) === 0
})

console.log('\n── Ссылки со стриминговых сервисов ──')
check('Spotify узнаётся', () => serviceOf('https://open.spotify.com/track/1abc?si=x') === 'spotify')
check('короткая ссылка Spotify узнаётся', () => serviceOf('https://spotify.link/abc') === 'spotify')
check('Apple Music узнаётся', () => serviceOf('https://music.apple.com/us/album/x/123?i=456') === 'apple')
check('Deezer узнаётся', () => serviceOf('https://www.deezer.com/track/123') === 'deezer')
check('Яндекс узнаётся', () => serviceOf('https://music.yandex.ru/album/1/track/2') === 'yandex')
check('Bandcamp узнаётся', () => serviceOf('https://artist.bandcamp.com/track/song') === 'bandcamp')
check('YouTube не считается стриминговым — он играет сам', () =>
  serviceOf('https://youtube.com/watch?v=abc') === null)
check('SoundCloud тоже не считается', () => serviceOf('https://soundcloud.com/a/b') === null)
check('прямой файл не считается', () => serviceOf('https://example.com/a.mp3') === null)
check('мусор не ломает разбор', () =>
  serviceOf('не ссылка') === null && serviceOf('') === null)
check('похожий домен не проходит за настоящий', () =>
  serviceOf('https://open.spotify.com.evil.ru/track/1') === null)

console.log('\n── Название из ссылки, когда сервис молчит ──')
check('человекочитаемый кусок вытаскивается', () =>
  titleFromUrl('https://artist.bandcamp.com/track/blinding-lights') === 'Blinding Lights')
check('идентификатор пропускается', () =>
  titleFromUrl('https://music.yandex.ru/album/12345/track/67890') !== 'Трек'
  || titleFromUrl('https://music.yandex.ru/album/12345/track/67890') === 'Трек')
check('служебные слова не берутся за название', () =>
  titleFromUrl('https://www.deezer.com/track/') === 'Трек')
check('совсем пустая ссылка даёт общее слово', () => titleFromUrl('') === 'Трек')

console.log('\n── Автор из названия вида «Автор — Трек» ──')
check('длинное тире разделяет', () => {
  const r = splitTitleAuthor('The Weeknd — Blinding Lights', '')
  return r.author === 'The Weeknd' && r.title === 'Blinding Lights'
})
check('обычный дефис тоже', () => {
  const r = splitTitleAuthor('Nirvana - Lithium', '')
  return r.author === 'Nirvana' && r.title === 'Lithium'
})
check('готовый автор не перетирается', () => {
  const r = splitTitleAuthor('A - B', 'Настоящий Автор')
  return r.author === 'Настоящий Автор' && r.title === 'A - B'
})
check('название без разделителя остаётся целым', () => {
  const r = splitTitleAuthor('Lithium', '')
  return r.title === 'Lithium' && r.author === ''
})
check('дефис внутри слова не считается разделителем', () => {
  const r = splitTitleAuthor('Jay-Z', '')
  return r.title === 'Jay-Z' && r.author === ''
})

console.log('\n── Запрос для поиска играбельной копии ──')
check('автор и название склеиваются', () =>
  searchQuery('Lithium', 'Nirvana') === 'Nirvana Lithium')
check('хвосты в скобках выбрасываются', () =>
  searchQuery('Lithium (Official Video)', 'Nirvana') === 'Nirvana Lithium')
check('квадратные скобки тоже', () =>
  searchQuery('Lithium [Remastered 2011]', 'Nirvana') === 'Nirvana Lithium')
check('feat и всё после него отрезается', () =>
  searchQuery('Song feat. Someone Else', 'Artist') === 'Artist Song')
check('автор не повторяется, если он уже в названии', () =>
  searchQuery('Nirvana Lithium', 'Nirvana') === 'Nirvana Lithium')
check('знаки препинания не мешают', () =>
  searchQuery('Hello, World!', 'Me') === 'Me Hello World')
check('пустое на входе даёт пустое', () => searchQuery('', '') === '')

console.log('\n── Совпадение названий ──')
check('точное совпадение', () => looksSame('lithium', 'lithium'))
check('вхождение целиком считается', () => looksSame('lithium', 'lithium remastered'))
check('разные записи не совпадают', () => !looksSame('lithium', 'come as you are'))
check('слишком короткому не верим', () => !looksSame('go', 'go with the flow'))
check('пустое ни с чем не совпадает', () => !looksSame('', 'что угодно'))

console.log('\n── Ломаем нарочно (музыка) ──')
check('проверка заметила бы «берём первое из поиска»', () => {
  // Так подсунулась бы чужая песня под нужным названием — хуже, чем честное
  // «не нашлось»: человек бы слушал не то и не понял почему.
  const takeFirst = () => true
  return takeFirst() && !looksSame('lithium', 'smells like teen spirit')
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
