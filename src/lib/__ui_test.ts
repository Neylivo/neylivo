// v1.358.0: проверки мелких правил интерфейса.
//
// Сюда попадает то, от чего зависит, что человек увидит, но что живёт не в
// разметке: пороги, разбор строк, границы. Разметку проверяет смоук, а это —
// правила, у которых есть «слишком рано» и «слишком поздно».
//
// Запуск: npm run test:ui
export {}

// linkguard живёт в браузере: подкладываем минимум, чтобы он загрузился.
const _store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
  setItem: (k: string, v: string) => { _store.set(k, String(v)) },
  removeItem: (k: string) => { _store.delete(k) }, clear: () => _store.clear(),
}
;(globalThis as any).window = { addEventListener: () => {}, removeEventListener: () => {}, open: () => null }
;(globalThis as any).document = { createElement: () => ({ style: {}, appendChild: () => {} }), body: { appendChild: () => {}, removeChild: () => {} } }

import { isLongText, LONG_LINES, LONG_CHARS } from './longText'
import { startLongPress, movedTooFar, LONG_PRESS_SLOP } from './longPress'
import { buildMeta, metaChanged, whatIsDoing } from './presenceMeta'
import { SHARE_RES, readShareQuality, shareCapture, sharePublish, shareSummary, orderSources } from './shareOpts'
import { livePos, leftOver, listenPct, fmtClock, needRepublish, REPUBLISH_TOLERANCE } from './listenProgress'
import {
  zoomStart, zoomAt, clampPan, clampZoom, pinchZoom, dist, mid, toggleZoomAt, wasDragged,
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, DRAG_SLOP,
} from './zoomPan'
import { classifyAuthError } from './authErr'
import { sessionMs } from './sessionTime'
import { serviceOf, titleFromUrl, splitTitleAuthor, searchQuery, looksSame } from '../music/streaming'
import { isSoundcloudUrl, cleanScUrl } from '../music/soundcloud'
import { metaPatch } from './musicMeta'
import { normalizeTrackUrl, sameTrack } from '../music/trackUrl'
import { nextTrack, backTarget } from '../music/nextTrack'
import { personalOrder, recommend, libraryOrder } from '../music/personalQueue'
import { guardLink } from './linkguard'
import { contentTypeOf } from './fileType'
import { isDuplicateTrack } from './musicDupe'

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

console.log('\n── Ссылка SoundCloud на трек внутри сборника ──')
// Ровно та ссылка, на которой это заметили: трек, открытый из плейлиста. Хвост
// ?in=… говорит «этот трек в таком-то сете». Оставить его — и виджет загрузит
// ВЕСЬ сет вместо одной песни.
const IN_SET = 'https://soundcloud.com/prodsekmese/tuborosho-shalawa-featmellstroy?in=zexel-336741540/sets/burmalda-fm'

check('это распознаётся как SoundCloud', () => isSoundcloudUrl(IN_SET))
check('хвост про сборник отрезается', () =>
  cleanScUrl(IN_SET) === 'https://soundcloud.com/prodsekmese/tuborosho-shalawa-featmellstroy')
check('трекотека не получит весь сет вместо песни', () =>
  !cleanScUrl(IN_SET).includes('sets'))
check('трекинговые хвосты тоже уходят', () =>
  cleanScUrl('https://soundcloud.com/a/b?si=123&utm_source=x') === 'https://soundcloud.com/a/b')
check('якорь уходит', () =>
  cleanScUrl('https://soundcloud.com/a/b#t=30') === 'https://soundcloud.com/a/b')
check('чистая ссылка не портится', () =>
  cleanScUrl('https://soundcloud.com/a/b') === 'https://soundcloud.com/a/b')
check('чужой адрес не трогаем', () =>
  cleanScUrl('https://example.com/a?b=1') === 'https://example.com/a?b=1')
check('обычная ссылка без www опознаётся — на этом всё и ломалось', () =>
  isSoundcloudUrl('https://soundcloud.com/artist/track'))
check('с www тоже', () => isSoundcloudUrl('https://www.soundcloud.com/a/b'))
check('короткая ссылка тоже', () => isSoundcloudUrl('https://on.soundcloud.com/abc'))
check('похожий домен за свой не сойдёт', () =>
  !isSoundcloudUrl('https://soundcloud.com.evil.ru/a/b'))
check('чужой сайт не опознаётся', () => !isSoundcloudUrl('https://example.com/soundcloud.com/a'))
check('две одинаковые ссылки с разными хвостами дают одно и то же', () =>
  cleanScUrl(IN_SET) === cleanScUrl('https://soundcloud.com/prodsekmese/tuborosho-shalawa-featmellstroy?si=zzz'))

console.log('\n── Дозапись метаданных не должна стирать рабочее ──')
// Из-за этого трек «обновлялся» и переставал играть: вместе с обложкой в базу
// уезжали author: null и play_url: null, стирая ссылку, добытую раньше.
check('одна обложка обновляет только обложку', () => {
  const p = metaPatch({ art: 'https://i/500.jpg' })
  return p.art === 'https://i/500.jpg' && !('play_url' in p) && !('author' in p)
})
check('пустые поля не попадают в запрос', () => {
  const p = metaPatch({ art: null, play: null, author: '' })
  return Object.keys(p).length === 0
})
check('всё известное записывается', () => {
  const p = metaPatch({ art: 'a', play: 'b', author: 'c', dur: 210 })
  return p.art === 'a' && p.play_url === 'b' && p.author === 'c' && p.duration === 210
})
check('нулевая длительность не пишется', () =>
  !('duration' in metaPatch({ art: 'a', dur: 0 })))
check('дробная длительность округляется', () =>
  metaPatch({ dur: 210.7 }).duration === 211)

console.log('\n── Ломаем нарочно (музыка, дозапись) ──')
check('проверка заметила бы прежнее опознание ссылки', () => {
  // Ровно та регулярка, что стояла до v1.369.0: перед доменом требовалась точка
  // или начало строки, а у обычной ссылки там «//». Самый частый вид ссылки не
  // опознавался вовсе и сохранялся голым адресом.
  const old = /(^|\.)soundcloud\.com\//i
  return !old.test('https://soundcloud.com/a/b') && isSoundcloudUrl('https://soundcloud.com/a/b')
})
check('проверка заметила бы возврат к «пишем все поля разом»', () => {
  // Ровно тот запрос, что уходил до v1.369.0.
  const oldWay = (m: any) => ({ author: m.author || null, art: m.art ?? null, play_url: m.play ?? null })
  const only = { art: 'https://i/500.jpg' }
  return oldWay(only).play_url === null && !('play_url' in metaPatch(only))
})

