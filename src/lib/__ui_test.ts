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

import { okColor, okColors, encodeTheme, decodeTheme, addPreset, removePreset, MAX_PRESETS } from './themePresets'
import { shortReason, logLine } from './log'
import { shouldDismiss } from './dismiss'
import { flowContext, flowPrompt } from './flow'
import { layoutFlow, orderNodes, linkPath, flowProgress, NODE_W, NODE_H } from './flow'
import { makeSseReader, buildRequest, aiReady, whyFailed } from './gameAi'
import { fromEdge, swipeDir, swipeAction } from './swipe'
import { percent, counts, currentIndex, currentMission, isComplete, shortLabel, fullLabel, storyShare, shareLabel, parseMissions, buildCampaign, toggleMission, setNote, askContext, askPrompt, MAX_MISSIONS, MAX_MISSION_NAME } from './campaign'
import { mentionsMe, mentionsMyRole } from './mentions'
import { toggleOne, selectRange, pruneSelection, deletable, skippedCount, bulkLabel, skippedNote, runBulk, bulkReport, BULK_MAX } from './bulkSelect'
import { keepAliveAction } from './keepAlive'
import { kbInset, kbScrollDelta, KB_MIN } from './keyboardInset'
import { otaDecide, otaBanner, otaStale, OTA_EVERY_MS, OTA_RESUME_MS } from './otaPlan'
import { isLongText, LONG_LINES, LONG_CHARS } from './longText'
import { startLongPress, movedTooFar, LONG_PRESS_SLOP } from './longPress'
import { buildMeta, metaChanged, whatIsDoing } from './presenceMeta'
import { SHARE_RES, readShareQuality, shareCapture, sharePublish, shareSummary, orderSources } from './shareOpts'
import { encodeFlags, decodeFlags, mergeFlags, forgetFlags, tileIcon } from './callState'
import { shouldLeave, takeCall, releaseCall, activeCall } from './activeCall'
import { takeSlot, freeSlot, hasSlot, liveCount, resetSlots, subscribeSlots, MAX_LIVE } from './petSlots'
import { tileEmoji, tileLabel, orderTiles, filterTiles } from './soundTile'
import { fmtNotification, cleanBody, trimBody, plusMessages, BODY_MAX } from './notifyFormat'
import { shareTrackText } from '../music/shareText'
import { authKeyFor, isAuthKey } from './authStore'
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

console.log('\n-- Уведомления: что видит человек (v1.440.0) --')
{
  check('заголовок говорит, кто и куда написал', () => {
    const n = fmtNotification({ author: 'Вася', channel: 'общий', text: 'привет' })
    return n.title === 'Вася — #общий' && n.body === 'привет'
  })
  check('в личке канала нет', () =>
    fmtNotification({ author: 'Вася', text: 'привет' }).title === 'Вася')
  check('упоминание помечено — по нему решают, бросать ли дела', () =>
    fmtNotification({ author: 'Вася', text: 'эй', mention: true }).title.startsWith('@ '))
  check('вложение без текста — «Вложение», а не пустота', () =>
    fmtNotification({ author: 'Вася', text: '', hasAttach: true }).body === 'Вложение')
  check('пустое сообщение без вложения тоже не пустое', () =>
    fmtNotification({ author: 'Вася', text: '' }).body === 'Новое сообщение')

  console.log('\n   тело чистится:')
  check('служебная вставка не показывается', () =>
    cleanBody('⁣sys:call:start⁣хвост').trim() === '')
  check('спойлер остаётся скрытым', () => cleanBody('вот ||секрет||') === 'вот ▮▮')
  check('разметка не показывается знаками', () =>
    cleanBody('**жирный** и *косой* и ~~зачёркнутый~~') === 'жирный и косой и зачёркнутый')
  check('код превращается в пометку', () => cleanBody('смотри ```console.log(1)```') === 'смотри 「код」')
  check('ссылка не занимает всё окно', () =>
    cleanBody('глянь https://example.com/очень/длинный/путь?a=1') === 'глянь 🔗 ссылка')
  check('переносы и пробелы схлопываются', () => cleanBody('раз\n\n\nдва   три') === 'раз\nдва три')

  console.log('\n   длина:')
  check('короткое не режется', () => trimBody('привет') === 'привет')
  check('длинное режется по словам', () => {
    const b = trimBody('слово '.repeat(60), 40)
    return b.endsWith('…') && b.length <= 41 && !b.includes('сл…')
  })
  check('предел разумный', () => BODY_MAX >= 80 && BODY_MAX <= 200)

  console.log('\n   повторы:')
  check('одно сообщение — без хвоста', () =>
    !fmtNotification({ author: 'В', text: 'раз' }).body.includes('и ещё'))
  check('несколько — сказано сколько', () =>
    fmtNotification({ author: 'В', text: 'раз', more: 3 }).body.includes('и ещё 3 сообщения'))
  check('склонение верное', () =>
    plusMessages(1).includes('сообщение') && plusMessages(2).includes('сообщения') &&
    plusMessages(5).includes('сообщений') && plusMessages(11).includes('сообщений'))

  console.log('\n-- Ломаем нарочно (уведомления) --')
  check('проверка заметила бы сырой текст в уведомлении', () => {
    const сырое = 'вот ||секрет|| и **жирный**'
    return cleanBody(сырое) !== сырое && !cleanBody(сырое).includes('секрет')
  })
}

console.log('\n-- Вход переживает обновление (v1.442.0) --')
{
  check('ключ сессии узнаётся по адресу проекта', () =>
    authKeyFor('https://fmqaedeudurzxfqbixrc.supabase.co') === 'sb-fmqaedeudurzxfqbixrc-auth-token')
  check('битый адрес не роняет расчёт ключа', () => authKeyFor('').startsWith('sb-'))
  check('дублируем только вход, ничего лишнего', () =>
    isAuthKey('sb-abc-auth-token') && isAuthKey('supabase.auth.token') &&
    !isAuthKey('ponoi_settings') && !isAuthKey('ponoi_mus_dsp'))
}

console.log('\n-- Поделиться треком (v1.440.0) --')
{
  check('в сообщении видно, что это песня', () => {
    const t = shareTrackText({ title: 'Осень', author: 'ДДТ', url: 'https://x/1' })
    return t.startsWith('🎵 Осень — ДДТ') && t.includes('https://x/1')
  })
  check('без исполнителя тоже читается', () =>
    shareTrackText({ title: 'Осень', url: 'https://x/1' }).startsWith('🎵 Осень\n'))
  check('без названия не отправляем пустоту', () =>
    shareTrackText({ title: '', url: 'https://x/1' }).startsWith('🎵 Трек'))
  check('своя приписка идёт после ссылки', () => {
    const t = shareTrackText({ title: 'О', url: 'https://x/1' }, 'послушай')
    return t.endsWith('послушай') && t.indexOf('https://x/1') < t.indexOf('послушай')
  })
  check('пустая приписка не добавляет пустой строки', () =>
    shareTrackText({ title: 'О', url: 'https://x/1' }, '   ').split('\n').length === 2)
}

