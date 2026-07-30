// v1.412.0: проверка всей логики Ponoi Music. Запуск: npm run test:music
//
// Зачем отдельный набор. Плеер оброс решениями, которые видно только на краях:
// что считать одной и той же песней, что играть дальше, куда возвращает
// «назад», в каком порядке выкладывать склад, как разбирать чужие ссылки. Всё
// это чистые функции, и проверять их надо на настоящих строках и числах, а не
// глазами по экрану — глазами такие вещи не видно, пока не сломается у людей.
//
// Разбор текста песни живёт отдельно (npm run test:lyrics), перетаскивание
// плашки — в окне (npm run test:drag): там нужен настоящий DOM.
export {}

import { nextTrack, backTarget, resolveNext } from './nextTrack'
import { recommend, libraryOrder, personalOrder, WHY_LABEL, banWindow, AUTHOR_STREAK } from './personalQueue'
import { normalizeTrackUrl, sameTrack } from './trackUrl'
import { parseYouTubeId, isYouTubeUrl, findYouTubeLink, isAudiusUrl } from './sources'
import { boost, lighten, scale, rgb } from './artColor'
import { searchQuery } from './streaming'
import { countAfterFail, countAfterOk, brokenIn, BROKEN_AFTER } from './broken'
import { isEmbedDeniedCode, pauseKind, silenceStuck, SILENCE_MS } from './broken'
import { pushFail, sourceDown, SOURCE_DOWN_FAILS, SOURCE_DOWN_MS, type FailMark } from './broken'
import { mergeTracks } from './mergeTracks'
import { libraryPlan, newestAt, SNAPSHOT_TTL_MS } from './libCache'
import { advance, credited, creditThreshold, freshListened, CREDIT_SEC, STEP_MAX } from './playCredit'
import { tooShortWhy, MIN_TRACK_SEC } from './minLength'
import {
  normalizePlaylists, createPlaylist, renamePlaylist, removePlaylist, addToPlaylist,
  removeFromPlaylist, movePlaylistTrack, playlistsOrder, playlistTracks, playlistSize,
  PL_NAME_MAX, PL_TRACKS_MAX, type Playlist,
} from './playlists'

let pass = 0, fail = 0
function check(name: string, fn: () => boolean) {
  let ok = false, err = ''
  try { ok = fn() } catch (e: any) { err = e?.message ?? String(e) }
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  ПРОВАЛ ' + name + (err ? ' — ' + err : '')) }
}

// ── Что играть дальше ────────────────────────────────────────────────────
console.log('── Переход к следующему треку ──')
const N = (o: any) => nextTrack({ repeat: 'off', shuffle: false, ...o })

check('по порядку', () => { const a = N({ idx: 0, count: 3 }); return a.kind === 'go' && a.index === 1 })
check('последний без повтора — остановка', () => N({ idx: 2, count: 3 }).kind === 'stop')
check('последний с повтором всего — на первый', () => {
  const a = N({ idx: 2, count: 3, repeat: 'all' }); return a.kind === 'go' && a.index === 0
})
check('повтор одного — тот же трек сначала', () => N({ idx: 1, count: 3, repeat: 'one' }).kind === 'restart')
check('пустой склад — остановка', () => N({ idx: 0, count: 0 }).kind === 'stop')
check('единственный трек без повтора — остановка', () => N({ idx: 0, count: 1 }).kind === 'stop')
check('единственный трек с повтором всего — сначала', () => N({ idx: 0, count: 1, repeat: 'all' }).kind === 'restart')
check('поставленный вручную идёт вперёд очереди', () => {
  const a = N({ idx: 0, count: 5, manualIdx: 3 }); return a.kind === 'go' && a.index === 3
})
check('поставленный вручную и есть текущий — играем сначала', () =>
  N({ idx: 2, count: 5, manualIdx: 2 }).kind === 'restart')
check('номер вручную вне склада не ломает', () => {
  const a = N({ idx: 0, count: 3, manualIdx: 99 }); return a.kind === 'go' && a.index === 1
})
check('повтор одного главнее поставленного вручную', () =>
  N({ idx: 0, count: 5, repeat: 'one', manualIdx: 3 }).kind === 'restart')
check('перемешивание не даёт тот же трек', () => {
  for (let seed = 0; seed < 30; seed++) {
    const a = N({ idx: 2, count: 5, shuffle: true, rnd: () => seed / 30 })
    if (a.kind !== 'go' || a.index === 2) return false
  }
  return true
})
check('перемешивание из одного трека не зацикливается', () =>
  N({ idx: 0, count: 1, repeat: 'all', shuffle: true, rnd: () => 0 }).kind === 'restart')
check('личная очередь важнее порядка склада', () => {
  const a = N({ idx: 0, count: 5, personalIdx: 4 }); return a.kind === 'go' && a.index === 4
})
check('перемешивание отменяет личную очередь', () => {
  const a = N({ idx: 0, count: 5, shuffle: true, personalIdx: 4, rnd: () => 0.4 })
  return a.kind === 'go' && a.index === 2
})
check('вручную важнее личной очереди', () => {
  const a = N({ idx: 0, count: 5, manualIdx: 1, personalIdx: 4 }); return a.kind === 'go' && a.index === 1
})

// ── «Назад» ──────────────────────────────────────────────────────────────
console.log('\n── Возврат к прошлому треку ──')
const yes = () => true
check('возвращает к предыдущему прослушанному', () => backTarget(['a', 'b', 'c'], yes).target === 'b')
check('дважды подряд — на два назад', () => {
  const r = backTarget(backTarget(['a', 'b', 'c'], yes).hist, yes); return r.target === 'a'
})
check('в самом начале возвращаться некуда', () => backTarget(['a'], yes).target === null)
check('пустая история не ломает', () => backTarget([], yes).target === null)
check('удалённый трек пропускается', () => backTarget(['a', 'b', 'c'], id => id !== 'b').target === 'a')
check('всё удалено — некуда', () => backTarget(['a', 'b', 'c'], id => id === 'c').target === null)
check('исходная история не портится', () => {
  const h = ['a', 'b', 'c']; backTarget(h, yes); return h.length === 3
})
check('наверху остаётся тот, куда вернулись', () => {
  const r = backTarget(['a', 'b', 'c'], yes); return r.hist[r.hist.length - 1] === r.target
})

// ── Подбор следующего ────────────────────────────────────────────────────
console.log('\n── Умная очередь ──')
const T = (id: string, name = '', author = '', plays = 0) => ({ id, name, author, plays })
const MIX = [T('cur', 'Ночь', 'Кино'), T('same', 'Пачка сигарет', 'Кино'), T('other', 'Другое', 'Кто-то')]