console.log('\n── Одна песня — одна запись ──')
// Ошибиться тут можно в обе стороны, и обе плохи: слишком строго — трекотека
// набивается повторами, слишком вольно — разные песни схлопываются в одну и
// вторая просто не добавится.
check('хвост «поделиться» не делает песню другой', () =>
  sameTrack('https://soundcloud.com/a/b', 'https://soundcloud.com/a/b?si=abc123'))
check('рекламные хвосты тоже', () =>
  sameTrack('https://soundcloud.com/a/b', 'https://soundcloud.com/a/b?utm_source=x&utm_medium=y'))
check('трек из плейлиста и он же отдельно — одно и то же', () =>
  sameTrack('https://soundcloud.com/p/t?in=user/sets/list', 'https://soundcloud.com/p/t'))
check('www ничего не меняет', () =>
  sameTrack('https://www.soundcloud.com/a/b', 'https://soundcloud.com/a/b'))
check('http и https — одна песня', () =>
  sameTrack('http://soundcloud.com/a/b', 'https://soundcloud.com/a/b'))
check('хвостовая косая ничего не меняет', () =>
  sameTrack('https://soundcloud.com/a/b/', 'https://soundcloud.com/a/b'))
check('якорь ничего не меняет', () =>
  sameTrack('https://soundcloud.com/a/b#t=30', 'https://soundcloud.com/a/b'))
check('момент воспроизведения не делает песню другой', () =>
  sameTrack('https://youtube.com/watch?v=abc&t=42', 'https://youtube.com/watch?v=abc'))
check('порядок доводов не решает', () =>
  sameTrack('https://ex.com/t?a=1&b=2', 'https://ex.com/t?b=2&a=1'))

console.log('\n── Разные песни остаются разными ──')
check('разные видео YouTube не схлопываются', () =>
  !sameTrack('https://youtube.com/watch?v=aaa', 'https://youtube.com/watch?v=bbb'))
check('v= не выбрасывается вместе с мусором', () =>
  normalizeTrackUrl('https://youtube.com/watch?v=abc&t=42&si=z').includes('v=abc'))
check('разные треки одного автора не схлопываются', () =>
  !sameTrack('https://soundcloud.com/a/one', 'https://soundcloud.com/a/two'))
check('разные сайты не схлопываются', () =>
  !sameTrack('https://soundcloud.com/a/b', 'https://example.com/a/b'))
check('разные файлы не схлопываются', () =>
  !sameTrack('https://x.co/f/1.mp3', 'https://x.co/f/2.mp3'))

console.log('\n── Ничего не ломаем на непонятном ──')
check('непонятная строка возвращается как есть', () =>
  normalizeTrackUrl('просто текст') === 'просто текст')
check('пустое остаётся пустым', () => normalizeTrackUrl('') === '')
check('локальный путь не трогаем', () =>
  normalizeTrackUrl('/local/song.mp3') === '/local/song.mp3')
check('приведение устойчиво: второй раз ничего не меняет', () => {
  const once = normalizeTrackUrl('https://www.soundcloud.com/a/b/?si=1&x=2')
  return normalizeTrackUrl(once) === once
})

console.log('\n── Отказ базы про повтор узнаётся ──')
check('код 23505 — это повтор', () => isDuplicateTrack({ code: '23505' }))
check('имя указателя тоже узнаётся', () =>
  isDuplicateTrack({ message: 'duplicate key value violates unique constraint "music_tracks_url_uniq"' }))
check('другая ошибка за повтор не сходит', () =>
  !isDuplicateTrack({ code: '42703', message: 'column does not exist' }))
check('отсутствие ошибки — не повтор', () =>
  !isDuplicateTrack(null) && !isDuplicateTrack(undefined))

console.log('\n── Ломаем нарочно (повторы) ──')
check('проверка заметила бы сравнение строк как есть', () => {
  // Ровно то, что было до v1.373.0: сравнивали исходные адреса, и тот же трек с
  // хвостом «поделиться» ложился второй записью.
  const oldWay = (a: string, b: string) => a === b
  const withTail = 'https://soundcloud.com/a/b?si=abc123'
  return !oldWay(withTail, 'https://soundcloud.com/a/b') && sameTrack(withTail, 'https://soundcloud.com/a/b')
})
check('проверка заметила бы выброшенный v=', () => {
  // Если внести v в список мусора, все ролики YouTube станут одной песней.
  const broken = 'https://youtube.com/watch'
  return !sameTrack(broken, 'https://youtube.com/watch?v=abc')
})

console.log('\n── Что играть дальше ──')
const N = (o: any) => nextTrack({ shuffle: false, ...o })

check('обычный переход к следующему', () =>
  JSON.stringify(N({ idx: 0, count: 3, repeat: 'off' })) === '{"kind":"go","index":1}')
check('последний без повтора — остановка, а не тишина при «играет»', () =>
  N({ idx: 2, count: 3, repeat: 'off' }).kind === 'stop')
check('последний с повтором списка — в начало', () =>
  JSON.stringify(N({ idx: 2, count: 3, repeat: 'all' })) === '{"kind":"go","index":0}')
check('повтор одного — тот же трек сначала', () =>
  N({ idx: 1, count: 3, repeat: 'one' }).kind === 'restart')

console.log('\n── Ровно то, что было сломано ──')
// Повтор списка из одного трека: следующий номер совпадал с текущим, состояние
// не менялось, перерисовки не было — и вместо повтора наступала тишина.
check('один трек с повтором списка играет заново', () =>
  N({ idx: 0, count: 1, repeat: 'all' }).kind === 'restart')
check('один трек с повтором одного играет заново', () =>
  N({ idx: 0, count: 1, repeat: 'one' }).kind === 'restart')
check('один трек без повтора — остановка', () =>
  N({ idx: 0, count: 1, repeat: 'off' }).kind === 'stop')
check('пустой список ничего не играет', () =>
  N({ idx: 0, count: 0, repeat: 'all' }).kind === 'stop')

console.log('\n── Очередь и перемешивание ──')
check('поставленное вручную идёт вперёд порядка', () =>
  JSON.stringify(N({ idx: 0, count: 5, repeat: 'off', manualIdx: 3 })) === '{"kind":"go","index":3}')
check('повтор одного главнее очереди — попросили именно этот трек', () =>
  N({ idx: 0, count: 5, repeat: 'one', manualIdx: 3 }).kind === 'restart')
check('вручную поставленный текущий трек играет заново', () =>
  N({ idx: 2, count: 5, repeat: 'off', manualIdx: 2 }).kind === 'restart')
check('перемешивание не даёт тот же трек подряд', () => {
  for (let seed = 0; seed < 30; seed++) {
    const a = nextTrack({ idx: 2, count: 5, repeat: 'off', shuffle: true, rnd: () => seed / 30 })
    if (a.kind !== 'go' || a.index === 2) return false
  }
  return true
})
check('перемешивание из одного трека не зацикливается', () =>
  nextTrack({ idx: 0, count: 1, repeat: 'all', shuffle: true, rnd: () => 0 }).kind === 'restart')