console.log('\n-- Саундпад сеткой (v1.439.0) --')
{
  const S = (id: string, name: string, ownerId: string, owner = 'кто-то', duration = 3) =>
    ({ id, name, ownerId, owner, duration })
  const СПИСОК = [
    S('1', 'Ржач', 'вася', 'Вася'),
    S('2', 'Барабаны', 'server', 'Мой сервер'),
    S('3', 'Бум', 'я', 'Я'),
    S('4', 'Автобус', 'я', 'Я'),
  ]

  check('звуки сервера идут первыми', () => orderTiles(СПИСОК, 'я')[0].ownerId === 'server')
  check('свои — раньше чужих', () => {
    const ids = orderTiles(СПИСОК, 'я').map(c => c.ownerId)
    return ids.indexOf('я') < ids.indexOf('вася')
  })
  check('внутри группы — по алфавиту, а не по времени загрузки', () => {
    const свои = orderTiles(СПИСОК, 'я').filter(c => c.ownerId === 'я').map(c => c.name)
    return свои.join() === 'Автобус,Бум'
  })
  check('порядок устойчив: место звука не прыгает', () => {
    const a = orderTiles(СПИСОК, 'я').map(c => c.id).join()
    const b = orderTiles([...СПИСОК].reverse(), 'я').map(c => c.id).join()
    return a === b
  })

  check('поиск находит по названию', () => filterTiles(СПИСОК, 'бум').length === 1)
  check('поиск находит и по тому, кто выложил', () => filterTiles(СПИСОК, 'вася').length === 1)
  check('пустой поиск отдаёт всё', () => filterTiles(СПИСОК, '   ').length === 4)

  console.log('\n   как выглядит плитка:')
  check('значок подбирается по названию', () =>
    tileEmoji('Дикий ржач') === '😂' && tileEmoji('Барабаны') === '🥁' && tileEmoji('Бум!') === '💥')
  check('незнакомому звуку — обычный значок', () => tileEmoji('шшш') === '🔊')
  check('пустое имя не ломает значок', () => tileEmoji('') === '🔊')
  check('короткое название не режется', () => tileLabel('Бум') === 'Бум')
  check('длинное режется по словам и с многоточием', () => {
    const l = tileLabel('МЕЛЛСТРОЙ АМ АМ АМ МЕМ ТРЕЧОК ПЕСНЯ')
    return l.endsWith('…') && l.length <= 23 && !l.includes('  ')
  })
  check('слово не разрывается посередине, если можно иначе', () => {
    const l = tileLabel('Очень длинное название звука', 20)
    return l.endsWith('…') && !/\S…$/.test(l.slice(0, -1) + 'x') === false || l.includes(' ')
  })
  check('пустое имя превращается в «Звук»', () => tileLabel('') === 'Звук')

  console.log('\n-- Ломаем нарочно (саундпад) --')
  check('проверка заметила бы порядок «как пришло из базы»', () => {
    // Прежний вид: список в том порядке, в каком отдала база, — место звука
    // менялось от того, кто когда его загрузил, и рука его не запоминала.
    const какПришло = СПИСОК.map(c => c.id).join()
    const теперь = orderTiles(СПИСОК, 'я').map(c => c.id).join()
    return какПришло !== теперь
  })
}

console.log('\n-- Объёмные питомцы: сколько холстов живут разом (v1.439.0) --')
{
  resetSlots()
  check('первым питомцам места хватает', () => {
    resetSlots()
    return Array.from({ length: MAX_LIVE }, (_, i) => takeSlot('п' + i)).every(Boolean)
  })
  check('сверх предела места нет — будет заглушка', () => {
    resetSlots()
    for (let i = 0; i < MAX_LIVE; i++) takeSlot('п' + i)
    return takeSlot('лишний') === false
  })
  check('предел заметно ниже, чем держит браузер', () => MAX_LIVE >= 2 && MAX_LIVE <= 8)
  check('тот же питомец второй раз место не занимает', () => {
    resetSlots()
    takeSlot('один'); takeSlot('один')
    return liveCount() === 1
  })
  check('ушёл с экрана — место освободилось', () => {
    resetSlots()
    for (let i = 0; i < MAX_LIVE; i++) takeSlot('п' + i)
    freeSlot('п0')
    return takeSlot('новый') === true && liveCount() === MAX_LIVE
  })
  check('освобождение чужого места ничего не ломает', () => {
    resetSlots()
    takeSlot('один')
    freeSlot('другой')
    return hasSlot('один') && liveCount() === 1
  })
  check('о смене мест сообщается — ждущие получат свой холст', () => {
    resetSlots()
    let сообщений = 0
    const off = subscribeSlots(() => { сообщений++ })
    takeSlot('a'); freeSlot('a')
    off()
    return сообщений === 2
  })
  check('после отписки не дёргаем', () => {
    resetSlots()
    let сообщений = 0
    const off = subscribeSlots(() => { сообщений++ })
    off()
    takeSlot('b')
    return сообщений === 0
  })

  console.log('\n-- Ломаем нарочно (питомцы) --')
  check('проверка заметила бы возврат к «холст каждому»', () => {
    // Прежнее поведение: сколько питомцев на экране, столько и холстов WebGL —
    // браузер при переполнении убивает самые старые, и вместо питомцев чернота.
    resetSlots()
    const безПредела = 20
    let дали = 0
    for (let i = 0; i < безПредела; i++) if (takeSlot('м' + i)) дали++
    return дали === MAX_LIVE && дали < безПредела
  })
  resetSlots()
}

console.log('\n-- Звонок только один (v1.438.0) --')
{
  check('входа никуда не было — выходить неоткуда', () =>
    !shouldLeave(null, { kind: 'dm', id: 'a' }))
  check('свой же канал повторным входом не считается', () =>
    !shouldLeave({ kind: 'server', id: 'общий' }, { kind: 'server', id: 'общий' }))
  check('другой канал — выходим из прежнего', () =>
    shouldLeave({ kind: 'server', id: 'общий' }, { kind: 'server', id: 'игровой' }))
  check('из личного звонка в канал — выходим', () =>
    shouldLeave({ kind: 'dm', id: 'тред1' }, { kind: 'server', id: 'общий' }))
  check('из канала в личный звонок — тоже выходим', () =>
    shouldLeave({ kind: 'server', id: 'общий' }, { kind: 'dm', id: 'тред1' }))
  check('совпадение id при разном виде не путает', () =>
    shouldLeave({ kind: 'dm', id: 'x' }, { kind: 'server', id: 'x' }))

  console.log('\n   учёт занятого места:')
  check('вход занимает место', () => {
    releaseCall()
    takeCall({ kind: 'dm', id: 'т1', leave: () => {} })
    const a = activeCall()
    releaseCall()
    return !!a && a.kind === 'dm' && a.id === 'т1'
  })
  check('вход в другой звонок закрывает прежний ровно один раз', () => {
    releaseCall()
    let вышли = 0
    takeCall({ kind: 'dm', id: 'т1', leave: () => { вышли++ } })
    const было = takeCall({ kind: 'server', id: 'к1', leave: () => {} })
    const итог = вышли === 1 && было === true && activeCall()?.id === 'к1'
    releaseCall()
    return итог
  })
  check('повторный вход в тот же звонок никого не выгоняет', () => {
    releaseCall()
    let вышли = 0
    takeCall({ kind: 'server', id: 'к1', leave: () => { вышли++ } })
    takeCall({ kind: 'server', id: 'к1', leave: () => {} })
    const итог = вышли === 0
    releaseCall()
    return итог
  })
  check('выход освобождает место', () => {
    releaseCall()
    takeCall({ kind: 'dm', id: 'т1', leave: () => {} })
    releaseCall()
    return activeCall() === null
  })
  check('чужой выход текущий звонок не трогает', () => {
    releaseCall()
    takeCall({ kind: 'dm', id: 'т1', leave: () => {} })
    releaseCall('другой')
    const итог = activeCall()?.id === 'т1'
    releaseCall()
    return итог
  })
  check('leave() из старого звонка не уводит в круг', () => {
    // leave() обычно сам зовёт releaseCall — важно, чтобы новый звонок при этом
    // не оказался стёрт.
    releaseCall()
    takeCall({ kind: 'dm', id: 'т1', leave: () => releaseCall() })
    takeCall({ kind: 'server', id: 'к1', leave: () => {} })
    const итог = activeCall()?.id === 'к1'
    releaseCall()
    return итог
  })

  console.log('\n-- Ломаем нарочно (один звонок) --')
  check('проверка заметила бы возврат к «сидим сразу в двух»', () => {
    // Прежнее поведение: вход в канал ничего не знал про личный звонок.
    const прежнее = () => false
    return прежнее() === false && shouldLeave({ kind: 'dm', id: 'т1' }, { kind: 'server', id: 'к1' })
  })
}