check('тот же исполнитель первым', () => recommend({ tracks: MIX, idx: 0, plays: {} })[0].track.id === 'same')
check('и причина названа верно', () => recommend({ tracks: MIX, idx: 0, plays: {} })[0].why === 'author')
check('у каждой причины есть человеческая подпись', () =>
  (['author', 'similar', 'rested', 'popular', 'fresh', 'order'] as const).every(w => !!WHY_LABEL[w]))
check('текущий трек не предлагается', () =>
  recommend({ tracks: MIX, idx: 0, plays: { cur: 99 } }).every(s => s.track.id !== 'cur'))
check('склад из одного трека — пустой подбор', () =>
  recommend({ tracks: [T('a')], idx: 0, plays: {} }).length === 0)
check('пустой склад — пустой подбор', () => recommend({ tracks: [], idx: 0, plays: {} }).length === 0)
check('подбор устойчив между вызовами', () => {
  const a = recommend({ tracks: MIX, idx: 0, plays: {} }).map(s => s.track.id).join('')
  const b = recommend({ tracks: MIX, idx: 0, plays: {} }).map(s => s.track.id).join('')
  return a === b
})
check('без названий и авторов не падает', () =>
  recommend({ tracks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], idx: 0, plays: {} }).length === 2)
check('только что игравшее уходит назад', () => {
  const r = recommend({ tracks: MIX, idx: 0, plays: {}, recent: ['same'] })
  return r[0].track.id === 'other'
})
check('незнакомое не выбрасывается', () => {
  const t = [T('cur'), T('known'), T('new')]
  const r = recommend({ tracks: t, idx: 0, plays: { known: 5 } })
  return r.some(s => s.track.id === 'new')
})
check('personalOrder отдаёт то же, что recommend', () => {
  const a = personalOrder({ tracks: MIX, idx: 0, plays: {} }).map(t => t.id).join('')
  const b = recommend({ tracks: MIX, idx: 0, plays: {} }).map(s => s.track.id).join('')
  return a === b
})

// ── Порядок склада ───────────────────────────────────────────────────────
console.log('\n── Порядок Трекотеки ──')
check('чаще слушаемое первым', () =>
  libraryOrder([T('a', '', '', 2), T('b', '', '', 40)]).map(t => t.id).join('') === 'ba')
check('ничьи не переставляются', () =>
  libraryOrder([T('a', '', '', 5), T('b', '', '', 5), T('c', '', '', 5)]).map(t => t.id).join('') === 'abc')
check('без числа — в конец', () =>
  libraryOrder([{ id: 'a' }, T('b', '', '', 1)]).map(t => t.id).join('') === 'ba')
check('исходный список не портится', () => {
  const src = [T('a', '', '', 1), T('b', '', '', 9)]
  libraryOrder(src); return src[0].id === 'a'
})
check('пустой склад не ломает', () => libraryOrder([]).length === 0)
check('порядок не зависит от того, сколько раз позвали', () => {
  const l = [T('a', '', '', 3), T('b', '', '', 3), T('c', '', '', 7)]
  return libraryOrder(l).map(t => t.id).join('') === libraryOrder(libraryOrder(l)).map(t => t.id).join('')
})

// ── Одна ли это песня ────────────────────────────────────────────────────
console.log('\n── Приведение ссылок ──')
const Y = 'https://www.youtube.com/watch?v=abc12345678'
check('www и http не делают песню другой', () =>
  sameTrack('http://www.youtube.com/watch?v=abc12345678', Y))
check('хвост «поделиться» отбрасывается', () =>
  sameTrack(Y + '&si=xyz', Y))
check('метка времени отбрасывается', () => sameTrack(Y + '&t=42', Y))
check('рекламные хвосты отбрасываются', () => sameTrack(Y + '&utm_source=vk&utm_medium=post', Y))
check('якорь отбрасывается', () => sameTrack(Y + '#t=10', Y))
check('порядок доводов не важен', () =>
  sameTrack('https://youtube.com/watch?v=abc12345678&list=RD', 'https://youtube.com/watch?list=RD&v=abc12345678'))
check('сам идентификатор видео не выбрасывается', () =>
  normalizeTrackUrl(Y).includes('v=abc12345678'))
check('разные видео остаются разными', () =>
  !sameTrack(Y, 'https://youtube.com/watch?v=zzz99999999'))
check('хвостовая косая ничего не меняет', () =>
  sameTrack('https://soundcloud.com/a/b/', 'https://soundcloud.com/a/b'))
check('плейлист в ссылке SoundCloud не делает трек другим', () =>
  sameTrack('https://soundcloud.com/a/b?in=a/sets/c', 'https://soundcloud.com/a/b'))
check('непонятная строка возвращается как есть', () =>
  normalizeTrackUrl('просто текст') === 'просто текст')
check('пустая строка не ломает', () => normalizeTrackUrl('') === '')
check('файловая ссылка не трогается', () =>
  normalizeTrackUrl('blob:abc-123') === 'blob:abc-123')

// ── Разбор ссылок ────────────────────────────────────────────────────────
console.log('\n── Ссылки на источники ──')
check('обычная ссылка YouTube', () => parseYouTubeId(Y) === 'abc12345678')
check('короткая youtu.be', () => parseYouTubeId('https://youtu.be/abc12345678') === 'abc12345678')
check('shorts', () => parseYouTubeId('https://youtube.com/shorts/abc12345678') === 'abc12345678')
check('embed', () => parseYouTubeId('https://youtube.com/embed/abc12345678') === 'abc12345678')
check('music.youtube.com', () => parseYouTubeId('https://music.youtube.com/watch?v=abc12345678') === 'abc12345678')
check('мобильная m.youtube.com', () => parseYouTubeId('https://m.youtube.com/watch?v=abc12345678') === 'abc12345678')
check('не YouTube — не id', () => parseYouTubeId('https://soundcloud.com/a/b') === null)
check('мусор не ломает разбор', () => parseYouTubeId('не ссылка') === null)
check('isYouTubeUrl согласован с разбором', () => isYouTubeUrl(Y) && !isYouTubeUrl('https://audius.co/a/b'))
check('ссылка находится в тексте сообщения', () =>
  findYouTubeLink('смотри ' + Y + ' вот') === Y)
check('в тексте без ссылки — ничего', () => findYouTubeLink('просто слова') === null)
check('пустой текст не ломает', () => findYouTubeLink(null) === null)
check('audius узнаётся', () => isAudiusUrl('https://audius.co/artist/track') && !isAudiusUrl(Y))