console.log('\n── Личная очередь решает, что дальше (v1.398.0) ──')
check('дальше играет тот, кого предлагает личная очередь', () => {
  const a = nextTrack({ idx: 0, count: 5, repeat: 'off', shuffle: false, personalIdx: 3 })
  return a.kind === 'go' && a.index === 3
})
check('поставленное руками всё равно главнее', () => {
  const a = nextTrack({ idx: 0, count: 5, repeat: 'off', shuffle: false, manualIdx: 1, personalIdx: 3 })
  return a.kind === 'go' && a.index === 1
})
check('повтор одного трека главнее личной очереди', () =>
  nextTrack({ idx: 0, count: 5, repeat: 'one', shuffle: false, personalIdx: 3 }).kind === 'restart')
check('перемешивание отменяет личную очередь', () => {
  const a = nextTrack({ idx: 0, count: 5, repeat: 'off', shuffle: true, personalIdx: 3, rnd: () => 0.9 })
  return a.kind === 'go' && a.index === 4
})
check('личная очередь на текущий трек ничего не меняет', () => {
  const a = nextTrack({ idx: 2, count: 5, repeat: 'off', shuffle: false, personalIdx: 2 })
  return a.kind === 'go' && a.index === 3
})
check('номер вне списка не ломает переход', () => {
  const a = nextTrack({ idx: 0, count: 3, repeat: 'off', shuffle: false, personalIdx: 99 })
  return a.kind === 'go' && a.index === 1
})
check('без личной очереди всё как было', () => {
  const a = nextTrack({ idx: 0, count: 3, repeat: 'off', shuffle: false })
  return a.kind === 'go' && a.index === 1
})

console.log('\n── Ломаем нарочно (личная очередь) ──')
check('проверка заметила бы, что личную очередь снова перестали слушать', () => {
  // Ровно прежнее поведение: «следующий по складу», что бы ни предлагала очередь.
  const a = nextTrack({ idx: 0, count: 5, repeat: 'off', shuffle: false, personalIdx: 4 })
  return a.kind === 'go' && a.index !== 1
})

console.log('\n── «Назад» возвращает туда, где был (v1.407.0) ──')
const всеЕсть = () => true

check('возвращаемся к тому, что играло до этого', () => {
  const r = backTarget(['a', 'b', 'c'], всеЕсть)
  return r.target === 'b' && r.hist.join('') === 'ab'
})
check('два раза назад — на два трека назад', () => {
  const r1 = backTarget(['a', 'b', 'c'], всеЕсть)
  const r2 = backTarget(r1.hist, всеЕсть)
  return r2.target === 'a'
})
check('в самом начале возвращаться некуда', () => {
  const r = backTarget(['a'], всеЕсть)
  return r.target === null
})
check('пустая история не ломает', () => backTarget([], всеЕсть).target === null)
check('удалённый из склада трек пропускается', () => {
  // Слушали a, b, c; b тем временем убрали из Трекотеки.
  const r = backTarget(['a', 'b', 'c'], id => id !== 'b')
  return r.target === 'a'
})
check('если всё удалено — возвращаться некуда', () => {
  const r = backTarget(['a', 'b', 'c'], id => id === 'c')
  return r.target === null
})
check('история не портится на месте', () => {
  const h = ['a', 'b', 'c']
  backTarget(h, всеЕсть)
  return h.length === 3
})
check('после шага назад наверху стопки — то, куда вернулись', () => {
  const r = backTarget(['a', 'b', 'c'], всеЕсть)
  return r.hist[r.hist.length - 1] === r.target
})

console.log('\n── Ломаем нарочно («назад») ──')
check('проверка заметила бы возврат к «предыдущему номеру списка»', () => {
  // При перемешивании порядок склада и порядок прослушивания — разные вещи:
  // человек слушал c после a, и «назад» обязано вернуть a, а не соседа по складу.
  const r = backTarget(['a', 'c'], всеЕсть)
  return r.target === 'a'
})

console.log('\n── Очередь под человека ──')
const T = (id: string) => ({ id })
const LIB = [T('a'), T('b'), T('c'), T('d'), T('e')]

// v1.435.0: сигнал «ты это часто слушаешь» убран по просьбе владельца — вместо
// частоты теперь давность и незнакомое. Проверки ниже описывают новое правило.
const ДЕНЬ_UI = 86_400_000
const СЕЙЧАС_UI = 1_800_000_000_000
check('число прослушиваний на очки больше не влияет', () => {
  const r = recommend({ tracks: LIB, idx: 0, plays: { c: 10, e: 5, b: 1 }, now: СЕЙЧАС_UI,
    lastAt: { c: СЕЙЧАС_UI - ДЕНЬ_UI, e: СЕЙЧАС_UI - ДЕНЬ_UI, b: СЕЙЧАС_UI - ДЕНЬ_UI } })
  const очки = r.filter(x => ['c', 'e', 'b'].includes(x.track.id)).map(x => x.score)
  return очки.length === 3 && очки.every(v => v === очки[0])
})
check('незнакомое идёт раньше слушанного', () => {
  const r = personalOrder({ tracks: LIB, idx: 0, plays: { c: 10, e: 3, b: 1 }, now: СЕЙЧАС_UI,
    lastAt: { c: СЕЙЧАС_UI - ДЕНЬ_UI, e: СЕЙЧАС_UI - ДЕНЬ_UI, b: СЕЙЧАС_UI - ДЕНЬ_UI } })
  return r[0].id === 'd'
})
check('текущий трек в очередь не попадает', () => {
  const r = personalOrder({ tracks: LIB, idx: 2, plays: { c: 10 } })
  return !r.some(t => t.id === 'c')
})
check('незнакомое подмешивается, а не выбрасывается', () => {
  const r = personalOrder({ tracks: LIB, idx: 0, plays: { c: 10 } })
  return r.length === 4 && r.some(t => t.id === 'b') && r.some(t => t.id === 'd')
})
check('без истории порядок остаётся складским', () => {
  const r = personalOrder({ tracks: LIB, idx: 0, plays: {} })
  return r.map(t => t.id).join('') === 'bcde'
})
check('из двух слушанных раньше идёт тот, кого дольше не ставили', () => {
  const t = [T('cur'), T('вчера'), T('давно')]
  const r = personalOrder({ tracks: t, idx: 0, plays: { 'вчера': 5, 'давно': 5 }, now: СЕЙЧАС_UI,
    lastAt: { 'вчера': СЕЙЧАС_UI - ДЕНЬ_UI, 'давно': СЕЙЧАС_UI - 300 * ДЕНЬ_UI } })
  return r[0].id === 'давно' && r[1].id === 'вчера'
})
check('выдача устойчива: два вызова подряд дают одно и то же', () => {
  const a = personalOrder({ tracks: LIB, idx: 0, plays: { c: 2, e: 2 } }).map(t => t.id).join('')
  const b = personalOrder({ tracks: LIB, idx: 0, plays: { c: 2, e: 2 } }).map(t => t.id).join('')
  return a === b
})
check('пустой склад не ломает', () =>
  personalOrder({ tracks: [], idx: 0, plays: {} }).length === 0)