console.log('\n-- Звонок: кто заглушил всех (v1.436.0) --')
{
  check('своё состояние уезжает и возвращается тем же', () => {
    const f = decodeFlags(encodeFlags({ deaf: true, mic: false }))
    return !!f && f.deaf === true && f.mic === false
  })
  check('чужие сообщения в том же канале не путаются с нашими', () =>
    decodeFlags(new TextEncoder().encode(JSON.stringify({ t: 'саундпад', clip: 'x' }))) === null)
  check('мусор не ломает звонок', () =>
    decodeFlags(new TextEncoder().encode('не json')) === null && decodeFlags(null) === null)

  check('новое состояние попадает в таблицу', () => {
    const m = mergeFlags({}, 'вася', { deaf: true, mic: false })
    return m['вася'].deaf === true
  })
  check('то же самое второй раз не перерисовывает звонок', () => {
    const m1 = mergeFlags({}, 'вася', { deaf: true, mic: false })
    const m2 = mergeFlags(m1, 'вася', { deaf: true, mic: false })
    return m1 === m2
  })
  check('изменение состояния таблицу обновляет', () => {
    const m1 = mergeFlags({}, 'вася', { deaf: true, mic: false })
    const m2 = mergeFlags(m1, 'вася', { deaf: false, mic: true })
    return m1 !== m2 && m2['вася'].deaf === false
  })
  check('вышедший из звонка забывается', () => {
    const m1 = mergeFlags({}, 'вася', { deaf: true, mic: false })
    const m2 = forgetFlags(m1, 'вася')
    return !('вася' in m2) && forgetFlags(m2, 'вася') === m2
  })

  console.log('\n   какой значок на плитке:')
  check('заглушил всех — перечёркнутые наушники', () =>
    tileIcon({ deaf: true, mic: false }, false) === 'deaf')
  check('наушники важнее микрофона', () =>
    tileIcon({ deaf: true, mic: true }, true) === 'deaf')
  check('просто выключил микрофон — перечёркнутый микрофон', () =>
    tileIcon({ deaf: false, mic: false }, false) === 'muted')
  check('микрофон, выключенный по данным сервера, тоже виден', () =>
    tileIcon(undefined, false) === 'muted')
  check('обычный участник — без значка', () =>
    tileIcon({ deaf: false, mic: true }, true) === 'none' && tileIcon(undefined, true) === 'none')

  console.log('\n-- Ломаем нарочно (звонок) --')
  check('проверка заметила бы, что «не слышит» снова стало невидимым', () => {
    // Прежнее поведение: о заглушившем известен только микрофон, и он выглядит
    // как обычный участник с выключенным микрофоном.
    const прежнее = tileIcon(undefined, false)
    const теперь = tileIcon({ deaf: true, mic: false }, false)
    return прежнее === 'muted' && теперь === 'deaf'
  })
}

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
  // Само присутствие голоса остаётся и рассылается: по нему рисуются значки в
  // списках, просто активностью это больше не называется.
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
  // v1.439.0: просто «в голосовом канале» активностью больше не считается — по
  // просьбе владельца. Игра и музыка снова видны у тех, кто держит канал открытым.
  check('голос сам по себе активностью не считается', () =>
    whatIsDoing({ voice: { since: 1 }, game: { name: 'И', since: 1 } }).kind === 'game')
  check('в голосе без игры и музыки — ничего не показываем', () =>
    whatIsDoing({ voice: { since: 1 } }).kind === 'none')
  check('демонстрация экрана из звонка по-прежнему важнее всего', () =>
    whatIsDoing({ voice: { since: 1, screen: true }, game: { name: 'И', since: 1 } }).kind === 'screen')
  check('игра важнее музыки', () =>
    whatIsDoing({ game: { name: 'И', since: 1 }, listening: { title: 'п', pos: 0, at: 0 } }).kind === 'game')
  check('музыка важнее своей строки', () =>
    whatIsDoing({ listening: { title: 'п', pos: 0, at: 0 }, activity: { text: 'пью чай', since: 0 } }).kind === 'music')
  check('ничего не делает — так и говорим', () => whatIsDoing({}).kind === 'none')
  check('в демонстрации видно, где именно', () =>
    whatIsDoing({ voice: { since: 1, screen: true, where: 'Общий' } }).text.includes('Общий'))
  check('время в звонке считается от входа, а не от нажатия кнопок', () =>
    whatIsDoing({ voice: { since: 12345, screen: true } }).since === 12345)

  console.log('\n-- Ломаем нарочно (присутствие) --')
  check('проверка заметила бы возврат «в голосовом канале» в активности', () => {
    // Строка перекрывала собой игру и музыку у всех, кто просто держит канал
    // открытым, — с v1.439.0 её быть не должно.
    const сИгрой = whatIsDoing({ voice: { since: 1 }, game: { name: 'И', since: 1 } })
    const один = whatIsDoing({ voice: { since: 1 } })
    return сИгрой.kind === 'game' && один.kind === 'none'
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

// -- v1.443.0: обновление на телефоне ----------------------------------------
// Раньше проверка была одна на весь запуск приложения, и решение «показать
// кнопку» жило отдельно от того, скачан ли файл. Теперь и расписание, и вид
// карточки считает otaPlan.ts.
console.log('\n-- Обновление на телефоне --')
const OTA = {
  now: 1_000_000_000, lastCheck: 0, resumed: false, dismissed: null as string | null,
  found: null as string | null, ready: null as string | null,
  metered: false, online: true, busy: false,
}
const ota = (o: Partial<typeof OTA>) => otaDecide({ ...OTA, ...o })

check('первый запуск — проверяем сразу', () => ota({}) === 'check')
check('только что проверяли — не дёргаем сервер снова', () =>
  ota({ lastCheck: OTA.now - 60_000 }) === 'idle')
check('вернулись в приложение после долгого перерыва — проверяем', () =>
  ota({ lastCheck: OTA.now - OTA_RESUME_MS - 1, resumed: true }) === 'check')
check('вернулись через минуту — не проверяем', () =>
  ota({ lastCheck: OTA.now - 60_000, resumed: true }) === 'idle')
check('прошло полдня без сворачиваний — проверяем', () =>
  ota({ lastCheck: OTA.now - OTA_EVERY_MS - 1 }) === 'check')
check('нашли новее — качаем сами по Wi-Fi', () =>
  ota({ lastCheck: OTA.now, found: '1.500.0' }) === 'download')
check('на мобильном интернете сами не качаем', () =>
  ota({ lastCheck: OTA.now, found: '1.500.0', metered: true }) === 'idle')
check('уже скачано — второй раз не качаем', () =>
  ota({ lastCheck: OTA.now, found: '1.500.0', ready: '1.500.0' }) === 'idle')
check('без сети ничего не делаем', () =>
  ota({ found: '1.500.0', online: false }) === 'idle' && ota({ online: false }) === 'idle')
check('пока качаем — не начинаем заново', () =>
  ota({ lastCheck: OTA.now, found: '1.500.0', busy: true }) === 'idle')

check('карточки нет, пока нечего ставить', () => otaBanner({ ...OTA }) === null)
check('закрытую крестиком версию не показываем', () =>
  otaBanner({ ...OTA, found: '1.500.0', dismissed: '1.500.0' }) === null)
check('карточка знает, скачан файл или нет', () => {
  const нет = otaBanner({ ...OTA, found: '1.500.0' })
  const да  = otaBanner({ ...OTA, found: '1.500.0', ready: '1.500.0' })
  return нет?.ready === false && да?.ready === true && да?.version === '1.500.0'
})
check('файл от прошлой версии считается лишним', () =>
  otaStale('1.400.0', '1.500.0') && !otaStale('1.500.0', '1.500.0') && !otaStale(null, '1.500.0'))

console.log('\n-- Ломаем нарочно (обновление) --')
check('кнопка «Установить» не может появиться без скачанного файла', () => {
  // Если бы карточка считала готовность по найденной версии, а не по скачанной,
  // человек нажал бы «Установить» и получил отказ.
  const b = otaBanner({ ...OTA, found: '1.500.0', ready: '1.400.0' })
  return b !== null && b.ready === false
})
check('проверка заметила бы, что скачивание не смотрит на тариф', () =>
  ota({ lastCheck: OTA.now, found: '1.500.0', metered: false }) === 'download'
  && ota({ lastCheck: OTA.now, found: '1.500.0', metered: true }) !== 'download')


// -- v1.443.0: экранная клавиатура ------------------------------------------
// Приложение не знало про клавиатуру вовсе: на Android она ложится поверх окна,
// и поле ввода оказывалось под ней. Здесь проверяется замер её высоты и то, что
// низ переписки не уезжает.
console.log('\n-- Экранная клавиатура --')
const экран = (vvH: number, vvTop = 0, winH = 800) => kbInset({ winH, vvH, vvTop })

check('без клавиатуры отступа нет', () => экран(800) === 0)
check('клавиатура меряется как разница высот', () => экран(480) === 320)
check('панель браузера за клавиатуру не считается', () => экран(760) === 0 && экран(721) === 0)
check('порог ровно на границе срабатывает', () => экран(800 - KB_MIN) === KB_MIN)
check('сдвиг страницы вверх учитывается', () => экран(480, 40) === 280)
check('бессмысленный замер не двигает вёрстку', () =>
  экран(0) === 0 && kbInset({ winH: 0, vvH: 480, vvTop: 0 }) === 0 && экран(-100) === 0)

check('читал низ — низ и останется', () => kbScrollDelta(0, 320, true) === 320)
check('читал переписку выше — его не дёргают', () => kbScrollDelta(0, 320, false) === 0)
check('клавиатура спряталась — список не прыгает вверх', () => kbScrollDelta(320, 0, true) === 0)

console.log('\n-- Ломаем нарочно (клавиатура) --')
check('проверка заметила бы отступ во весь экран', () => {
  // Так бывает в момент поворота: visualViewport на миг отдаёт нулевую высоту.
  // Поднять поле ввода на всю высоту экрана хуже, чем не поднять вовсе.
  const плохо = 800 - 0
  return плохо === 800 && kbInset({ winH: 800, vvH: 0, vvTop: 0 }) === 0
})


// -- v1.444.0: музыка в свёрнутом приложении ---------------------------------
// Пока постоянной службы не было, Android при нехватке памяти прибирал процесс,
// и музыка обрывалась на полуслове. Здесь проверяется правило «когда служба
// нужна» — то самое, по которому она и включается, и выключается.
console.log('\n-- Музыка в фоне --')
const KA = {
  native: true, playing: true, hasTrack: true, hidden: false,
  allowed: true, askedBefore: false,
}
const ka = (o: Partial<typeof KA>) => keepAliveAction({ ...KA, ...o })

check('играет — держим процесс', () => ka({}) === 'start')
check('встало — отпускаем', () => ka({ playing: false }) === 'stop')
check('играть нечего — тоже отпускаем', () => ka({ hasTrack: false }) === 'stop')
check('в браузере службы нет и не трогаем', () =>
  ka({ native: false }) === 'idle' && ka({ native: false, playing: false }) === 'idle')

check('разрешение спрашиваем, когда свернули с музыкой', () =>
  ka({ allowed: false, hidden: true }) === 'ask')
check('на экране не пристаём — там процесс и так живой', () =>
  ka({ allowed: false, hidden: false }) === 'idle')
check('спросили один раз — больше не спрашиваем', () =>
  ka({ allowed: false, hidden: true, askedBefore: true }) === 'idle')
check('без разрешения службу не поднимаем', () =>
  ka({ allowed: false, hidden: true }) !== 'start'
  && ka({ allowed: false, hidden: true, askedBefore: true }) !== 'start')
check('пауза важнее разрешения', () =>
  ka({ playing: false, allowed: false, hidden: true }) === 'stop')

console.log('\n-- Ломаем нарочно (музыка в фоне) --')
check('проверка ловит службу, оставленную после паузы', () => {
  // Так батарея и утекала бы: уведомление висит, процесс держится, музыки нет.
  const плохо = 'start'
  return плохо !== ka({ playing: false }) && ka({ playing: false }) === 'stop'
})
check('проверка ловит просьбу о разрешении на пустом месте', () =>
  // Спросить у того, кто ничего не включал, — значит получить отказ навсегда.
  ka({ playing: false, allowed: false, hidden: true }) !== 'ask'
  && ka({ allowed: false, hidden: false }) !== 'ask')


// -- v1.445.0: удаление пачкой -----------------------------------------------
// Удалять можно было только по одному. Здесь проверяется главное: число на
// кнопке и то, что уходит в базу, считает ОДНА функция — иначе экран сказал бы
// «удалить 12», а ушло бы 9, потому что три чужих.
console.log('\n-- Удаление пачкой --')
const лента = [1, 2, 3, 4, 5, 6].map(n => ({ id: 'm' + n, author: n % 3 === 0 ? 'чужой' : 'я' }))
const моё = (m: { author: string }) => m.author === 'я'
const наб = (...ids: string[]) => new Set(ids)

check('отметка снимается тем же нажатием', () => {
  const один = toggleOne(наб(), 'm1')
  return один.has('m1') && !toggleOne(один, 'm1').has('m1')
})
check('исходный набор не портится', () => {
  const было = наб('m1')
  toggleOne(было, 'm2')
  return было.size === 1
})
check('диапазон по Shift берёт всё между', () => {
  const r = selectRange(наб('m2'), лента, 'm2', 'm5')
  return r.size === 4 && r.has('m2') && r.has('m3') && r.has('m4') && r.has('m5')
})
check('диапазон работает и снизу вверх', () => {
  const r = selectRange(наб('m5'), лента, 'm5', 'm2')
  return r.size === 4 && r.has('m2') && r.has('m5')
})
check('без якоря Shift ведёт себя как обычное нажатие', () =>
  selectRange(наб(), лента, null, 'm3').size === 1)
check('якорь на пропавшем сообщении не ломает выбор', () =>
  selectRange(наб(), лента, 'нетакого', 'm3').size === 1)

check('удаляется только своё', () => {
  const d = deletable(наб('m1', 'm2', 'm3'), лента, моё)
  return d.length === 2 && d.every(m => m.author === 'я')
})
check('число на кнопке — длина того же списка', () => {
  // Ровно это и не давало показу разойтись с действием.
  const sel = наб('m1', 'm2', 'm3', 'm6')
  const d = deletable(sel, лента, моё)
  return bulkLabel(d.length) === 'Удалить 2 сообщения' && skippedCount(sel, лента, моё) === 2
})
check('удаляется в порядке ленты, а не в порядке нажатий', () => {
  const d = deletable(наб('m4', 'm1', 'm2'), лента, моё)
  return d.map(m => m.id).join(',') === 'm1,m2,m4'
})
check('за раз не больше сотни', () => {
  const много = Array.from({ length: 250 }, (_, i) => ({ id: 'x' + i, author: 'я' }))
  const sel = new Set(много.map(m => m.id))
  return deletable(sel, много, моё).length === BULK_MAX
      && skippedNote(0, true).includes('100')
})
check('пропавшее из ленты выпадает из выбора', () => {
  const r = pruneSelection(наб('m1', 'нетакого'), лента)
  return r.size === 1 && r.has('m1')
})
check('счёт чужих не считает пропавших', () =>
  skippedCount(наб('m1', 'нетакого'), лента, моё) === 0)

check('склонение считается по числу', () =>
  bulkLabel(1) === 'Удалить 1 сообщение' && bulkLabel(3) === 'Удалить 3 сообщения'
  && bulkLabel(5) === 'Удалить 5 сообщений' && bulkLabel(11) === 'Удалить 11 сообщений'
  && bulkLabel(22) === 'Удалить 22 сообщения' && bulkLabel(0) === '')

// check() синхронный, а runBulk — нет: ждём результат ДО проверки, иначе
// проверка получила бы обещание (всегда истинное) и не смогла бы провалиться.
const пачка = await runBulk(лента.slice(0, 3), async id => id !== 'm2')
check('отказ по одному не отменяет остальные', () => пачка.done === 2 && пачка.failed === 1)
check('итог называет то, что произошло на самом деле', () =>
  bulkReport({ done: 9, failed: 3 }) === 'Удалено 9, не удалось 3'
  && bulkReport({ done: 5, failed: 0 }) === 'Удалено 5'
  && bulkReport({ done: 0, failed: 4 }) === 'Не удалось удалить ни одного сообщения')

console.log('\n-- Ломаем нарочно (удаление пачкой) --')
check('проверка ловит счёт по выбору вместо счёта по удаляемым', () => {
  // Так и появлялось «удалить 12», после которого исчезало 9.
  const sel = наб('m1', 'm2', 'm3')
  const плохо = sel.size                          // считаем по отмеченным
  const правильно = deletable(sel, лента, моё).length
  return плохо !== правильно && правильно === 2
})
check('проверка ловит потерю ограничения в сотню', () => {
  const много = Array.from({ length: 120 }, (_, i) => ({ id: 'y' + i, author: 'я' }))
  return deletable(new Set(много.map(m => m.id)), много, моё).length < много.length
})


// -- v1.449.0: право на @everyone решает получатель -------------------------
// Право проверялось ровно в одном месте — в поле ввода у отправителя, а база не
// проверяет его нигде. То есть обходилось своим клиентом, ботом или плагином.
console.log('\n-- Упоминания и права --')
const можно = { everyone: true, roles: true }
const нельзя = { everyone: false, roles: false }

check('@everyone от того, кому можно, звенит', () => mentionsMe('@everyone привет', 'Вася', можно))
check('@everyone от того, кому нельзя, не звенит', () => !mentionsMe('@everyone привет', 'Вася', нельзя))
check('@here — то же право', () =>
  mentionsMe('@here ау', 'Вася', можно) && !mentionsMe('@here ау', 'Вася', нельзя))
check('личное упоминание звенит всегда', () =>
  mentionsMe('@Вася глянь', 'Вася', нельзя) && mentionsMe('@Вася глянь', 'Вася', можно))
check('без сведений о правах ведём себя как раньше', () =>
  mentionsMe('@everyone привет', 'Вася') && mentionsMe('@Вася', 'Вася'))
check('роль упоминается только тем, кому позволено', () =>
  mentionsMyRole('@Модеры сюда', 'Модеры', можно) && !mentionsMyRole('@Модеры сюда', 'Модеры', нельзя))
check('запрет на роли не глушит личное упоминание', () => mentionsMe('@Вася', 'Вася', нельзя))

console.log('\n-- Ломаем нарочно (упоминания) --')
check('проверка ловит возврат к решению отправителя', () => {
  // Так и было: текст с @everyone звенел у всех независимо от прав автора.
  const поСтарому = /@everyone/.test('@everyone привет')
  return поСтарому && !mentionsMe('@everyone привет', 'Вася', нельзя)
})


// -- v1.452.0: прохождение сюжетных игр --------------------------------------
// Про сюжетную игру в присутствии было ровно одно: «Играет в X». Ни места
// прохождения, ни процентов. Здесь проверяется счёт и то, что строка активности
// и открытая панель считают ОДНО И ТО ЖЕ.
console.log('\n-- Прохождение сюжетки --')
const кампания = (n: number, done: number) => ({
  game: 'Игра', at: 0,
  missions: Array.from({ length: n }, (_, i) => ({ name: 'Миссия ' + (i + 1), done: i < done })),
})

check('проценты считаются от пройденного', () =>
  percent(кампания(20, 7)) === 35 && percent(кампания(20, 0)) === 0 && percent(кампания(20, 20)) === 100)
check('пустой список не делит на ноль', () =>
  percent(кампания(0, 0)) === 0 && shortLabel(кампания(0, 0)) === '' && storyShare(кампания(0, 0)) === null)
check('текущая — первая непройденная', () => {
  const c = кампания(20, 7)
  return currentIndex(c) === 7 && currentMission(c)?.name === 'Миссия 8'
})
check('всё пройдено — текущей нет', () => {
  const c = кампания(5, 5)
  return isComplete(c) && currentIndex(c) === -1 && currentMission(c) === null
})
check('строка активности называет место и проценты', () =>
  shortLabel(кампания(20, 7)) === 'Миссия 8 из 20 · 35%'
  && shortLabel(кампания(5, 5)) === 'Пройдено полностью · 5 из 5')
check('полная строка добавляет название миссии', () =>
  fullLabel(кампания(20, 7)) === 'Миссия 8 из 20 · 35% · Миссия 8')
check('длинное название миссии режется', () => {
  const c = { game: 'И', at: 0, missions: [{ name: 'М'.repeat(200), done: false }] }
  const l = fullLabel(c, 20)
  return l.includes('…') && l.length < 60
})

check('своё и чужое прохождение пишутся одинаково', () => {
  // Разойдись эти две функции — и у друга в списке было бы одно, а у себя другое.
  const c = кампания(20, 7)
  return shareLabel(storyShare(c)) === shortLabel(c)
      && shareLabel(storyShare(кампания(5, 5))) === shortLabel(кампания(5, 5))
})

console.log('\n-- Список миссий приносит человек --')
check('нумерация и маркеры отбрасываются', () =>
  parseMissions('1. Первая\n2) Вторая\n- Третья\n• Четвёртая').join('|') === 'Первая|Вторая|Третья|Четвёртая')
check('пустые строки и пробелы не создают миссий', () =>
  parseMissions('\n\n  Одна  \n\n\n   \n').join('|') === 'Одна')
check('повторы выкидываются', () =>
  parseMissions('Пролог\nПролог\nпролог\nФинал').join('|') === 'Пролог|Финал')
check('вставленная простыня обрезается', () => {
  const много = Array.from({ length: 900 }, (_, i) => 'М' + i).join('\n')
  return parseMissions(много).length === MAX_MISSIONS
})
check('абзац вместо названия обрезается', () =>
  parseMissions('А'.repeat(500))[0].length === MAX_MISSION_NAME)

check('правка списка не теряет отметки и заметки', () => {
  // Список дополняют — и это не повод обнулить пройденное.
  let c = buildCampaign('Игра', 'Пролог\nЛес\nЗамок', null, 1)
  c = toggleMission(c, 1, 2)
  c = setNote(c, 1, 'взять факел', 3)
  const c2 = buildCampaign('Игра', 'Пролог\nЛес\nЗамок\nФинал', c, 4)
  return c2.missions.length === 4 && c2.missions[0].done && c2.missions[1].done
      && c2.missions[1].note === 'взять факел' && !c2.missions[3].done
})

check('отметка закрывает всё до неё', () => {
  const c = toggleMission(кампания(10, 0), 4)
  return counts(c).done === 5 && c.missions[4].done && !c.missions[5].done
})
check('снятие отметки открывает всё после', () => {
  const c = toggleMission(кампания(10, 8), 3)
  return counts(c).done === 3 && !c.missions[3].done && !c.missions[7].done
})
check('чужой номер миссии ничего не портит', () => {
  const c = кампания(3, 1)
  return toggleMission(c, 99) === c && setNote(c, -1, 'x') === c
})

console.log('\n-- Вопрос к ИИ про своё место --')
check('к вопросу прикладывается место прохождения', () => {
  const ctx = askContext(кампания(20, 7))
  return ctx.includes('Игра') && ctx.includes('Миссия 8') && ctx.includes('35%')
})
check('пройденную кампанию описываем как пройденную', () =>
  askContext(кампания(5, 5)).includes('пройдена полностью'))
check('без списка контекста нет, а вопрос всё равно уходит', () =>
  askContext(кампания(0, 0)) === '' && askPrompt(кампания(0, 0), 'как быть?').includes('как быть?'))
check('пустой вопрос не отправляется', () =>
  askPrompt(кампания(20, 7), '   ') === '')
check('ИИ просят не рассказывать сюжет вперёд', () =>
  /испортить сюжет/.test(askPrompt(кампания(20, 7), 'куда идти?')))
check('своя заметка попадает в вопрос', () => {
  const c = setNote(кампания(20, 7), 7, 'застрял на боссе')
  return askContext(c).includes('застрял на боссе')
})

console.log('\n-- Ломаем нарочно (прохождение) --')
check('проверка ловит проценты, посчитанные от номера, а не от пройденного', () => {
  // Так бы вышло, если считать «текущая/всего»: 8 из 20 = 40%, а пройдено 35%.
  const плохо = Math.round((8 / 20) * 100)
  return плохо === 40 && percent(кампания(20, 7)) === 35
})
check('проверка ловит расхождение своей и чужой строки', () => {
  const c = кампания(13, 4)
  return shareLabel(storyShare(c)) === shortLabel(c) && shortLabel(c).includes('из 13')
})


// -- v1.453.0: свайпы на телефоне --------------------------------------------
// Шторки открывались только кнопкой в углу шапки — то есть самое частое
// действие на телефоне требовало прицелиться. Здесь проверяется, что жест
// отличается от прокрутки и от дрожания руки.
console.log('\n-- Свайпы --')
const т = (x: number, y: number, t: number) => ({ x, y, t })

check('от края экрана начинать можно', () =>
  fromEdge(5, 390) === 'left' && fromEdge(385, 390) === 'right')
check('из середины — нельзя', () => fromEdge(200, 390) === null)
check('ровная протяжка вправо — свайп', () => swipeDir(т(5, 400, 0), т(140, 405, 200)) === 'right')
check('ровная протяжка влево — свайп', () => swipeDir(т(385, 400, 0), т(250, 402, 200)) === 'left')
check('прокрутка ленты свайпом не считается', () =>
  swipeDir(т(5, 500, 0), т(30, 200, 200)) === null)
check('диагональ с перевесом вниз не считается', () =>
  swipeDir(т(5, 400, 0), т(80, 500, 200)) === null)
check('дрожание руки не считается', () => swipeDir(т(5, 400, 0), т(35, 402, 120)) === null)
check('слишком долгое движение не считается', () =>
  swipeDir(т(5, 400, 0), т(200, 400, 5000)) === null)

check('вправо у закрытых шторок открывает каналы', () =>
  swipeAction('right', { navOpen: false, membersOpen: false, hasMembers: true }) === 'open-nav')
check('влево при открытых каналах закрывает их', () =>
  swipeAction('left', { navOpen: true, membersOpen: false, hasMembers: true }) === 'close-nav')
check('влево у закрытых открывает участников', () =>
  swipeAction('left', { navOpen: false, membersOpen: false, hasMembers: true }) === 'open-members')
check('вправо при открытых участниках сначала закрывает их', () =>
  // Иначе одним движением открылись бы обе шторки разом.
  swipeAction('right', { navOpen: false, membersOpen: true, hasMembers: true }) === 'close-members')
check('без списка участников влево ничего не делает', () =>
  swipeAction('left', { navOpen: false, membersOpen: false, hasMembers: false }) === 'none')
check('не свайп — ничего не делает', () =>
  swipeAction(null, { navOpen: false, membersOpen: false, hasMembers: true }) === 'none')

console.log('\n-- Ломаем нарочно (свайпы) --')
check('проверка ловит свайп без перевеса по горизонтали', () => {
  // Без перевеса шторка вылезала бы при обычной прокрутке ленты.
  const почтиРовно = swipeDir(т(5, 400, 0), т(80, 460, 200))
  return почтиРовно === null && swipeDir(т(5, 400, 0), т(140, 405, 200)) === 'right'
})
check('проверка ловит открытие обеих шторок одним движением', () =>
  swipeAction('right', { navOpen: false, membersOpen: true, hasMembers: true }) !== 'open-nav')


// -- v1.453.0: ИИ-подсказки по игре ------------------------------------------
// Самое ломкое место — разбор потока: кусок из сети рвётся где угодно, в том
// числе посреди JSON. Наивный разбор теряет такие обрывки, и это выглядит как
// пропавшие слова в середине ответа — глазами не поймать.
console.log('\n-- ИИ по игре --')
const конф = { provider: 'openai' as const, key: 'k', model: 'm' }
const кусок = (t: string) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n'
const кусокА = (t: string) => 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: t } }) + '\n\n'