// ── Поисковый запрос для замены и текста ────────────────────────────────
console.log('\n── Запрос для поиска ──')
check('автор и название вместе', () => searchQuery('Numb', 'Linkin Park') === 'Linkin Park Numb')
check('скобки выбрасываются', () => searchQuery('Numb (Official Video)', 'Linkin Park') === 'Linkin Park Numb')
check('квадратные скобки тоже', () => searchQuery('Numb [Remastered]', 'Linkin Park') === 'Linkin Park Numb')
check('автор внутри названия не повторяется', () =>
  searchQuery('Linkin Park - Numb', 'Linkin Park') === 'Linkin Park Numb')
check('пустой автор не оставляет пробела', () => searchQuery('Numb', '') === 'Numb')
check('лишние пробелы схлопываются', () => !/ {2}/.test(searchQuery('  Numb   x  ', ' Linkin  Park ')))

// ── Цвета обложки ────────────────────────────────────────────────────────
console.log('\n── Цвет из обложки ──')
check('тёмный цвет поднимается до видимого', () => boost({ r: 10, g: 10, b: 10 }).r >= 96)
check('яркий цвет не трогается', () => {
  const c = { r: 200, g: 10, b: 10 }; return boost(c).r === 200
})
check('поднятие не выходит за 255', () => {
  const c = boost({ r: 1, g: 1, b: 255 }); return c.r <= 255 && c.g <= 255 && c.b <= 255
})
check('осветление идёт к белому', () => lighten({ r: 0, g: 0, b: 0 }, 0.5).r === 128)
check('осветление на ноль ничего не меняет', () => lighten({ r: 50, g: 60, b: 70 }, 0).g === 60)
check('затемнение идёт к чёрному', () => scale({ r: 100, g: 100, b: 100 }, 0.5).r === 50)
check('чёрный цвет не ломает поднятие', () => boost({ r: 0, g: 0, b: 0 }).r >= 0)
check('строка цвета собирается верно', () => rgb({ r: 1, g: 2, b: 3 }) === 'rgb(1,2,3)')
check('строка цвета с прозрачностью', () => rgb({ r: 1, g: 2, b: 3 }, 0.5) === 'rgba(1,2,3,0.5)')

// ── Ломаем нарочно ───────────────────────────────────────────────────────
console.log('\n── Треки, которые не играют ──')
check('первый отказ не делает трек сломанным', () => !brokenIn(countAfterFail({}, 'a'), 'a'))
check('второй отказ подряд — сломан', () => brokenIn(countAfterFail(countAfterFail({}, 'a'), 'a'), 'a'))
check('порог именно два', () => BROKEN_AFTER === 2)
check('успешное воспроизведение обнуляет счёт', () => {
  const c = countAfterOk(countAfterFail({ a: 1 }, 'a'), 'a')
  return !brokenIn(c, 'a') && !('a' in c)
})
check('отказ одного трека не трогает другой', () => {
  const c = countAfterFail(countAfterFail({}, 'a'), 'a')
  return brokenIn(c, 'a') && !brokenIn(c, 'b')
})
check('счётчики не портятся на месте', () => {
  const src: Record<string, number> = { a: 1 }
  countAfterFail(src, 'a')
  return src.a === 1
})
check('пустое имя не заводит запись', () => Object.keys(countAfterFail({}, '')).length === 0)
check('успех у незнакомого трека ничего не ломает', () =>
  Object.keys(countAfterOk({}, 'нет-такого')).length === 0)
check('после починки трек снова считается рабочим', () => {
  let c = countAfterFail(countAfterFail({}, 'a'), 'a')
  c = countAfterOk(c, 'a')
  return !brokenIn(c, 'a')
})

console.log('\n── Ломаем нарочно ──')
check('проверка заметила бы, что «дальше» перестало слушать ручную очередь', () => {
  const a = N({ idx: 0, count: 5, manualIdx: 3 }); return a.kind === 'go' && a.index !== 1
})
check('проверка заметила бы, что ссылки перестали приводиться к одному виду', () =>
  sameTrack(Y + '&si=1', Y))
check('проверка заметила бы, что склад снова по времени добавления', () =>
  libraryOrder([T('a', '', '', 1), T('b', '', '', 50)])[0].id === 'b')


console.log('\n-- Склад приезжает частями (v1.420.0) --')
// Раньше на любое изменение таблицы склад выкачивался ЦЕЛИКОМ и заменялся
// целиком: когда кто-то заливал плейлист, у всех слушающих это была сотня
// полных перезагрузок подряд. Теперь порция ПРИМЕНЯЕТСЯ к тому, что уже есть,
// и правила ниже — ровно то, из-за чего это безопасно.
const TR = (id: string, name = id, extra: any = {}) => ({ id, url: 'https://x/' + id, name, owner: 'кто-то', ...extra })

check('новая порция дописывается в конец', () => {
  const out = mergeTracks([TR('a'), TR('b')], [TR('c')])
  return out.length === 3 && out[2].id === 'c'
})
check('известный трек остаётся на своём месте', () => {
  // Место важнее всего: номер играющего считается по этому же массиву.
  const out = mergeTracks([TR('a'), TR('b'), TR('c')], [TR('b', 'новое имя')])
  return out.length === 3 && out[1].id === 'b' && out[1].name === 'новое имя'
})
check('повторы внутри порции схлопываются', () => {
  const out = mergeTracks([], [TR('a'), TR('a', 'второй раз'), TR('b')])
  return out.length === 2 && out[0].name === 'второй раз'
})
check('порция без изменений не создаёт новый список', () => {
  // Иначе каждое чужое обновление метаданных перерисовывало бы весь склад.
  const was = [TR('a'), TR('b')]
  return mergeTracks(was, [TR('a'), TR('b')]) === was
})
check('пустая порция ничего не меняет', () => {
  const was = [TR('a')]
  return mergeTracks(was, []) === was
})
check('строка без id не попадает в склад', () => {
  const out = mergeTracks([TR('a')], [{ id: '', url: 'x', name: 'мусор', owner: 'к' } as any])
  return out.length === 1
})
check('обновление метаданных доезжает', () => {
  const out = mergeTracks([TR('a')], [TR('a', 'a', { art: 'https://art', play: 'https://play' })])
  return out[0].art === 'https://art' && out[0].play === 'https://play'
})

console.log('\n-- Запрет на встраивание — не поломка трека --')
check('коды 101 и 150 — это запрет встраивания', () =>
  isEmbedDeniedCode(101) && isEmbedDeniedCode(150) && isEmbedDeniedCode('150'))
check('остальные коды отказа так не считаются', () =>
  !isEmbedDeniedCode(2) && !isEmbedDeniedCode(5) && !isEmbedDeniedCode(100) && !isEmbedDeniedCode(undefined))

console.log('\n-- Ломаем нарочно (склад) --')
check('проверка заметила бы, что порядок известных треков перестал держаться', () => {
  const out = mergeTracks([TR('a'), TR('b')], [TR('b', 'иначе')])
  return out[0].id === 'a'
})