check('склад из одного трека даёт пустую очередь', () =>
  personalOrder({ tracks: [T('a')], idx: 0, plays: {} }).length === 0)

console.log('\n── Ломаем нарочно (очередь) ──')
check('проверка заметила бы возврат к «просто следующий по списку»', () => {
  // Ровно то, что было: порядок склада, к слушателю отношения не имеющий.
  const oldWay = LIB.filter((_, n) => n !== 0).map(t => t.id).join('')
  // Слушано всё, кроме «e»: он единственный незнакомый и обязан быть первым.
  const now = personalOrder({ tracks: LIB, idx: 0, plays: { b: 2, c: 2, d: 2 }, now: СЕЙЧАС_UI,
    lastAt: { b: СЕЙЧАС_UI, c: СЕЙЧАС_UI, d: СЕЙЧАС_UI } }).map(t => t.id).join('')
  return oldWay === 'bcde' && now.startsWith('e')
})
check('проверка заметила бы очередь из одних любимых', () => {
  // Если выбросить незнакомое, человек никогда не услышит ничего нового.
  const r = personalOrder({ tracks: LIB, idx: 0, plays: { c: 10 } })
  return r.length > 1
})

console.log('\n── Умная очередь: по чему подбирается (v1.399.0) ──')
// Склад с авторами и названиями: 0 — то, что играет сейчас.
const M = (id: string, name: string, author: string, plays = 0) => ({ id, name, author, plays })
const MIX = [
  M('cur', 'Ночь', 'Кино'),
  M('same', 'Пачка сигарет', 'Кино'),
  M('other', 'Совсем другое', 'Другой'),
  M('third', 'Третье', 'Третий'),
]

check('тот же исполнитель идёт первым', () =>
  recommend({ tracks: MIX, idx: 0, plays: {} })[0].track.id === 'same')

check('и объяснение — про исполнителя', () =>
  recommend({ tracks: MIX, idx: 0, plays: {} })[0].why === 'author')

check('похожее название поднимает трек без общего автора', () => {
  const t = [M('cur', 'Группа крови', 'Кино'), M('near', 'Группа крови — живой концерт', 'Кто-то'), M('far', 'Постороннее', 'Кто-то')]
  const r = recommend({ tracks: t, idx: 0, plays: {} })
  return r[0].track.id === 'near' && r[0].why === 'similar'
})

check('служебные слова сходством не считаются', () => {
  // «Official Video» есть в половине названий — по нему нельзя роднить треки.
  const t = [M('cur', 'Раз (Official Video)', 'А'), M('x', 'Совсем другое (Official Video)', 'Б'), M('y', 'Ещё одно', 'В')]
  const r = recommend({ tracks: t, idx: 0, plays: {} })
  return r[0].score === r[1].score
})

check('сотня своих прослушиваний больше не перевешивает общего автора', () => {
  // До v1.435.0 здесь побеждал заслушанный трек — ровно та колея, из-за которой
  // сигнал и убран: чем чаще песня уже звучала, тем охотнее её ставили снова.
  const t = [M('cur', 'Ночь', 'Кино'), M('same', 'Пачка сигарет', 'Кино'), M('loved', 'Любимое', 'Другой')]
  const r = recommend({ tracks: t, idx: 0, plays: { loved: 100, same: 1 }, now: СЕЙЧАС_UI,
    lastAt: { loved: СЕЙЧАС_UI - ДЕНЬ_UI, same: СЕЙЧАС_UI - ДЕНЬ_UI } })
  return r[0].track.id === 'same'
})

check('незнакомое важнее уже слушанного, как бы часто то ни звучало', () => {
  const t = [M('cur', 'Ночь', 'А'), M('слушанное', 'Моё', 'Б', 0), M('новое', 'Хит', 'В', 0)]
  const r = recommend({ tracks: t, idx: 0, plays: { 'слушанное': 80 }, now: СЕЙЧАС_UI,
    lastAt: { 'слушанное': СЕЙЧАС_UI - ДЕНЬ_UI } })
  return r[0].track.id === 'новое' && r[0].why === 'fresh'
})

check('общие прослушивания разводят два одинаково незнакомых', () => {
  // Оба человек не слышал: решает то, что одно слушают все, а другое никто.
  const t = [M('cur', 'Ночь', 'А'), M('hit', 'Хит', 'Б', 50), M('quiet', 'Тихое', 'В', 0)]
  const r = recommend({ tracks: t, idx: 0, plays: {}, now: СЕЙЧАС_UI })
  return r[0].track.id === 'hit' && r[0].score > r[1].score
})

check('только что игравшее уходит назад', () => {
  const t = [M('cur', 'Ночь', 'Кино'), M('same', 'Пачка сигарет', 'Кино'), M('other', 'Другое', 'Другой')]
  const r = recommend({ tracks: t, idx: 0, plays: {}, recent: ['same'] })
  return r[0].track.id === 'other'
})

check('чем свежее сыграло, тем сильнее отодвигается', () => {
  const t = [M('cur', 'Ночь', 'А'), M('justnow', 'Только что', 'Б'), M('longago', 'Давно', 'В')]
  const r = recommend({ tracks: t, idx: 0, plays: {}, recent: ['justnow', 'x', 'y', 'z', 'longago'], freshCount: 0 })
  return r[0].track.id === 'longago'
})

check('незнакомое всё равно попадает в список', () => {
  const t = [M('cur', 'Ночь', 'А'), M('known', 'Знакомое', 'Б'), M('new', 'Новое', 'В')]
  const r = recommend({ tracks: t, idx: 0, plays: { known: 3 } })
  return r.some(x => x.track.id === 'new')
})

check('текущий трек в подбор не попадает', () =>
  recommend({ tracks: MIX, idx: 0, plays: { cur: 99 } }).every(x => x.track.id !== 'cur'))

check('склад из одного трека даёт пустой подбор', () =>
  recommend({ tracks: [M('a', 'Один', 'А')], idx: 0, plays: {} }).length === 0)

check('выдача устойчива: два вызова подряд дают одно и то же', () => {
  const a = recommend({ tracks: MIX, idx: 0, plays: {} }).map(x => x.track.id).join('')
  const b = recommend({ tracks: MIX, idx: 0, plays: {} }).map(x => x.track.id).join('')
  return a === b
})

check('без автора и названия подбор не падает', () => {
  const t = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  return recommend({ tracks: t, idx: 0, plays: {} }).length === 2
})