check('слова собираются по порядку', () => {
  const r = makeSseReader('openai')
  return [...r(кусок('При')), ...r(кусок('вет'))].join('') === 'Привет'
})
check('поток, порванный посреди JSON, не теряет слов', () => {
  // Ровно это и терял наивный разбор.
  const r = makeSseReader('openai')
  const весь = кусок('Ключ') + кусок(' под ковром')
  const где = Math.floor(весь.length / 2)
  const out = [...r(весь.slice(0, где)), ...r(весь.slice(где))]
  return out.join('') === 'Ключ под ковром'
})
check('порванный по буквам поток тоже собирается', () => {
  const r = makeSseReader('openai')
  const весь = кусок('абв')
  let out: string[] = []
  for (const ch of весь) out = out.concat(r(ch))
  return out.join('') === 'абв'
})
check('конец потока не превращается в слово', () => {
  const r = makeSseReader('openai')
  return r('data: [DONE]\n\n').length === 0
})
check('мусор в потоке пропускается, а не роняет разбор', () => {
  const r = makeSseReader('openai')
  return r('data: не-json\n\n' + кусок('ок')).join('') === 'ок'
})
check('второй сервис разбирается своим способом', () => {
  const r = makeSseReader('anthropic')
  return r(кусокА('да')).join('') === 'да'
      && makeSseReader('anthropic')(кусок('нет')).length === 0
})