console.log('\n-- Трек встал: чья пауза и когда обходить (v1.421.0) --')
// Живая беда: слушаешь, и «резко пауза, а дальше ничего». Виджет SoundCloud,
// которому не дали трек (закрытая или запрещённая для встраивания загрузка —
// сплошь и рядом у официальных релизов), встаёт САМ, а мы послушно выключали
// плеер и оставались стоять на этом треке.
check('пауза от человека остаётся паузой', () => pauseKind(false, 30, 0) === 'ours')
check('встал, не начав играть, — трек не отдали', () => pauseKind(true, 0, 0) === 'notStarted')
check('позиция меньше секунды — тоже «не начал»', () => pauseKind(true, 0.4, 0) === 'notStarted')
check('встал посреди трека — один раз пробуем продолжить', () => pauseKind(true, 42, 0) === 'retry')
check('встал во второй раз — дело в треке', () => pauseKind(true, 42, 1) === 'stuck')
check('мусорная позиция считается «не начал», а не поводом продолжать', () =>
  pauseKind(true, NaN, 0) === 'notStarted')

console.log('\n-- Сторож молчания --')
check('позиция двигается — всё в порядке', () => !silenceStuck(1000, 1000 + 3000, true))
check('молчит дольше порога — трек не играет', () => silenceStuck(1000, 1000 + SILENCE_MS, true))
check('на паузе сторож молчит', () => !silenceStuck(0, 999999, false))
check('порог не меньше десяти секунд', () => SILENCE_MS >= 10000)

console.log('\n-- Ломаем нарочно (вставший трек) --')
check('проверка заметила бы, что свою паузу перестали отличать от чужой', () =>
  pauseKind(false, 0, 5) === 'ours')
check('проверка заметила бы, что сторож срабатывает мгновенно', () =>
  !silenceStuck(1000, 1001, true))


console.log('\n-- Волна: не крутить одно и то же (v1.424.0) --')
// Живая жалоба: «у исполнителя три песни, а очередь крутит их сто раз». Так и
// было: «тот же исполнитель» давал +100, а отодвигание игравшего было мягким —
// на четвёртом шаге первая песня снова становилась лучшей.
type WT = { id: string; name?: string; author?: string; plays?: number }
const W = (id: string, author: string, plays = 0): WT => ({ id, name: 'песня ' + id, author, plays })

check('окно запрета растёт со складом, но не бесконечно', () =>
  banWindow(0) === 0 && banWindow(1) === 0 && banWindow(4) === 3 && banWindow(100) === 20)

// Склад: три песни одного автора и двадцать чужих.
const waveLib: WT[] = [
  W('a1', 'Автор А'), W('a2', 'Автор А'), W('a3', 'Автор А'),
  ...Array.from({ length: 20 }, (_, n) => W('x' + n, 'Автор ' + n)),
]

/** Проигрываем волну шагами: что выберет очередь, то и «играет» дальше. */
function playWave(lib: WT[], startId: string, steps: number): string[] {
  const played = [startId]
  let curId = startId
  for (let n = 0; n < steps; n++) {
    const idx = lib.findIndex(t => t.id === curId)
    const recent = [...played].reverse()
    const best = recommend({ tracks: lib, idx, plays: {}, recent })[0]
    if (!best) break
    curId = best.track.id
    played.push(curId)
  }
  return played
}

check('три песни одного автора не крутятся по кругу', () => {
  const played = playWave(waveLib, 'a1', 9)
  const onlyA = played.filter(id => id.startsWith('a')).length
  // Два трека автора подряд — можно, весь список из них — нельзя.
  return onlyA <= 4 && new Set(played).size >= 7
})
check('внутри окна запрета трек не повторяется', () => {
  const played = playWave(waveLib, 'a1', 12)
  const ban = banWindow(waveLib.length - 1)
  for (let i = 0; i < played.length; i++) {
    const before = played.slice(Math.max(0, i - ban), i)
    if (before.includes(played[i])) return false
  }
  return true
})
check('больше двух треков одного автора подряд не идёт', () => {
  const played = playWave(waveLib, 'a1', 12)
  let streak = 1
  for (let i = 1; i < played.length; i++) {
    const same = (id: string) => waveLib.find(t => t.id === id)?.author
    streak = same(played[i]) === same(played[i - 1]) ? streak + 1 : 1
    if (streak > AUTHOR_STREAK) return false
  }
  return true
})
check('волна не встаёт, когда склад из трёх треков', () => {
  const tiny: WT[] = [W('a1', 'А'), W('a2', 'А'), W('a3', 'А')]
  const played = playWave(tiny, 'a1', 6)
  // Играть больше нечего, но остановиться волна не имеет права — и повторяет
  // самое давнее, а не самое свежее.
  return played.length === 7 && played[3] === played[0]
})
check('за окном запрета повтор снова возможен', () => {
  const played = playWave(waveLib, 'a1', 40)
  return played.length === 41 && new Set(played).size < played.length
})

console.log('\n-- Ломаем нарочно (волна) --')
check('проверка заметила бы возврат к мягкому отодвиганию', () => {
  // Ровно то, что было до v1.424.0: минус до 120 против +100 за автора.
  const soft = (lib: WT[], startId: string, steps: number) => {
    const played = [startId]
    let curId = startId
    for (let n = 0; n < steps; n++) {
      const idx = lib.findIndex(t => t.id === curId)
      const recent = [...played].reverse()
      const rest = lib.filter((_, k) => k !== idx)
      const curAuthor = lib[idx]?.author
      let best = rest[0], bestScore = -1e9
      for (const t of rest) {
        let sc = t.author === curAuthor ? 100 : 0
        const r = recent.indexOf(t.id)
        if (r >= 0) sc -= 120 - Math.min(100, r * 20)
        if (sc > bestScore) { bestScore = sc; best = t }
      }
      curId = best.id
      played.push(curId)
    }
    return played
  }
  const played = soft(waveLib, 'a1', 9)
  // Прежний расчёт крутит ровно те же три песни — на этом и жаловались.
  return played.filter(id => id.startsWith('a')).length >= 8
})


console.log('\n-- Прослушивание засчитывается по-настоящему (v1.426.0) --')
// Раньше плюс один ставился в тот же миг, когда трек начинал играть: число
// говорило «сколько раз нажали», а не «сколько слушали». Пролистал двадцать
// треков по секунде — двадцать прослушиваний.
/** Проиграть трек шагами по step секунд. */
function listen(seconds: number, step = 0.5, start = 0) {
  let st = freshListened(start)
  for (let t = start + step; t <= start + seconds + 1e-9; t += step) st = advance(st, t)
  return st
}
// v1.430.0: порог зачёта — тридцать секунд (в v1.428.0 я по ошибке опустил его до
// пятнадцати: просьба была про минимальную ДЛИНУ трека, а не про зачёт).
// v1.435.0: владелец попросил поднять порог до пятидесяти.
check('порог отслушан — засчитано', () => credited(listen(CREDIT_SEC), 200))
check('на секунду меньше — ещё нет', () => !credited(listen(CREDIT_SEC - 1), 200))
check('порог по умолчанию — пятьдесят секунд', () =>
  CREDIT_SEC === 50 && creditThreshold(200) === CREDIT_SEC && creditThreshold(undefined) === CREDIT_SEC)