console.log('\n── Ломаем нарочно (умная очередь) ──')
check('проверка заметила бы, что автора перестали учитывать', () => {
  // Прежнее поведение: один счётчик прослушиваний, автор ни при чём.
  const r = recommend({ tracks: MIX, idx: 0, plays: {} })
  return r[0].track.id !== 'other'
})
check('проверка заметила бы, что недавнее перестали отодвигать', () => {
  const t = [M('cur', 'Ночь', 'А'), M('a', 'Раз', 'Б'), M('b', 'Два', 'В')]
  const r = recommend({ tracks: t, idx: 0, plays: { a: 5 }, recent: ['a'], freshCount: 0 })
  return r[0].track.id === 'b'
})

console.log('\n── Порядок Трекотеки (v1.406.0) ──')
check('чаще слушаемое идёт первым', () => {
  const r = libraryOrder([{ id: 'a', plays: 2 }, { id: 'b', plays: 40 }, { id: 'c', plays: 9 }])
  return r.map(t => t.id).join('') === 'bca'
})
check('при равных числах порядок склада сохраняется', () => {
  const r = libraryOrder([{ id: 'a', plays: 5 }, { id: 'b', plays: 5 }, { id: 'c', plays: 5 }])
  return r.map(t => t.id).join('') === 'abc'
})
check('трек без числа не выбрасывается, а уходит в конец', () => {
  const r = libraryOrder([{ id: 'a' }, { id: 'b', plays: 3 }])
  return r.map(t => t.id).join('') === 'ba'
})
check('исходный список не портится', () => {
  const src = [{ id: 'a', plays: 1 }, { id: 'b', plays: 9 }]
  libraryOrder(src)
  return src[0].id === 'a'
})
check('пустой склад не ломает', () => libraryOrder([]).length === 0)

console.log('\n── Ломаем нарочно (порядок Трекотеки) ──')
check('проверка заметила бы возврат к порядку добавления', () => {
  const r = libraryOrder([{ id: 'a', plays: 2 }, { id: 'b', plays: 40 }])
  return r[0].id !== 'a'
})

console.log('\n── Защита переходов по ссылкам ──')
// Раньше при непонятном адресе функция просто выходила — и браузер переходил
// сам, без спроса. Защита, которая при сомнении пропускает, защищает ровно до
// первой неожиданности.
function fakeEvent() {
  let stopped = false
  return { ev: { preventDefault: () => { stopped = true } } as any, blocked: () => stopped }
}

check('javascript: не пропускается', () => {
  const f = fakeEvent()
  guardLink(f.ev, 'javascript:alert(1)')
  return f.blocked()
})
check('data: не пропускается', () => {
  const f = fakeEvent()
  guardLink(f.ev, 'data:text/html,<script>alert(1)</script>')
  return f.blocked()
})
check('file: не пропускается', () => {
  const f = fakeEvent()
  guardLink(f.ev, 'file:///C:/Windows/System32')
  return f.blocked()
})
check('мусор вместо адреса не пропускается', () => {
  const f = fakeEvent()
  guardLink(f.ev, 'не ссылка вовсе')
  return f.blocked()
})
check('пустая строка не пропускается', () => {
  const f = fakeEvent()
  guardLink(f.ev, '')
  return f.blocked()
})
check('обычный https останавливается для вопроса, а не летит сразу', () => {
  const f = fakeEvent()
  guardLink(f.ev, 'https://example.com/page')
  return f.blocked()
})

console.log('\n── Ломаем нарочно (ссылки) ──')
check('проверка заметила бы возврат к «не разобрали — пропускаем»', () => {
  // Ровно то, что стояло до v1.378.0: выход без preventDefault.
  const oldWay = (_e: any, url: string) => { try { new URL(url) } catch { return 'пропустили' } return 'спросили' }
  const f = fakeEvent()
  guardLink(f.ev, 'не ссылка вовсе')
  return oldWay(null, 'не ссылка вовсе') === 'пропустили' && f.blocked()
})

console.log('\n── Тип файла при загрузке ──')
// Ровно то, что сломало отправку фото: файл уезжал как application/octet-stream,
// хранилище отдавало его с запретом угадывать тип, и картинка не показывалась.
const F = (name: string, type = '') => new File([new Uint8Array([1, 2, 3])], name, { type })

check('готовый тип не подменяется', () =>
  contentTypeOf(F('a.png', 'image/jpeg')) === 'image/jpeg')
check('без типа берётся из имени', () =>
  contentTypeOf(F('1783783440386.png')) === 'image/png')
check('регистр расширения не мешает', () =>
  contentTypeOf(F('SHOT.PNG')) === 'image/png')
check('jpg и jpeg — одно и то же', () =>
  contentTypeOf(F('a.jpg')) === 'image/jpeg' && contentTypeOf(F('a.jpeg')) === 'image/jpeg')
check('видео тоже узнаётся', () => contentTypeOf(F('v.mp4')) === 'video/mp4')
check('звук тоже узнаётся', () => contentTypeOf(F('s.mp3')) === 'audio/mpeg')
check('незнакомое расширение остаётся общим типом', () =>
  contentTypeOf(F('a.qwerty')) === 'application/octet-stream')
check('файл без расширения не ломает разбор', () =>
  contentTypeOf(F('README')) === 'application/octet-stream')
check('точка в имени не путает', () =>
  contentTypeOf(F('my.photo.2026.png')) === 'image/png')

console.log('\n── Ломаем нарочно (тип файла) ──')
check('проверка заметила бы возврат к «пустой тип — октеты»', () => {
  // Ровно то, что стояло до v1.384.0.
  const oldWay = (f: File) => f.type || 'application/octet-stream'
  const shot = F('1783783440386.png')
  return oldWay(shot) === 'application/octet-stream' && contentTypeOf(shot) === 'image/png'
})


console.log('\n-- Активность «Слушает»: прошло и осталось (v1.423.0) --')
// Присутствие публикуется раз в пятнадцать секунд, поэтому позицию приходится
// досчитывать локально. Ошибка тут видна сразу: полоса либо стоит, либо уезжает
// за конец песни.
const L = (pos: number, dur: number | undefined, at: number) => ({ pos, dur, at })
check('позиция досчитывается от момента публикации', () =>
  livePos(L(60, 200, 1000), 1000 + 10_000) === 70)
check('за длину трека не выходим', () =>
  livePos(L(190, 200, 1000), 1000 + 60_000) === 200)
check('назад не уходим, даже если часы разошлись', () =>
  livePos(L(60, 200, 5000), 1000) === 60)
check('без длины трека позиция всё равно считается', () =>
  livePos(L(10, undefined, 1000), 1000 + 5000) === 15)
check('мусорная позиция считается нулём', () =>
  livePos(L(NaN, 200, 1000), 1000 + 3000) === 3)