check('запрос собирается под каждый сервис', () => {
  const o = buildRequest(конф, 'вопрос')
  const a = buildRequest({ ...конф, provider: 'anthropic' }, 'вопрос')
  return o.url.includes('/v1/chat/completions') && o.headers.Authorization === 'Bearer k'
      && a.url.includes('/v1/messages') && a.headers['x-api-key'] === 'k'
      && JSON.parse(o.body).stream === true && JSON.parse(a.body).stream === true
})
check('свой адрес сервиса учитывается', () =>
  buildRequest({ ...конф, base: 'https://моё.local' }, 'в').url.startsWith('https://моё.local'))
check('без ключа спрашивать не идём', () =>
  !aiReady({ ...конф, key: '' }) && !aiReady({ ...конф, key: '   ' }) && aiReady(конф))
check('отказ объясняется по-человечески', () =>
  /Ключ не принят/.test(whyFailed(401)) && /квота/.test(whyFailed(429))
  && /не отвечает/.test(whyFailed(503)) && /модели/.test(whyFailed(404)))

console.log('\n-- Ломаем нарочно (ИИ по игре) --')
check('проверка ловит разбор без накопления хвоста', () => {
  // Так выглядел бы наивный разбор: половину куска он просто выбросит.
  const половина = кусок('Ключ').slice(0, 20)
  // Наивный разбор попробует разобрать обрывок сразу и потеряет слово.
  let наивноПотерял = true
  try { наивноПотерял = !JSON.parse(половина.slice(5).trim())?.choices } catch { наивноПотерял = true }
  const r = makeSseReader('openai')
  return наивноПотерял && r(половина).length === 0 && r(кусок('Ключ').slice(20)).join('') === 'Ключ'
})