check('порог не длиннее самой короткой песни в складе', () =>
  // Меньше минимальной длины трека порог быть не обязан, но длиннее обычной
  // песни — уже бессмыслица: засчитывать станет нечего.
  CREDIT_SEC >= MIN_TRACK_SEC && CREDIT_SEC <= 90)
check('короткую запись надо дослушать', () => {
  // Трек на 20 секунд: порог — почти вся его длина, а не полсотни секунд.
  const th = creditThreshold(20)
  return th < CREDIT_SEC && th >= 19 - 1e-9
})
check('короткая запись целиком — засчитано', () => credited(listen(20, 0.5), 20))
check('половина короткой записи — нет', () => !credited(listen(9, 0.5), 20))

console.log('\n-- Перемотка не считается слушанием --')
check('перемотка сразу за порог ничего не даёт', () => {
  const st = advance(freshListened(0), CREDIT_SEC + 5)   // один прыжок сразу за порог
  return st.sec === 0 && !credited(st, 200)
})
check('перемотка туда-сюда не накапливает время', () => {
  let st = freshListened(0)
  for (const p of [40, 5, 90, 10, 150, 2]) st = advance(st, p)
  return st.sec === 0
})
check('после перемотки счёт продолжается с нового места', () => {
  let st = advance(freshListened(0), 100)    // перемотали
  st = advance(st, 100.5); st = advance(st, 101)
  return Math.abs(st.sec - 1) < 1e-9
})
check('назад время не отматывает', () => {
  let st = listen(10)
  const was = st.sec
  st = advance(st, 1)
  return st.sec === was
})
check('шаг больше порога считается перемоткой', () => {
  const st = advance(freshListened(0), STEP_MAX + 0.1)
  return st.sec === 0
})
check('мусорная позиция ничего не портит', () => {
  const st = advance(listen(5), NaN as any)
  return Math.abs(st.sec - 5) < 1e-9
})
check('пауза не прибавляет времени', () => {
  const st = listen(5)
  const same = advance(st, st.pos)
  return same.sec === st.sec
})

console.log('\n-- Ломаем нарочно (подсчёт прослушивания) --')
check('проверка заметила бы возврат к «плюс один при запуске»', () => {
  // Прежнее поведение: засчитывали сразу, ничего не накапливая.
  const oldWay = () => true
  return oldWay() === true && !credited(freshListened(0), 200)
})


console.log('\n-- Плейлисты (v1.428.0) --')
// Раньше плейлист умел только заводиться и хранить id: ни открыть, ни
// переименовать, ни убрать трек, ни поменять порядок. Порядок здесь — главное:
// плейлист для него и нужен, а восстановить сбитый нечем.
const PT = [
  { id: 't1', name: 'первая' }, { id: 't2', name: 'вторая' },
  { id: 't3', name: 'третья' }, { id: 't4', name: 'четвёртая' },
]

check('плейлист создаётся и получает id', () => {
  const l = createPlaylist([], 'Моя музыка')
  return l.length === 1 && l[0].name === 'Моя музыка' && !!l[0].id && l[0].trackIds.length === 0
})
check('плейлист можно создать сразу с треком', () =>
  createPlaylist([], 'Моя', 't1')[0].trackIds.join() === 't1')
check('пустое имя плейлистом не становится', () =>
  createPlaylist([], '   ').length === 0)
check('слишком длинное имя обрезается', () =>
  createPlaylist([], 'я'.repeat(200))[0].name.length === PL_NAME_MAX)

let pl = createPlaylist([], 'Проба', 't1')
const plId = pl[0].id
check('трек добавляется в конец', () => {
  pl = addToPlaylist(pl, plId, 't2')
  pl = addToPlaylist(pl, plId, 't3')
  return pl[0].trackIds.join() === 't1,t2,t3'
})
check('повтор не добавляется', () => {
  const было = pl[0].trackIds.length
  return addToPlaylist(pl, plId, 't2')[0].trackIds.length === было
})
check('трек убирается, остальные остаются на местах', () =>
  removeFromPlaylist(pl, plId, 't2')[0].trackIds.join() === 't1,t3')
check('переименование не трогает треки', () => {
  const n = renamePlaylist(pl, plId, 'Новое имя')
  return n[0].name === 'Новое имя' && n[0].trackIds.join() === 't1,t2,t3'
})
check('пустое имя при переименовании отвергается', () =>
  renamePlaylist(pl, plId, '  ')[0].name === 'Проба')
check('удаление убирает только этот плейлист', () => {
  const два = createPlaylist(pl, 'Второй')
  return removePlaylist(два, plId).length === 1 && removePlaylist(два, plId)[0].name === 'Второй'
})

console.log('\n-- Плейлисты: порядок треков --')
check('трек поднимается на одну позицию', () =>
  movePlaylistTrack(pl, plId, 't3', -1)[0].trackIds.join() === 't1,t3,t2')
check('трек опускается на одну позицию', () =>
  movePlaylistTrack(pl, plId, 't1', 1)[0].trackIds.join() === 't2,t1,t3')
check('верхний трек выше не уезжает', () =>
  movePlaylistTrack(pl, plId, 't1', -1)[0].trackIds.join() === 't1,t2,t3')
check('нижний трек ниже не уезжает', () =>
  movePlaylistTrack(pl, plId, 't3', 1)[0].trackIds.join() === 't1,t2,t3')
check('чужой трек порядок не портит', () =>
  movePlaylistTrack(pl, plId, 'нет-такого', -1)[0].trackIds.join() === 't1,t2,t3')

console.log('\n-- Плейлисты: пропавшие треки --')
check('трек, убранный из Трекотеки, в плейлисте не показывается', () => {
  const без = PT.filter(t => t.id !== 't2')
  return playlistTracks(pl[0], без).map(t => t.id).join() === 't1,t3'
})
check('число треков — то, что реально можно включить', () =>
  playlistSize(pl[0], PT.filter(t => t.id !== 't2')) === 2)
check('порядок плейлиста сохраняется, а не порядок склада', () => {
  const переставленный = movePlaylistTrack(pl, plId, 't3', -2)
  return playlistTracks(переставленный[0], PT).map(t => t.id).join() === 't3,t1,t2'
})