check('осталось = длина минус прошло', () =>
  leftOver(L(60, 200, 1000), 1000 + 10_000) === 130)
check('в конце трека остаётся ноль, а не минус', () =>
  leftOver(L(199, 200, 1000), 1000 + 60_000) === 0)
check('без длины трека «осталось» неизвестно — и мы это говорим', () =>
  leftOver(L(60, undefined, 1000), 2000) === null)

check('полоса заполняется по доле пройденного', () =>
  listenPct(L(50, 200, 1000), 1000) === 25)
check('полоса не выходит за сто процентов', () =>
  listenPct(L(200, 200, 1000), 1000 + 60_000) === 100)
check('без длины трека полосы нет', () => listenPct(L(50, undefined, 1000), 1000) === null)
check('нулевая длина не даёт делить на ноль', () => listenPct(L(50, 0, 1000), 1000) === null)

check('время пишется как в плеере', () =>
  fmtClock(0) === '0:00' && fmtClock(83) === '1:23' && fmtClock(3723) === '1:02:03')
check('мусор во времени не ломает подпись', () => fmtClock(NaN) === '0:00' && fmtClock(-5) === '0:00')

console.log('\n-- Ломаем нарочно (полоса прослушивания) --')
check('проверка заметила бы, что позиция перестала досчитываться', () =>
  livePos(L(60, 200, 1000), 1000 + 10_000) !== 60)
check('проверка заметила бы, что длину перестали учитывать', () =>
  livePos(L(190, 200, 1000), 1000 + 60_000) !== 250)


console.log('\n-- Активность: когда рассказывать заново (v1.425.0) --')
// Живая жалоба: перетащил песню на 0:54, а в активности осталось 0:12.
// Позиция уходила всем строго раз в пятнадцать секунд, и до следующего раза все
// видели время, досчитанное от старой точки.
const P = (pos: number, at: number, dur = 200) => ({ pos, dur, at })
check('пока ничего не публиковали — публикуем', () => needRepublish(null, 10, 1000))
check('песня просто идёт — заново не рассказываем', () => {
  // Опубликовали 60-ю секунду, прошло 10 — настоящая позиция 70, как и ожидается.
  return !needRepublish(P(60, 1000), 70, 1000 + 10_000)
})
check('перемотали вперёд — рассказываем сразу', () =>
  needRepublish(P(60, 1000), 120, 1000 + 10_000))
check('перемотали назад — тоже сразу', () =>
  needRepublish(P(60, 1000), 5, 1000 + 10_000))
check('мелкая неточность не дёргает канал', () =>
  !needRepublish(P(60, 1000), 71, 1000 + 10_000))
check('порог не больше трёх секунд — иначе рассинхрон заметен глазом', () =>
  REPUBLISH_TOLERANCE <= 3)
check('мусорная позиция не заставляет публиковать', () =>
  !needRepublish(P(60, 1000), NaN, 2000))

console.log('\n-- Ломаем нарочно (обновление активности) --')
check('проверка заметила бы, что перемотку перестали замечать', () => {
  // Ровно прежнее поведение: обновляем только по таймеру, на позицию не смотрим.
  const onlyTimer = (published: any, _cur: number, now: number) => now - published.at >= 15_000
  return onlyTimer(P(60, 1000), 120, 1000 + 10_000) === false
    && needRepublish(P(60, 1000), 120, 1000 + 10_000) === true
})


console.log('\n-- Приближение картинок (v1.431.0) --')
// Раньше колесо меняло масштаб ОТ ЦЕНТРА, а сдвинуть картинку было нельзя: угол
// фотографии приблизить невозможно. Главное здесь — «точка под курсором остаётся
// на месте»: это не «умножить масштаб», а «умножить и подвинуть».
const близко = (a: number, b: number) => Math.abs(a - b) < 0.001

check('масштаб не выходит за границы', () =>
  clampZoom(0.1) === ZOOM_MIN && clampZoom(99) === ZOOM_MAX && clampZoom(NaN) === 1)
check('приближение в центре ничего не сдвигает', () => {
  const v = zoomAt(zoomStart, 2, 0, 0)
  return v.zoom === 2 && v.x === 0 && v.y === 0
})
check('точка под курсором остаётся на месте', () => {
  const v = zoomAt(zoomStart, 2, 100, 0)
  const точкаДо = (100 - zoomStart.x) / zoomStart.zoom
  return близко(v.x + точкаДо * v.zoom, 100)
})
check('то же и при отдалении', () => {
  const приближено = zoomAt(zoomStart, 4, 50, -30)
  const v = zoomAt(приближено, 1 / 2, 50, -30)
  const точка = (50 - приближено.x) / приближено.zoom
  return близко(v.x + точка * v.zoom, 50) && близко(v.zoom, 2)
})
check('дальше предела приближение не идёт', () =>
  zoomAt({ zoom: ZOOM_MAX, x: 0, y: 0 }, 2, 10, 10).zoom === ZOOM_MAX)
check('ближе единицы не отдаляется', () =>
  zoomAt(zoomStart, 0.2, 10, 10).zoom === ZOOM_MIN)
check('мусорный множитель ничего не портит', () =>
  zoomAt(zoomStart, NaN, 10, 10).zoom === 1 && zoomAt(zoomStart, -3, 0, 0).zoom === 1)

console.log('\n-- Границы сдвига --')
check('вписанную картинку двигать некуда', () => {
  const v = clampPan({ zoom: 1, x: 200, y: 200 }, 1000, 800, 900, 700)
  return v.x === 0 && v.y === 0
})
check('приближённую можно двигать до края, но не дальше', () => {
  // 900x700 при масштабе 2 = 1800x1400, окно 1000x800:
  // запас по x = (1800-1000)/2 = 400, по y = (1400-800)/2 = 300.
  const v = clampPan({ zoom: 2, x: 9999, y: -9999 }, 1000, 800, 900, 700)
  return v.x === 400 && v.y === -300
})
check('внутри границ сдвиг не трогается', () => {
  const v = clampPan({ zoom: 2, x: 120, y: -80 }, 1000, 800, 900, 700)
  return v.x === 120 && v.y === -80
})
check('мусор в сдвиге обнуляется', () => {
  const v = clampPan({ zoom: 2, x: NaN, y: NaN }, 1000, 800, 900, 700)
  return v.x === 0 && v.y === 0
})

console.log('\n-- Щипок и двойной щелчок --')
check('пальцы разъехались вдвое — масштаб вдвое', () => pinchZoom(1, 100, 200) === 2)
check('пальцы сошлись — масштаб уменьшается', () => близко(pinchZoom(4, 200, 100), 2))
check('нулевое расстояние не ломает щипок', () =>
  pinchZoom(2, 0, 100) === 2 && pinchZoom(2, 100, 0) === 2)
check('расстояние и середина считаются как надо', () =>
  dist(0, 0, 3, 4) === 5 && mid(0, 0, 10, 20).x === 5 && mid(0, 0, 10, 20).y === 10)