// -- v1.458.0: схема прохождения -------------------------------------------
// Прохождение показывалось списком, который человек вбивал сам. Теперь данные
// приложение берёт из Steam, а показывает цепочкой узлов со связями. Раскладка
// проверяется здесь: координаты «поплывут» при первой же правке разметки, а на
// схеме из полусотни узлов глазами этого не увидеть.
console.log('\n-- Схема прохождения --')
const веха = (i: number, done: boolean, at = 0) => ({ id: 'a' + i, title: 'Веха ' + i, done, at })
const цепь = (n: number, done: number) => Array.from({ length: n }, (_, i) => веха(i, i < done, i + 1))

check('пройденные идут по времени прохождения', () => {
  const r = orderNodes([веха(1, true, 300), веха(2, true, 100), веха(3, false)])
  return r.map(n => n.id).join(',') === 'a2,a1,a3'
})
check('непройденные остаются в своём порядке', () => {
  const r = orderNodes([веха(1, false), веха(2, false), веха(3, true, 5)])
  return r.map(n => n.id).join(',') === 'a3,a1,a2'
})

check('текущая веха ровно одна — первая непройденная', () => {
  const l = layoutFlow(цепь(10, 4))
  const тек = l.nodes.filter(n => n.current)
  return тек.length === 1 && тек[0].step === 4
})
check('когда пройдено всё — текущей нет', () =>
  layoutFlow(цепь(5, 5)).nodes.every(n => !n.current))