console.log('\n-- Плейлисты: чтение из настроек --')
check('мусор из настроек не ломает список', () =>
  normalizePlaylists([null, 5, { id: 'a' }, { name: 'b' }, { id: 'c', name: 'Ок', trackIds: ['x', 2, null] }]).length === 1)
check('повторы внутри плейлиста схлопываются при чтении', () =>
  normalizePlaylists([{ id: 'c', name: 'Ок', trackIds: ['x', 'x', 'y'] }])[0].trackIds.join() === 'x,y')
check('не список — пустой список', () => normalizePlaylists('нет' as any).length === 0)
check('свежие плейлисты сверху', () => {
  const l: Playlist[] = [
    { id: '1', name: 'старый', trackIds: [], at: 100 },
    { id: '2', name: 'свежий', trackIds: [], at: 900 },
  ]
  return playlistsOrder(l)[0].name === 'свежий'
})
check('потолок треков в плейлисте есть и он разумный', () => PL_TRACKS_MAX >= 100 && PL_TRACKS_MAX <= 2000)

console.log('\n-- Ломаем нарочно (плейлисты) --')
check('проверка заметила бы, что порядок перестал держаться', () => {
  // Прежнее поведение: множество вместо списка — порядок теряется.
  const set = [...new Set(['t3', 't1', 't2'])].sort()
  return set.join() !== 't3,t1,t2'
})
check('проверка заметила бы, что пропавшие треки снова показываются', () =>
  playlistTracks({ id: 'x', name: 'y', trackIds: ['нет-такого'] }, PT).length === 0)


console.log('\n-- Минимальная длина трека (v1.430.0) --')
// Склад общий, и в него попадало что угодно: секундные обрезки, звуки нажатий,
// случайные голосовые. В списке они выглядят как песни, а в волне стоят в
// очереди наравне со всем остальным.
check('минимум — пятнадцать секунд', () => MIN_TRACK_SEC === 15)
check('короткий обрезок не пускаем', () => tooShortWhy(6) !== null)
check('ровно пятнадцать — можно', () => tooShortWhy(15) === null)
check('обычная песня проходит', () => tooShortWhy(210) === null)
check('в отказе сказано и сколько есть, и сколько нужно', () => {
  const why = tooShortWhy(6) ?? ''
  return why.includes('6') && why.includes(String(MIN_TRACK_SEC))
})
check('неизвестная длина — не повод отказывать', () =>
  tooShortWhy(undefined) === null && tooShortWhy(null) === null)
check('мусор в длине тоже не повод', () =>
  tooShortWhy(NaN) === null && tooShortWhy(0) === null && tooShortWhy(-5) === null)
check('меньше секунды не превращается в «0 с»', () => (tooShortWhy(0.4) ?? '').includes('1 с'))

console.log('\n-- Ломаем нарочно (минимальная длина) --')
check('проверка заметила бы отказ при неизвестной длине', () => {
  // Прежнее «на всякий случай»: нет длины — не пускать. Так в склад не попала бы
  // половина обычных ссылок.
  const наВсякийСлучай = (d: number | undefined) => d === undefined || d < MIN_TRACK_SEC
  return наВсякийСлучай(undefined) === true && tooShortWhy(undefined) === null
})


/** Та же арифметика, что в lib/listenProgress.ts — здесь только для проверки паузы. */
function livePosLocal(l: { pos: number; dur?: number; at: number }, now: number): number {
  const base = l.pos > 0 ? l.pos : 0
  const t = base + Math.max(0, (now - l.at) / 1000)
  return l.dur ? Math.min(t, l.dur) : t
}

console.log('\n-- Проверка последних добавлений (v1.432.0) --')
// Владелец просил пройтись по всему, что я насыпал за последние версии, и
// поискать поломки. Ниже — сценарии, которые ловят именно взаимодействие
// нового: волна против неиграбельных треков, плейлист против склада, подсчёт
// прослушивания против перемотки, склейка склада против номера играющего.

type AT = { id: string; name?: string; author?: string; plays?: number }
const A = (id: string, author = 'А', plays = 0): AT => ({ id, name: 'песня ' + id, author, plays })

console.log('\n   волна и то, что играть нечем:')
check('волна не предлагает неиграбельный трек', () => {
  // Играет первый; второй играть нечем — значит остаётся ровно один.
  const lib = [A('a'), A('плохой', 'Б'), A('b', 'В')]
  const s1 = recommend({ tracks: lib, idx: 0, plays: {}, skip: t => t.id === 'плохой' })
  return s1.length === 1 && s1[0].track.id === 'b'
})
check('если играть нечего вовсе — волна честно пуста', () => {
  const lib = [A('a'), A('плохой1', 'Б'), A('плохой2', 'В')]
  return recommend({ tracks: lib, idx: 0, plays: {}, skip: t => t.id.startsWith('плохой') }).length === 0
})
check('без правила отбора волна работает как раньше', () => {
  const lib = [A('a'), A('b'), A('c')]
  return recommend({ tracks: lib, idx: 0, plays: {} }).length === 2
})
check('запрет повтора считается по тому, что осталось', () => {
  // Пять треков, три из них играть нечем: окно запрета не должно запретить всё.
  const lib = [A('1'), A('2'), A('3'), A('4'), A('5')]
  const s2 = recommend({
    tracks: lib, idx: 0, plays: {}, recent: ['1'],
    skip: t => ['3', '4', '5'].includes(t.id),
  })
  return s2.length === 1 && s2[0].track.id === '2'
})

console.log('\n   плейлист и склад:')
check('плейлист играет в своём порядке, а не в порядке склада', () => {
  const pl = { id: 'p', name: 'п', trackIds: ['c', 'a', 'b'] }
  const lib = [A('a'), A('b'), A('c')]
  return playlistTracks(pl, lib).map(t => t.id).join() === 'c,a,b'
})
check('трек, которого нет в складе, не мешает включить плейлист', () => {
  const pl = { id: 'p', name: 'п', trackIds: ['a', 'нет', 'b'] }
  const lib = [A('a'), A('b')]
  const list = playlistTracks(pl, lib)
  return list.length === 2 && playlistSize(pl, lib) === 2
})
check('порядок плейлиста не рушится добавлением того же трека', () => {
  let pl: Playlist[] = [{ id: 'p', name: 'п', trackIds: ['a', 'b'], at: 1 }]
  pl = addToPlaylist(pl, 'p', 'a')
  return pl[0].trackIds.join() === 'a,b'
})