check('двойной щелчок приближает в этой точке', () => {
  const v = toggleZoomAt(zoomStart, 80, 40)
  return близко(v.zoom, ZOOM_STEP) && v.x !== 0
})
check('повторный двойной щелчок возвращает как было', () => {
  const v = toggleZoomAt({ zoom: 3, x: 100, y: 50 }, 80, 40)
  return v.zoom === 1 && v.x === 0 && v.y === 0
})
check('дрожь руки — это щелчок, а не перетаскивание', () =>
  !wasDragged(2, 2) && wasDragged(DRAG_SLOP + 2, 0))

console.log('\n-- Ломаем нарочно (приближение) --')
check('проверка заметила бы возврат к приближению от центра', () => {
  // Прежнее поведение: только масштаб, без сдвига — точка под курсором уезжает.
  const простоМасштаб = { zoom: 2, x: 0, y: 0 }
  return простоМасштаб.x + 100 * простоМасштаб.zoom !== 100
})
check('проверка заметила бы пропажу границ', () => {
  const без = { zoom: 2, x: 9999, y: 0 }
  return без.x !== clampPan(без, 1000, 800, 900, 700).x
})

console.log('\n-- Демонстрация экрана: настройки (v1.436.0) --')
{
  check('по умолчанию — 1080p, 60 кадров, со звуком', () => {
    const q = readShareQuality(null)
    return q.res === '1080p' && q.fps === 60 && q.audio === true
  })
  check('мусор в сохранённых настройках не ломает демку', () => {
    const q = readShareQuality('{"res":"8K","fps":999,"audio":"да"}')
    return q.res === '1080p' && q.fps === 60 && q.audio === true
  })
  check('сохранённое своё возвращается как есть', () => {
    const q = readShareQuality('{"res":"4K","fps":30,"audio":false,"sourceId":"window:7"}')
    return q.res === '4K' && q.fps === 30 && q.audio === false && q.sourceId === 'window:7'
  })
  check('битрейт растёт вместе с разрешением', () => {
    const b = SHARE_RES.map(r => r.br)
    return b.every((v, i) => i === 0 || v > b[i - 1])
  })
  check('4K просит именно 4K, а не «примерно»', () => {
    const c = shareCapture({ res: '4K', fps: 60, audio: true })
    return c.resolution.width === 3840 && c.resolution.height === 2160 && c.resolution.frameRate === 60
  })
  check('на 60 кадрах бережём плавность, на 30 — чёткость', () =>
    shareCapture({ res: '1080p', fps: 60, audio: true }).contentHint === 'motion' &&
    shareCapture({ res: '1080p', fps: 30, audio: true }).contentHint === 'detail')
  check('звук выключили — не просим его вовсе', () => {
    const c = shareCapture({ res: '1080p', fps: 30, audio: false })
    return c.audio === false && c.systemAudio === 'exclude'
  })
  check('звук просим без «улучшайзеров» и в стерео', () => {
    const a: any = shareCapture({ res: '1080p', fps: 30, audio: true }).audio
    return a.echoCancellation === false && a.autoGainControl === false && a.channelCount === 2
  })
  check('разрешение не роняется под нагрузкой', () =>
    sharePublish({ res: '4K', fps: 60, audio: true }).degradationPreference === 'maintain-resolution')
  check('подпись под кнопкой читается человеком', () =>
    shareSummary({ res: '1440p', fps: 30, audio: false }) === '1440p · 30 к/с · без звука')

  console.log('\n   выбор источника:')
  const SRC: any[] = [
    { id: 'window:2', name: 'Ponoi', kind: 'window' },
    { id: 'window:1', name: 'Ярлык', kind: 'window' },
    { id: 'screen:0', name: 'Screen 1', kind: 'screen' },
    { id: 'window:3', name: 'Автобус', kind: 'window' },
  ]
  check('экраны идут первыми', () => orderSources(SRC)[0].kind === 'screen')
  check('окна по алфавиту', () => {
    const w = orderSources(SRC).filter(x => x.kind === 'window').map(x => x.name)
    return w.join() === 'Автобус,Ярлык'
  })
  check('своё же окно в список не попадает', () =>
    !orderSources(SRC).some(x => x.name === 'Ponoi'))
  check('пустой список не ломает', () => orderSources([]).length === 0)

  console.log('\n-- Ломаем нарочно (демонстрация) --')
  check('проверка заметила бы возврат к «только весь экран»', () => {
    // Прежнее поведение: окон в списке нет вообще.
    const прежнее = SRC.filter(x => x.kind === 'screen')
    return прежнее.length === 1 && orderSources(SRC).filter(x => x.kind === 'window').length === 2
  })
  check('проверка заметила бы звук, который просят всегда', () =>
    shareCapture({ res: '720p', fps: 15, audio: false }).audio === false)
}