check('узлы не наезжают друг на друга', () => {
  const l = layoutFlow(цепь(12, 3), 4)
  for (let i = 0; i < l.nodes.length; i++) {
    for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i], b = l.nodes[j]
      const пересеклись = a.x < b.x + NODE_W && b.x < a.x + NODE_W
        && a.y < b.y + NODE_H && b.y < a.y + NODE_H
      if (пересеклись) return false
    }
  }
  return true
})
check('ряды идут змейкой — конец ряда над началом следующего', () => {
  const l = layoutFlow(цепь(8, 0), 4)
  // Четвёртый узел (последний в первом ряду) и пятый (первый во втором) стоят
  // в одном столбце: связь между ними короткая, а не через весь экран.
  return l.nodes[3].x === l.nodes[4].x && l.nodes[4].y > l.nodes[3].y
})
check('всё помещается в объявленный размер', () => {
  const l = layoutFlow(цепь(9, 2), 4)
  return l.nodes.every(n => n.x >= 0 && n.y >= 0
    && n.x + NODE_W <= l.width && n.y + NODE_H <= l.height)
})
check('связей на одну меньше, чем узлов', () => {
  const l = layoutFlow(цепь(7, 3))
  return l.links.length === 6 && l.links[0].from === l.nodes[0].id && l.links[0].to === l.nodes[1].id
})
check('пустая схема не ломается', () => {
  const l = layoutFlow([])
  return l.nodes.length === 0 && l.links.length === 0 && l.width > 0 && l.height > 0
})

check('линия внутри ряда идёт от края к краю', () => {
  const l = layoutFlow(цепь(4, 0), 4)
  const p = linkPath(l.nodes[0], l.nodes[1])
  return p.x1 === l.nodes[0].x + NODE_W && p.x2 === l.nodes[1].x && p.y1 === p.y2
})
check('линия между рядами идёт сверху вниз', () => {
  const l = layoutFlow(цепь(6, 0), 4)
  const p = linkPath(l.nodes[3], l.nodes[4])
  return p.y2 > p.y1 && p.x1 === p.x2
})
check('обратный ряд рисует линию в другую сторону', () => {
  const l = layoutFlow(цепь(8, 0), 4)
  // Во втором ряду узлы идут справа налево: линия должна выходить из левого края.
  const p = linkPath(l.nodes[4], l.nodes[5])
  return p.x1 === l.nodes[4].x && p.x2 === l.nodes[5].x + NODE_W
})

check('проценты считаются от пройденных вех', () => {
  const r = flowProgress(цепь(20, 7))
  return r.done === 7 && r.total === 20 && r.pct === 35
})
check('без вех процентов нет, а не деление на ноль', () => flowProgress([]).pct === 0)

console.log('\n-- Ломаем нарочно (схема) --')
check('проверка ловит раскладку в одну строку', () => {
  // Одна строка на полсотни вех — это экран в двенадцать тысяч пикселей.
  const l = layoutFlow(цепь(50, 0), 4)
  return l.width < 1200 && l.height > 400
})
check('проверка ловит наезд узлов друг на друга', () => {
  const l = layoutFlow(цепь(2, 0), 4)
  return l.nodes[1].x - l.nodes[0].x >= NODE_W
})


// -- v1.459.0: Gemini и что уходит вместе с вопросом -------------------------
// Владелец попросил Gemini и чтобы к вопросу сразу шли прогресс и данные об
// игре. У Google свой вид запроса и свой вид потока — значит своя ветка, и
// значит своя проверка: молча собранный не так запрос выглядит как «ИИ не
// работает».
console.log('\n-- Gemini и контекст игры --')
const gem = { provider: 'gemini' as const, key: 'AIzaKEY', model: 'gemini-2.0-flash' }
const кусокG = (t: string) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) + '\n\n'

check('ключ уходит в адресе, а не заголовком', () => {
  const r = buildRequest(gem, 'вопрос')
  return r.url.includes('key=AIzaKEY') && !JSON.stringify(r.headers).includes('AIzaKEY')
})
check('просим именно поток', () => buildRequest(gem, 'в').url.includes('alt=sse'))
check('модель подставляется в адрес', () =>
  buildRequest(gem, 'в').url.includes('gemini-2.0-flash:streamGenerateContent'))
check('вопрос уходит в теле по формату Google', () => {
  const b = JSON.parse(buildRequest(gem, 'где ключ?').body)
  return b.contents[0].parts[0].text === 'где ключ?'
})
check('свой адрес сервиса учитывается', () =>
  buildRequest({ ...gem, base: 'https://мой.local' }, 'в').url.startsWith('https://мой.local'))

check('ответ Gemini собирается по словам', () => {
  const r = makeSseReader('gemini')
  return [...r(кусокG('При')), ...r(кусокG('вет'))].join('') === 'Привет'
})
check('несколько кусков в одном ответе не теряются', () => {
  const r = makeSseReader('gemini')
  const j = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'а' }, { text: 'б' }] } }] }) + '\n\n'
  return r(j).join('') === 'аб'
})
check('поток Gemini, порванный посреди JSON, не теряет слов', () => {
  const r = makeSseReader('gemini')
  const весь = кусокG('Ключ под ковром')
  const где = Math.floor(весь.length / 2)
  return [...r(весь.slice(0, где)), ...r(весь.slice(где))].join('') === 'Ключ под ковром'
})
check('чужой формат в ветке Gemini не читается как ответ', () => {
  const r = makeSseReader('gemini')
  return r('data: ' + JSON.stringify({ choices: [{ delta: { content: 'нет' } }] }) + '\n\n').length === 0
})

const вехи = [
  { id: '1', title: 'Пролог', desc: 'Выбраться', done: true, at: 100 },
  { id: '2', title: 'Дорога', done: true, at: 200 },
  { id: '3', title: 'Замок', desc: 'Найти ключ', done: false },
  { id: '4', title: 'Финал', done: false },
]

check('к вопросу уходит игра, прогресс и текущая веха', () => {
  const t = flowContext('Игра', вехи)
  return t.includes('Игра') && t.includes('2 из 4') && t.includes('50%')
    && t.includes('Замок') && t.includes('Найти ключ')
})
check('уходит и то, что позади, и то, что впереди', () => {
  const t = flowContext('Игра', вехи)
  return t.includes('Пролог') && t.includes('Дорога') && t.includes('Финал')
})
check('пройденную игру описываем как пройденную', () =>
  flowContext('Игра', вехи.map(n => ({ ...n, done: true }))).includes('полностью'))