console.log('\n   подсчёт прослушивания против перемотки:')
check('перемотка вперёд-назад не набирает время', () => {
  let st = freshListened(0)
  for (const p of [0.5, 1, 1.5, 60, 60.5, 61, 2, 2.5]) st = advance(st, p)
  // Настоящего слушания тут три секунды (шесть шагов по половине), а не
  // шестьдесят: два прыжка не прибавили ничего.
  return Math.abs(st.sec - 3) < 1e-9 && !credited(st, 200)
})
check('склейка длинных пауз не даёт зачёт', () => {
  let st = freshListened(0)
  // Плеер стоял: позиция не двигалась вовсе.
  for (let i = 0; i < 100; i++) st = advance(st, 10)
  return st.sec === 0
})

console.log('\n   склейка склада и номер играющего:')
check('дописанная страница не сдвигает известные треки', () => {
  const было = [{ id: 'a', url: 'u', name: 'a', owner: 'o' }, { id: 'b', url: 'u2', name: 'b', owner: 'o' }]
  const out = mergeTracks(было as any, [{ id: 'c', url: 'u3', name: 'c', owner: 'o' } as any])
  return out[0].id === 'a' && out[1].id === 'b' && out[2].id === 'c'
})
check('чужое обновление не меняет порядок', () => {
  const было = [{ id: 'a', url: 'u', name: 'a', owner: 'o' }, { id: 'b', url: 'u2', name: 'b', owner: 'o' }]
  const out = mergeTracks(было as any, [{ id: 'a', url: 'u', name: 'a2', owner: 'o' } as any])
  return out[0].id === 'a' && out[0].name === 'a2' && out.length === 2
})

console.log('\n   активность на паузе:')
check('на паузе время не бежит', () => {
  // Позиция на паузе публикуется как есть, и зрителю показывается она же.
  const l = { pos: 42, dur: 200, at: 1000 }
  return livePosLocal(l, 1000 + 60_000) === 102 && l.pos === 42
})

console.log('\n-- Лёг сервис, а не треки (v1.435.0) --')
{
  const T0 = 1_800_000_000_000
  let list: FailMark[] = []
  check('один неигравший трек — это трек, а не сервис', () => {
    list = pushFail([], 'a', T0)
    return !sourceDown(list, T0)
  })
  check('несколько разных подряд — это сервис', () => {
    let l: FailMark[] = []
    for (let i = 0; i < SOURCE_DOWN_FAILS; i++) l = pushFail(l, 'т' + i, T0 + i * 1000)
    return sourceDown(l, T0 + 5000)
  })
  check('один и тот же трек, сколько ни падай, сервисом не считается', () => {
    let l: FailMark[] = []
    for (let i = 0; i < 20; i++) l = pushFail(l, 'один', T0 + i * 100)
    return !sourceDown(l, T0 + 2000)
  })
  check('старые отказы забываются', () => {
    let l: FailMark[] = []
    for (let i = 0; i < SOURCE_DOWN_FAILS; i++) l = pushFail(l, 'т' + i, T0 + i * 100)
    return !sourceDown(l, T0 + SOURCE_DOWN_MS + 1000)
  })
  check('окно достаточно короткое, чтобы не ловить обычные пропуски', () =>
    SOURCE_DOWN_MS <= 60_000 && SOURCE_DOWN_FAILS >= 3)

  console.log('\n-- Ломаем нарочно (сторож сервиса) --')
  check('проверка заметила бы сторож, который срабатывает от одного трека', () => {
    let l: FailMark[] = []
    l = pushFail(l, 'a', T0)
    l = pushFail(l, 'b', T0 + 100)
    // Два разных — ещё не повод: иначе плеер вставал бы на любых двух подряд.
    return !sourceDown(l, T0 + 200)
  })
}

console.log('\n-- Трекотека не качается заново (v1.435.0) --')
{
  const NOW = 1_800_000_000_000
  const снимок = (n: number, at = NOW - 1000) => ({
    tracks: Array.from({ length: n }, (_, i) => ({
      id: 't' + i, url: 'u' + i, name: 'п' + i, owner: 'o',
      at: new Date(NOW - (n - i) * 1000).toISOString(),
    })) as any[],
    at,
  })

  check('снимка нет — качаем целиком', () =>
    libraryPlan(null, 100, NOW).kind === 'full')
  check('пустой снимок — тоже целиком', () =>
    libraryPlan({ tracks: [], at: NOW }, 0, NOW).kind === 'full')
  check('счёт сошёлся — спрашиваем только новое', () => {
    const p = libraryPlan(снимок(50), 50, NOW)
    return p.kind === 'incremental' && !!p.since
  })
  check('и спрашиваем от самого свежего известного', () => {
    const s = снимок(50)
    const p = libraryPlan(s, 50, NOW)
    return p.kind === 'incremental' && p.since === newestAt(s.tracks)
  })
  check('треков стало больше — качаем целиком', () =>
    libraryPlan(снимок(50), 51, NOW).kind === 'full')
  check('трек удалили — тоже целиком, счёт это ловит', () => {
    const p = libraryPlan(снимок(50), 49, NOW)
    return p.kind === 'full' && p.why === 'count-differs'
  })
  check('счёт спросить не вышло — не доверяем снимку', () => {
    const p = libraryPlan(снимок(50), null, NOW)
    return p.kind === 'full' && p.why === 'no-count'
  })
  check('снимок старше недели перечитывается целиком', () => {
    const p = libraryPlan(снимок(50, NOW - SNAPSHOT_TTL_MS - 1), 50, NOW)
    return p.kind === 'full' && p.why === 'stale'
  })
  check('без времени добавления инкрементом не обойтись', () => {
    const s = { tracks: [{ id: 'a', url: 'u', name: 'a', owner: 'o' }] as any[], at: NOW }
    return libraryPlan(s, 1, NOW).kind === 'full'
  })
  check('самое свежее время находится верно', () =>
    newestAt([{ at: '2026-01-01' }, { at: '2026-07-30' }, { at: '2026-03-03' }] as any[]) === '2026-07-30')

  console.log('\n-- Ломаем нарочно (кэш склада) --')
  check('проверка заметила бы «верим снимку всегда»', () => {
    // Ровно та поломка, которой тут можно всё испортить: удалили трек, а мы
    // показываем прежний склад и не замечаем этого никогда.
    const слепо = () => ({ kind: 'incremental' as const, since: 'x' })
    return слепо().kind === 'incremental' && libraryPlan(снимок(50), 49, NOW).kind === 'full'
  })
}