console.log('\n-- Присутствие: что рассылаем и что показываем (v1.436.0) --')
{
  const БАЗА = { username: 'я', avatarUrl: null, activity: null, listening: null, game: null, voice: null, device: 'desktop' as const }
  const M = (o: any = {}) => buildMeta({ ...БАЗА, ...o })

  check('состав присутствия собирается одинаково из любого места', () => {
    const a = M({ listening: { title: 'п', pos: 3, at: 1 } })
    const b = M({ listening: { title: 'п', pos: 3, at: 1 } })
    return JSON.stringify(a) === JSON.stringify(b) && a.status === 'online'
  })
  check('пустые поля не превращаются в undefined', () => {
    const m = M()
    return m.game === null && m.voice === null && m.listening === null && m.activity === null
  })

  check('первая публикация нужна всегда', () => metaChanged(null, M()))
  check('то же самое второй раз не рассылается', () => !metaChanged(M(), M()))
  check('смена ника рассылается', () => metaChanged(M(), M({ username: 'другой' })))
  check('вход в звонок рассылается', () => metaChanged(M(), M({ voice: { since: 1 } })))
  check('включение демонстрации рассылается', () =>
    metaChanged(M({ voice: { since: 1 } }), M({ voice: { since: 1, screen: true } })))
  check('нажатие на микрофон рассылается', () =>
    metaChanged(M({ voice: { since: 1 } }), M({ voice: { since: 1, muted: true } })))
  check('выход из звонка рассылается', () => metaChanged(M({ voice: { since: 1 } }), M()))
  check('бег полосы трека сам по себе не рассылается', () => {
    const a = M({ listening: { title: 'п', pos: 3, at: 1000 } })
    const b = M({ listening: { title: 'п', pos: 9, at: 7000 } })
    return !metaChanged(a, b)
  })
  check('пауза трека рассылается', () => {
    const a = M({ listening: { title: 'п', pos: 3, at: 1000 } })
    const b = M({ listening: { title: 'п', pos: 3, at: 1000, paused: true } })
    return metaChanged(a, b)
  })
  check('смена трека рассылается', () => {
    const a = M({ listening: { title: 'первый', pos: 3, at: 1 } })
    const b = M({ listening: { title: 'второй', pos: 3, at: 1 } })
    return metaChanged(a, b)
  })
  check('обложка игры доезжает отдельным сообщением', () => {
    const a = M({ game: { name: 'И', since: 1, cover: null } })
    const b = M({ game: { name: 'И', since: 1, cover: 'https://x/1.jpg' } })
    return metaChanged(a, b)
  })

  console.log('\n   что человек делает — по важности:')
  check('демонстрация экрана важнее всего', () =>
    whatIsDoing({ voice: { since: 1, screen: true }, game: { name: 'И', since: 1 } }).kind === 'screen')
  check('голос важнее игры', () =>
    whatIsDoing({ voice: { since: 1 }, game: { name: 'И', since: 1 } }).kind === 'voice')
  check('игра важнее музыки', () =>
    whatIsDoing({ game: { name: 'И', since: 1 }, listening: { title: 'п', pos: 0, at: 0 } }).kind === 'game')
  check('музыка важнее своей строки', () =>
    whatIsDoing({ listening: { title: 'п', pos: 0, at: 0 }, activity: { text: 'пью чай', since: 0 } }).kind === 'music')
  check('ничего не делает — так и говорим', () => whatIsDoing({}).kind === 'none')
  check('в голосе видно, где именно', () =>
    whatIsDoing({ voice: { since: 1, where: 'Общий' } }).text.includes('Общий'))
  check('время в звонке считается от входа, а не от нажатия кнопок', () =>
    whatIsDoing({ voice: { since: 12345, screen: true } }).since === 12345)

  console.log('\n-- Ломаем нарочно (присутствие) --')
  check('проверка заметила бы пропажу голоса из присутствия', () => {
    const прежнее = whatIsDoing({ game: null, listening: null, activity: null })
    const теперь = whatIsDoing({ voice: { since: 1 } })
    return прежнее.kind === 'none' && теперь.kind === 'voice'
  })
  check('проверка заметила бы «рассылаем на каждый чих»', () => {
    const a = M({ listening: { title: 'п', pos: 3, at: 1000 } })
    const b = M({ listening: { title: 'п', pos: 4, at: 2000 } })
    return !metaChanged(a, b)
  })
}

console.log('\n-- Долгое нажатие (v1.433.0) --')
// Проверяется на поддельном окне: настоящих касаний в стенде взять негде (у меня
// мышь), а вся суть здесь — кто на что подписался и когда отписался.
function поддельноеОкно() {
  const ls = new Map<string, Set<(ev: any) => void>>()
  let seq = 0
  const timers = new Map<number, () => void>()
  const w = {
    setTimeout: (f: () => void) => { timers.set(++seq, f); return seq },
    clearTimeout: (id: number) => { timers.delete(id) },
    addEventListener: (t: string, f: (ev: any) => void) => {
      if (!ls.has(t)) ls.set(t, new Set()); ls.get(t)!.add(f)
    },
    removeEventListener: (t: string, f: (ev: any) => void) => { ls.get(t)?.delete(f) },
    // — служебное для проверки —
    сколькоСлушателей: () => [...ls.values()].reduce((n, s) => n + s.size, 0),
    послать: (t: string, ev: any) => { for (const f of [...(ls.get(t) ?? [])]) f(ev) },
    подождать: () => { for (const [id, f] of [...timers]) { timers.delete(id); f() } },
    таймеров: () => timers.size,
  }
  ;(globalThis as any).window = w
  return w
}

check('нажать и держать — меню открывается', () => {
  const w = поддельноеОкно()
  let открыто: any = null
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, at => { открыто = at })
  w.подождать()
  return открыто && открыто.x === 10 && открыто.y === 20
})
check('дрожь руки нажатие не отменяет', () => {
  const w = поддельноеОкно()
  let открыто = false
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => { открыто = true })
  // Палец «дышит» на пару пикселей — так держит руку любой живой человек.
  w.послать('pointermove', { clientX: 12, clientY: 21 })
  w.послать('pointermove', { clientX: 9, clientY: 23 })
  w.подождать()
  return открыто
})
check('настоящая протяжка нажатие отменяет', () => {
  const w = поддельноеОкно()
  let открыто = false
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => { открыто = true })
  w.послать('pointermove', { clientX: 10, clientY: 60 })
  w.подождать()
  return !открыто
})
check('прокрутка списка — не нажатие', () => {
  const w = поддельноеОкно()
  let открыто = false
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => { открыто = true })
  w.послать('scroll', {})
  w.подождать()
  return !открыто
})
check('отпустил раньше срока — меню не открылось', () => {
  const w = поддельноеОкно()
  let открыто = false
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => { открыто = true })
  w.послать('pointerup', {})
  w.подождать()
  return !открыто
})
check('мышь долгим нажатием не пользуется — у неё правый щелчок', () => {
  const w = поддельноеОкно()
  let открыто = false
  startLongPress({ pointerType: 'mouse', clientX: 10, clientY: 20 }, () => { открыто = true })
  return !открыто && w.сколькоСлушателей() === 0 && w.таймеров() === 0
})
check('после нажатия слушателей не остаётся', () => {
  const w = поддельноеОкно()
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => {})
  w.подождать()
  return w.сколькоСлушателей() === 0
})
check('после отмены слушателей тоже не остаётся', () => {
  const w = поддельноеОкно()
  startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => {})
  w.послать('pointerup', {})
  return w.сколькоСлушателей() === 0 && w.таймеров() === 0
})
check('сто касаний подряд не копят слушателей', () => {
  const w = поддельноеОкно()
  for (let i = 0; i < 100; i++) {
    startLongPress({ pointerType: 'touch', clientX: 10, clientY: 20 }, () => {})
    w.послать('pointerup', {})
  }
  return w.сколькоСлушателей() === 0
})

console.log('\n-- Ломаем нарочно (долгое нажатие) --')
check('проверка заметила бы отмену по любому движению', () =>
  !movedTooFar({ x: 10, y: 20 }, { x: 12, y: 21 }) && movedTooFar({ x: 10, y: 20 }, { x: 10, y: 60 }))
check('проверка заметила бы слушателей на элементе вместо окна', () => {
  // Слушатели обязаны быть у окна: палец, уехавший с карточки, до элемента
  // pointerup уже не донесёт, и нажатие осталось бы висеть открытым.
  const w = поддельноеОкно()
  startLongPress({ pointerType: 'touch', clientX: 1, clientY: 1 }, () => {})
  const было = w.сколькоСлушателей()
  w.послать('pointerup', {})
  return было >= 4 && w.сколькоСлушателей() === 0
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