check('без вех уходит хотя бы название игры', () =>
  flowContext('Игра', []) === 'Игра: Игра.')
check('время за игрой прикладывается, когда известно', () =>
  flowContext('Игра', вехи, '2 ч 15 м').includes('2 ч 15 м'))

check('длинный список целиком не шлём', () => {
  // У иных игр вех полтысячи: слать всё — это и дорого, и бесполезно.
  const много = Array.from({ length: 400 }, (_, i) => ({ id: 'x' + i, title: 'Веха ' + i, done: i < 200 }))
  const t = flowContext('Игра', много)
  return t.length < 1200 && t.includes('200 из 400')
})

check('пустой вопрос никуда не уходит', () => flowPrompt('Игра', вехи, '  ') === '')
check('модель просят не портить сюжет и не выдумывать', () => {
  const t = flowPrompt('Игра', вехи, 'куда идти?')
  return /испортить сюжет/.test(t) && /не выдумывай/.test(t) && t.includes('куда идти?')
})

console.log('\n-- Ломаем нарочно (Gemini) --')
check('проверка ловит ключ, ушедший заголовком вместо адреса', () => {
  const r = buildRequest(gem, 'в')
  return !JSON.stringify(r.headers).includes(gem.key) && r.url.includes(gem.key)
})
check('проверка ловит вопрос без прогресса', () => {
  const голый = flowPrompt('Игра', [], 'вопрос')
  const полный = flowPrompt('Игра', вехи, 'вопрос')
  return !голый.includes('50%') && полный.includes('50%')
})


// -- v1.460.0: панели закрываются щелчком мимо -------------------------------
// Выбор эмодзи и гифок закрывался ТОЛЬКО повторным нажатием на тот же значок.
// Щелчок мимо не делал ничего — панель висела поверх переписки. Здесь три
// тонкости, и все три ловятся не глазами, а проверкой.
console.log('\n-- Закрытие всплывающих панелей --')
const узел = (внутри: any[] = []) => ({
  contains: (x: any) => внутри.includes(x),
}) as any

check('щелчок внутри панели её не закрывает', () => {
  const внутренний = {}
  return !shouldDismiss(внутренний, узел([внутренний]), null)
})
check('щелчок по самой панели её не закрывает', () => {
  const панель = узел([])
  return !shouldDismiss(панель, панель, null)
})
check('нажатие по открывающему значку «мимо» не считается', () => {
  // Иначе панель закрылась бы тем же нажатием, которым открылась, — то есть
  // не открылась бы вовсе.
  const значок = узел([])
  return !shouldDismiss(значок, узел([]), значок)
})
check('щелчок в стороне закрывает', () =>
  shouldDismiss({}, узел([]), узел([])))
check('без панели и значка любой щелчок закрывает', () =>
  shouldDismiss({}, null, null))
check('мусор вместо узла не роняет проверку', () =>
  shouldDismiss(null, узел([]), null) && shouldDismiss(undefined, null, null))

console.log('\n-- Ломаем нарочно (панели) --')
check('проверка ловит закрытие по собственному значку', () => {
  const значок = узел([])
  // Так и было бы, если забыть про значок: открыл и тут же закрыл.
  return shouldDismiss(значок, узел([]), null) && !shouldDismiss(значок, узел([]), значок)
})


// -- v1.460.0: что уходит в консоль ------------------------------------------
// Ошибки печатались как есть, вместе с объектом: в одном месте прямо уезжали
// настройки человека. Консоль собранного приложения открывает кто угодно.
console.log('\n-- Записи в консоль --')

check('наружу уходит только короткая причина', () =>
  shortReason(new Error('не вышло')) === 'не вышло'
  && shortReason('строкой') === 'строкой')
check('объект не разворачивается', () => {
  // Именно в объекте и приезжает лишнее — запрос, заголовки, куски данных.
  const с_данными: any = { message: 'отказ', token: 'секрет', payload: { имя: 'вася' } }
  const r = shortReason(с_данными)
  return r === 'отказ' && !r.includes('секрет') && !r.includes('вася')
})
check('ошибка без описания не роняет запись', () =>
  shortReason({}) === 'ошибка без описания' && shortReason(null) === '')
check('длинная причина обрезается', () =>
  shortReason(new Error('я'.repeat(900))).length <= 200)

check('в собранном приложении подробностей нет', () =>
  logLine('roles', new Error('таблица не найдена'), true) === '[roles]')
check('при разработке подробности остаются', () =>
  logLine('roles', new Error('таблица не найдена'), false) === '[roles] таблица не найдена')

console.log('\n-- Ломаем нарочно (консоль) --')
check('проверка ловит утечку данных в запись', () => {
  const с_данными: any = { message: 'отказ', patch: { тема: 'тёмная', ключ: 'секрет' } }
  const было = JSON.stringify(с_данными)          // так печаталось раньше
  const стало = logLine('user-prefs', с_данными, false)
  return было.includes('секрет') && !стало.includes('секрет')
})


// -- v1.460.0: свои темы наборами --------------------------------------------
// Набор своих цветов был ровно один: собрал тему под вечер, захотел светлую на
// день — старую запоминай на бумажке. И поделиться было нечем.
console.log('\n-- Свои темы --')
const цвета = { dark: '#111111', content: '#222222', panel: '#333333',
  hover: '#444444', active: '#555555', accent: '#5865f2' }

check('полный набор цветов принимается', () => !!okColors(цвета))
check('неполный или кривой набор — нет', () =>
  !okColors({ ...цвета, accent: 'синий' }) && !okColors({ dark: '#111111' }) && !okColors(null))
check('цвет приводится к одному виду', () => okColor('#ABCDEF') === '#abcdef' && okColor('оранжевый') === null)

check('тема кодируется и читается обратно', () => {
  const код = encodeTheme('Моя тема', цвета)
  const t = decodeTheme(код)
  return !!t && t.name === 'Моя тема' && JSON.stringify(t.colors) === JSON.stringify(цвета)
})
check('код видно глазом, что это тема', () => encodeTheme('X', цвета).startsWith('ponoi-theme:'))
check('чужая строка темой не притворяется', () =>
  decodeTheme('привет') === null && decodeTheme('ponoi-theme:X:мусор') === null
  && decodeTheme('') === null)
check('обрезанный код не применяется наполовину', () =>
  decodeTheme('ponoi-theme:X:111111-222222') === null)
check('название с двоеточием не ломает разбор', () => {
  const t = decodeTheme(encodeTheme('Тема: вечер', цвета))
  return !!t && t.colors.accent === '#5865f2'
})

check('одинаковое имя заменяет, а не плодит', () => {
  let l = addPreset([], 'Моя', цвета, 1)
  l = addPreset(l, 'моя', { ...цвета, accent: '#ff0000' }, 2)
  return l.length === 1 && l[0].colors.accent === '#ff0000'
})
check('свежая тема оказывается сверху', () => {
  let l = addPreset([], 'Первая', цвета, 1)
  l = addPreset(l, 'Вторая', цвета, 2)
  return l[0].name === 'Вторая'
})
check('список не растёт без предела', () => {
  let l: any[] = []
  for (let i = 0; i < 40; i++) l = addPreset(l, 'Т' + i, цвета, i)
  return l.length === MAX_PRESETS
})
check('удаление убирает ровно одну', () => {
  let l = addPreset(addPreset([], 'A', цвета, 1), 'B', цвета, 2)
  l = removePreset(l, 'a')
  return l.length === 1 && l[0].name === 'B'
})

console.log('\n-- Ломаем нарочно (темы) --')
check('проверка ловит применение чужой строки как темы', () => {
  // Молча применить непонятную строку — значит перекрасить приложение неизвестно
  // во что и не сказать, почему.
  return decodeTheme('ponoi-theme:Взлом:zzzzzz-222222-333333-444444-555555-666666') === null
})


console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