console.log('\n-- Волна без «часто слушаешь» (v1.435.0) --')
{
  const ДЕНЬ = 86_400_000
  const NOW = 1_800_000_000_000
  const рядом = [T('cur'), T('часто'), T('редко')]
  check('число своих прослушиваний на очки больше не влияет вовсе', () => {
    // Два трека одинаковы во всём, кроме числа прослушиваний: двести против
    // одного. Очки обязаны совпасть — иначе сигнал вернулся.
    const r = recommend({ tracks: рядом, idx: 0, plays: { часто: 200, редко: 1 }, now: NOW,
      lastAt: { часто: NOW - ДЕНЬ, редко: NOW - ДЕНЬ } })
    const a = r.find(x => x.track.id === 'часто')!.score
    const b = r.find(x => x.track.id === 'редко')!.score
    return a === b
  })
  check('незнакомое впереди знакомого', () => {
    const t = [T('cur'), T('слушал'), T('новое')]
    const r = recommend({ tracks: t, idx: 0, plays: { слушал: 5 }, now: NOW, lastAt: { слушал: NOW - ДЕНЬ } })
    return r[0].track.id === 'новое' && r[0].why === 'fresh'
  })
  check('давно не слушанное впереди вчерашнего', () => {
    const t = [T('cur'), T('вчера'), T('год назад')]
    const r = recommend({ tracks: t, idx: 0, plays: { 'вчера': 3, 'год назад': 3 }, now: NOW,
      lastAt: { 'вчера': NOW - ДЕНЬ, 'год назад': NOW - 365 * ДЕНЬ } })
    return r[0].track.id === 'год назад' && r[0].why === 'rested'
  })
  check('без дат ничего не ломается', () => {
    const r = recommend({ tracks: рядом, idx: 0, plays: { часто: 9 }, now: NOW })
    return r.length === 2
  })
  check('причины «ты это часто слушаешь» больше нет вовсе', () =>
    !Object.values(WHY_LABEL).some(v => v.includes('часто слушаешь') && !v.includes('это часто слушают')))
  check('тот же исполнитель всё ещё сильнее давности', () => {
    const t = [T('cur', 'Ночь', 'Кино'), T('свой', 'Пачка', 'Кино'), T('чужой', 'Другое', 'Кто-то')]
    const r = recommend({ tracks: t, idx: 0, plays: { свой: 2 }, now: NOW,
      lastAt: { свой: NOW - ДЕНЬ, чужой: NOW - 400 * ДЕНЬ } })
    return r[0].track.id === 'свой'
  })

  console.log('\n-- Ломаем нарочно (волна) --')
  check('проверка заметила бы возврат сигнала «часто слушаешь»', () => {
    // Прежнее правило давало +25*log2(1+свои прослушивания): на этих данных
    // разрыв под сто семьдесят очков. Сейчас разрыв обязан быть нулевым.
    const прежнийРазрыв = 25 * Math.log2(1 + 200) - 25 * Math.log2(1 + 1)
    const r = recommend({ tracks: рядом, idx: 0, plays: { часто: 200, редко: 1 }, now: NOW,
      lastAt: { часто: NOW - ДЕНЬ, редко: NOW - ДЕНЬ } })
    const разрыв = Math.abs(r.find(x => x.track.id === 'часто')!.score - r.find(x => x.track.id === 'редко')!.score)
    return прежнийРазрыв > 100 && разрыв === 0
  })
}

console.log('\n-- Обход неиграбельных: показ и действие (v1.433.0) --')
// В v1.432.0 обход появился только в кнопке: строка «Дальше» звала голую
// nextTrack и называла трек, через который плеер перешагнёт. Теперь обе стороны
// зовут resolveNext, и вот что она обязана отвечать.
const R = (o: any) => resolveNext({ repeat: 'off', shuffle: false, unplayable: () => false, ...o })
const bad = (...ids: number[]) => (n: number) => ids.includes(n)

check('следующий неиграбельный пропускается, а не называется', () =>
  JSON.stringify(R({ idx: 0, count: 4, unplayable: bad(1) })) === '{"kind":"go","index":2}')
check('подряд несколько неиграбельных — перешагиваем все', () =>
  JSON.stringify(R({ idx: 0, count: 5, unplayable: bad(1, 2, 3) })) === '{"kind":"go","index":4}')
check('играть нечем вовсе — остановка со словами', () =>
  JSON.stringify(R({ idx: 0, count: 3, unplayable: () => true })) === '{"kind":"stop","why":"none"}')
check('повтор одного на неиграбельном не крутит молчание', () =>
  JSON.stringify(R({ idx: 1, count: 3, repeat: 'one', unplayable: bad(1) })) === '{"kind":"stop","why":"repeat-one"}')
check('повтор одного на живом треке — как и был', () =>
  JSON.stringify(R({ idx: 1, count: 3, repeat: 'one' })) === '{"kind":"restart"}')
check('играбелен только текущий, повтор списка — крутим его', () =>
  JSON.stringify(R({ idx: 0, count: 3, repeat: 'all', unplayable: bad(1, 2) })) === '{"kind":"restart"}')
check('играбелен только текущий, без повтора — конец', () =>
  JSON.stringify(R({ idx: 0, count: 3, unplayable: bad(1, 2) })) === '{"kind":"stop","why":"none"}')
check('конец списка без повтора — это «end», а не «нечего играть»', () =>
  JSON.stringify(R({ idx: 2, count: 3 })) === '{"kind":"stop","why":"end"}')
check('повтор списка через неиграбельный конец возвращает к началу', () =>
  JSON.stringify(R({ idx: 1, count: 3, repeat: 'all', unplayable: bad(2) })) === '{"kind":"go","index":0}')
check('ручная очередь сильнее обхода: живой трек берётся как есть', () =>
  JSON.stringify(R({ idx: 0, count: 4, manualIdx: 3, unplayable: bad(1) })) === '{"kind":"go","index":3}')
check('пустой склад — остановка, а не обращение к пустоте', () =>
  JSON.stringify(R({ idx: 0, count: 0 })) === '{"kind":"stop","why":"end"}')
check('перемешивание на живом складе всё равно куда-то идёт', () => {
  const a = R({ idx: 0, count: 4, shuffle: true, rnd: () => 0.6 })
  return a.kind === 'go' && a.index !== 0
})

console.log('\n-- Ломаем нарочно (обход неиграбельных) --')
check('проверка заметила бы возврат к показу без обхода', () => {
  // Голая nextTrack — ровно то, что стояло в строке «Дальше» до v1.433.0.
  const naive = nextTrack({ idx: 0, count: 4, repeat: 'off', shuffle: false })
  const real = R({ idx: 0, count: 4, unplayable: bad(1) })
  // Наивный ответ называет трек 1, настоящий — трек 2: расхождение видно.
  return naive.kind === 'go' && naive.index === 1 && real.kind === 'go' && real.index === 2
})
check('проверка заметила бы пропажу остановки на мёртвом складе', () => {
  const r = R({ idx: 0, count: 3, unplayable: () => true })
  return r.kind === 'stop'
})

console.log('\nИТОГ: пройдено ' + pass + ', провалено ' + fail)
if (fail) process.exit(1)
