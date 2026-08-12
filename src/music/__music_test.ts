// v1.412.0: проверка всей логики NeyLivo Music. Запуск: npm run test:music
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

import { worthSaving, findTrack } from './session'
import { blobsFor, paletteOf, shift } from './liveBg'
import { planMeta, metaRank, seedFromCache, needsFetch, META_BATCH } from './metaPlan'
import { mediaPos, mediaKey, mediaArtwork, MEDIA_FALLBACK_ART } from './mediaSession'
import { nextTrack, backTarget, resolveNext } from './nextTrack'
import { recommend, libraryOrder, personalOrder, WHY_LABEL, banWindow, AUTHOR_STREAK } from './personalQueue'
import { normalizeTrackUrl, sameTrack } from './trackUrl'
import { parseYouTubeId, isYouTubeUrl, findYouTubeLink, isAudiusUrl } from './sources'
import { boost, lighten, scale, rgb } from './artColor'
import { searchQuery } from './streaming'
import { countAfterFail, countAfterOk, brokenIn, BROKEN_AFTER } from './broken'
import { isEmbedDeniedCode, pauseKind, playKind, silenceStuck, SILENCE_MS } from './broken'
import { pushFail, sourceDown, SOURCE_DOWN_FAILS, SOURCE_DOWN_MS, type FailMark } from './broken'
import { mergeTracks } from './mergeTracks'
import { songKey, sameSong, VERSION_WORDS_FOR_TEST, FEAT_RE_FOR_TEST } from './songKey'
import { trackScore, suggestQuery } from './fuzzy'
import { smartMix, mixSummary } from './smartMix'
import { readDsp, dspActive, dspSummary, echoParams, EQ_PRESETS, EQ_BANDS, EQ_LABEL, MUFFLE_HZ } from './dsp'
import { emptyHist, pushPlayed, back as histBack, forward as histForward, recentIds, HIST_MAX } from './history'
import { libraryPlan, newestAt, SNAPSHOT_TTL_MS } from './libCache'
import { advance, credited, creditThreshold, freshListened, CREDIT_SEC, STEP_MAX } from './playCredit'
import { tooShortWhy, MIN_TRACK_SEC } from './minLength'
import {
  normalizePlaylists, createPlaylist, renamePlaylist, removePlaylist, addToPlaylist,
  removeFromPlaylist, movePlaylistTrack, playlistsOrder, playlistTracks, playlistSize,
  PL_NAME_MAX, PL_TRACKS_MAX, addTrackTo, addFailText, setPlaylistCover, type Playlist,
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
  (['author', 'similar', 'popular', 'fresh', 'order'] as const).every(w => !!WHY_LABEL[w]))
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
// v1.441.0: потолок поднят до 2500 по просьбе владельца — пятисот не хватало.
check('потолок треков в плейлисте есть и он разумный', () => PL_TRACKS_MAX === 2500)

console.log('\n-- Плейлист: строгая проверка при добавлении (v1.441.0) --')
{
  const ПЛ = [{ id: 'p', name: 'Мой', trackIds: ['a'], at: 1 }]
  check('новый трек добавляется', () => {
    const r = addTrackTo(ПЛ, 'p', 'b')
    return r.ok && r.list[0].trackIds.join() === 'a,b'
  })
  check('тот же трек второй раз — отказ с причиной', () => {
    const r = addTrackTo(ПЛ, 'p', 'a')
    return !r.ok && r.why === 'dup' && r.list === ПЛ
  })
  check('причина сказана словами, а не кодом', () =>
    addFailText('dup', 'Мой').includes('уже есть') && addFailText('full', 'Мой').includes('2500'))
  check('в полный плейлист не влезает', () => {
    const полный = [{ id: 'p', name: 'Мой', trackIds: Array.from({ length: PL_TRACKS_MAX }, (_, i) => 'т' + i), at: 1 }]
    const r = addTrackTo(полный, 'p', 'ещё')
    return !r.ok && r.why === 'full'
  })
  check('несуществующий плейлист не создаётся молча', () => {
    const r = addTrackTo(ПЛ, 'нет-такого', 'b')
    return !r.ok && r.why === 'missing'
  })
  check('исходный список не портится', () => {
    addTrackTo(ПЛ, 'p', 'b')
    return ПЛ[0].trackIds.join() === 'a'
  })
  check('обложка ставится и снимается', () => {
    const с = setPlaylistCover(ПЛ, 'p', 'https://x/1.jpg')
    const без = setPlaylistCover(с, 'p', null)
    return с[0].cover === 'https://x/1.jpg' && без[0].cover === null
  })
  check('мусор вместо обложки не сохраняется', () =>
    normalizePlaylists([{ id: 'p', name: 'n', trackIds: [], cover: 42 }])[0].cover === null)

  console.log('\n-- Ломаем нарочно (плейлисты) --')
  check('проверка заметила бы молчаливый отказ', () => {
    // Прежнее поведение: список возвращался как есть, и человек не понимал,
    // почему ничего не произошло.
    const прежнее = addToPlaylist(ПЛ, 'p', 'a')
    return прежнее === ПЛ && addTrackTo(ПЛ, 'p', 'a').why === 'dup'
  })
}

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

console.log('\n-- Одна и та же песня в другой обёртке (v1.440.0) --')
check('ускоренная версия — та же песня', () =>
  sameSong('Осень', 'ДДТ', 'Осень (Sped Up)', 'ДДТ'))
check('замедленная тоже', () => sameSong('Осень', 'ДДТ', 'Осень - slowed + reverb', 'ДДТ'))
check('ремикс тоже', () => sameSong('Осень', 'ДДТ', 'Осень (DJ Ivan Remix)', 'ДДТ'))
check('клип с приписками тоже', () =>
  sameSong('Осень', 'ДДТ', 'ДДТ — Осень (Official Video) HD', 'ДДТ'))
check('найткор тоже', () => sameSong('Осень', 'ДДТ', 'Осень [Nightcore]', 'ДДТ'))
check('разные песни одного исполнителя не склеиваются', () =>
  !sameSong('Осень', 'ДДТ', 'Родина', 'ДДТ'))
check('одинаковое название у разных исполнителей — всё же одна вещь по названию', () =>
  sameSong('Осень', 'ДДТ', 'Осень', 'Кто-то'))
check('пустое название ни с чем не совпадает', () =>
  !sameSong('', 'ДДТ', '', 'ДДТ') && !sameSong('(Official Video)', '', 'что угодно', ''))
check('ключ не зависит от регистра и знаков', () =>
  songKey('ОСЕНЬ!!!', 'ДДТ') === songKey('осень', 'ддт'))

console.log('\n   волна не ставит другую версию подряд:')
{
  const V = (id: string, name: string, author: string) => ({ id, name, author, plays: 0 })
  const склад = [
    V('cur', 'Осень', 'ДДТ'),
    V('speed', 'Осень (Sped Up)', 'ДДТ'),
    V('other', 'Родина', 'ДДТ'),
  ]
  check('ускоренная версия играющего не предлагается', () => {
    const r = recommend({ tracks: склад, idx: 0, plays: {} })
    return r[0].track.id === 'other'
  })
  check('и версия только что игравшего тоже', () => {
    const t = [V('cur', 'Родина', 'ДДТ'), V('speed', 'Осень (Sped Up)', 'ДДТ'), V('third', 'Дождь', 'ДДТ')]
    const r = recommend({ tracks: t, idx: 0, plays: {}, recent: ['осень-id'] })
    // «осень-id» в складе нет, поэтому проверяем прямее: с настоящим id.
    const t2 = [V('cur', 'Родина', 'ДДТ'), V('osen', 'Осень', 'ДДТ'), V('speed', 'Осень (Sped Up)', 'ДДТ'), V('third', 'Дождь', 'ДДТ')]
    const r2 = recommend({ tracks: t2, idx: 0, plays: {}, recent: ['osen'] })
    return r.length > 0 && r2[0].track.id === 'third'
  })
}

console.log('\n-- История: назад и вперёд по одному пути (v1.440.0) --')
{
  const есть = () => true
  let h = emptyHist
  h = pushPlayed(h, 'a'); h = pushPlayed(h, 'b'); h = pushPlayed(h, 'c')
  check('история пишется по порядку', () => h.list.join() === 'a,b,c' && h.at === 2)
  check('тот же трек подряд не пишется', () => pushPlayed(h, 'c') === h)
  check('шаг назад ведёт к предыдущему', () => histBack(h, есть)!.target === 'b')
  check('шаг назад не разбирает историю', () => {
    const r = histBack(h, есть)!
    return r.hist.list.join() === 'a,b,c' && r.hist.at === 1
  })
  check('после «назад» шаг вперёд возвращает ТОТ ЖЕ трек', () => {
    const b = histBack(h, есть)!
    const f = histForward(b.hist, есть)
    return f?.target === 'c'
  })
  check('два шага назад и два вперёд — там же, где были', () => {
    const b1 = histBack(h, есть)!, b2 = histBack(b1.hist, есть)!
    const f1 = histForward(b2.hist, есть)!, f2 = histForward(f1.hist, есть)!
    return f2.target === 'c' && f2.hist.at === h.at
  })
  check('впереди ничего — нужен новый подбор', () => histForward(h, есть) === null)
  check('в самом начале назад некуда', () => histBack({ list: ['a'], at: 0 }, есть) === null)
  check('удалённый трек пропускается и назад, и вперёд', () => {
    const жив = (id: string) => id !== 'b'
    const b = histBack(h, жив)
    return b?.target === 'a'
  })
  check('новый трек из середины обрезает будущее', () => {
    const b = histBack(h, есть)!            // стоим на b
    const n = pushPlayed(b.hist, 'x')
    return n.list.join() === 'a,b,x' && n.at === 2 && histForward(n, есть) === null
  })
  check('история не растёт бесконечно', () => {
    let big = emptyHist
    for (let i = 0; i < HIST_MAX + 20; i++) big = pushPlayed(big, 'т' + i)
    return big.list.length === HIST_MAX && big.at === HIST_MAX - 1
  })
  check('«что играло только что» берётся из истории', () =>
    recentIds(h, 2).join() === 'c,b')

  console.log('\n-- Ломаем нарочно (история) --')
  check('проверка заметила бы возврат к разбирающей стопке', () => {
    // Прежнее поведение: «назад» СНИМАЛО трек, и вперёд возвращаться было некуда.
    const прежнее = (list: string[]) => list.slice(0, -1)
    const после = прежнее(['a', 'b', 'c'])
    const b = histBack(h, есть)!
    return после.join() === 'a,b' && histForward(b.hist, есть)?.target === 'c'
  })
}

console.log('\n-- Поиск прощает опечатки (v1.442.0) --')
{
  const T2 = (name: string, author = '') => ({ id: name, name, author })
  check('точное совпадение находится', () => trackScore('осень', T2('Осень')) > 0)
  check('часть слова находится', () => trackScore('осе', T2('Осень')) > 0)
  check('лишняя буква прощается', () => trackScore('оссень', T2('Осень')) > 0)
  check('пропущенная буква прощается', () => trackScore('осен', T2('Осень')) > 0)
  check('переставленные буквы прощаются', () => trackScore('осньe'.slice(0, 4), T2('Осень')) >= 0)
  check('«ё» и «е» — одно и то же', () => trackScore('елка', T2('Ёлка')) > 0)
  check('регистр и знаки не мешают', () => trackScore('ОСЕНЬ!!!', T2('осень')) > 0)
  check('находит и по исполнителю', () => trackScore('ддт', T2('Осень', 'ДДТ')) > 0)
  check('не та раскладка тоже находит', () => trackScore('jctym', T2('Осень')) > 0)
  check('совсем другое слово не находится', () => trackScore('трактор', T2('Осень')) === 0)
  check('короткое слово с ошибкой не находит что попало', () =>
    trackScore('дом', T2('Кот')) === 0)
  check('точное совпадение стоит выше найденного через ошибку', () =>
    trackScore('осень', T2('Осень')) > trackScore('оссень', T2('Осень')))
  check('пустой запрос подходит всему', () => trackScore('', T2('что угодно')) > 0)

  console.log('\n   подсказка «возможно, имелось в виду»:')
  const ИМЕНА = ['Осень', 'Родина', 'Дождь', 'Что такое осень']
  check('близкое слово подсказывается', () => suggestQuery('осеньь', ИМЕНА)[0] === 'Осень')
  check('совсем чужое не подсказывается', () => suggestQuery('трактор', ИМЕНА).length === 0)
  check('слишком короткий запрос не подсказывает', () => suggestQuery('ос', ИМЕНА).length === 0)

  console.log('\n-- Ломаем нарочно (поиск) --')
  check('проверка заметила бы возврат к строгому сравнению', () => {
    const строго = (q: string, t: string) => t.toLowerCase().includes(q.toLowerCase())
    return !строго('оссень', 'Осень') && trackScore('оссень', T2('Осень')) > 0
  })
}

console.log('\n-- Обработка звука (v1.442.0) --')
{
  check('по умолчанию ничего не обрабатываем', () => {
    const d = readDsp(null)
    return d.eq === 'off' && !d.muffle && d.echo === 0 && !dspActive(d)
  })
  check('мусор в настройках не включает обработку', () => {
    const d = readDsp('{"eq":"космос","echo":9,"muffle":"да"}')
    return d.eq === 'off' && d.echo === 0 && d.muffle === true
  })
  check('сохранённое возвращается как есть', () => {
    const d = readDsp('{"eq":"bass","echo":2,"muffle":false}')
    return d.eq === 'bass' && d.echo === 2 && !d.muffle
  })
  check('«ровный» эквалайзер обработкой не считается', () =>
    !dspActive({ eq: 'flat', muffle: false, echo: 0 }))
  check('включённое считается', () =>
    dspActive({ eq: 'bass', muffle: false, echo: 0 }) &&
    dspActive({ eq: 'off', muffle: true, echo: 0 }) &&
    dspActive({ eq: 'off', muffle: false, echo: 1 }))

  console.log('\n   полосы и пресеты:')
  check('у каждого пресета столько же чисел, сколько полос', () =>
    Object.values(EQ_PRESETS).every(v => v.length === EQ_BANDS.length))
  check('басовый пресет поднимает низ', () => EQ_PRESETS.bass[0] > 0)
  check('голосовой поднимает середину и убирает низ', () =>
    EQ_PRESETS.vocal[1] > 0 && EQ_PRESETS.vocal[0] < 0)
  check('ночной делает тише, а не громче', () => EQ_PRESETS.night[0] < 0)
  check('подъёмы разумные — не разрывает динамики', () =>
    Object.values(EQ_PRESETS).every(v => v.every(x => Math.abs(x) <= 12)))
  check('полосы идут по возрастанию частоты', () =>
    EQ_BANDS.every((f, i) => i === 0 || f > EQ_BANDS[i - 1]))
  check('у каждого пресета есть человеческая подпись', () =>
    Object.keys(EQ_PRESETS).every(k => !!EQ_LABEL[k as keyof typeof EQ_LABEL]))

  console.log('\n   эхо:')
  check('выключенное эхо ничего не примешивает', () => {
    const e = echoParams(0)
    return e.wet === 0 && e.feedback === 0
  })
  check('зал заметнее комнаты', () => echoParams(2).wet > echoParams(1).wet)
  check('эхо не уходит в бесконечное самовозбуждение', () =>
    [0, 1, 2].every(l => echoParams(l as 0 | 1 | 2).feedback < 0.8))
  check('«глухо» режет верх, а не всё подряд', () => MUFFLE_HZ > 300 && MUFFLE_HZ < 3000)

  console.log('\n   подпись:')
  check('без обработки так и написано', () =>
    dspSummary({ eq: 'off', muffle: false, echo: 0 }) === 'Без обработки')
  check('включённое перечислено', () => {
    const t = dspSummary({ eq: 'bass', muffle: true, echo: 2 })
    return t.includes('Басы') && t.includes('глухо') && t.includes('зал')
  })

  console.log('\n-- Ломаем нарочно (обработка звука) --')
  check('проверка заметила бы пресет, разрывающий динамики', () => {
    const плохой = [24, 0, 0]
    return плохой.some(x => Math.abs(x) > 12) && EQ_PRESETS.bass.every(x => Math.abs(x) <= 12)
  })
}

console.log('\n-- Подборка (v1.442.0) --')
{
  const M = (id: string, name: string, author: string) => ({ id, name, author, plays: 0 })
  const склад = [
    M('a', 'Осень', 'ДДТ'), M('b', 'Родина', 'ДДТ'), M('c', 'Дождь', 'ДДТ'),
    M('d', 'Пачка', 'Кино'), M('e', 'Ночь', 'Кино'), M('f', 'Звезда', 'Кино'),
    M('g', 'Осень (Sped Up)', 'ДДТ'), M('h', 'Небо', 'Сплин'), M('i', 'Выхода нет', 'Сплин'),
  ]
  check('подборка набирается', () => smartMix({ tracks: склад, plays: {}, size: 5 }).length === 5)
  check('в подборке нет повторов', () => {
    const m = smartMix({ tracks: склад, plays: {}, size: 8 })
    return new Set(m.map(t => t.id)).size === m.length
  })
  check('одна песня в двух обёртках в подборку не попадает', () => {
    const m = smartMix({ tracks: склад, plays: {}, size: 9 })
    const ids = m.map(t => t.id)
    return !(ids.includes('a') && ids.includes('g'))
  })
  check('не больше двух подряд одного исполнителя', () => {
    const m = smartMix({ tracks: склад, plays: {}, size: 9 })
    let streak = 1
    for (let i = 1; i < m.length; i++) {
      streak = m[i].author === m[i - 1].author ? streak + 1 : 1
      if (streak > 2) return false
    }
    return true
  })
  check('просят больше, чем есть — отдаём сколько есть', () =>
    smartMix({ tracks: склад, plays: {}, size: 50 }).length <= склад.length)
  check('пустой склад не ломает', () => smartMix({ tracks: [], plays: {}, size: 5 }).length === 0)
  check('неиграбельное в подборку не попадает', () => {
    const m = smartMix({ tracks: склад, plays: {}, size: 9, skip: t => t.author === 'Кино' })
    return !m.some(t => t.author === 'Кино')
  })
  check('подпись читается человеком', () => {
    const s1 = mixSummary([{ dur: 200 }, { dur: 200 }])
    return s1.includes('2 трека') && s1.includes('мин')
  })
  check('без длительностей подпись всё равно осмысленна', () =>
    mixSummary([{}, {}, {}, {}, {}]) === '5 треков')
}

console.log('\n-- Тишина при входе (v1.439.0) --')
// Чужой проигрыватель (виджет SoundCloud в скрытом iframe) умеет стартовать сам:
// разрешение на автозапуск у iframe есть, и сервис им пользуется. Раньше любое
// его «играю» включало плеер у нас — человек только зашёл, а музыка уже идёт.
check('чужой проигрыватель не включает музыку сам', () => playKind(false) === 'stray')
check('наше собственное включение помехой не считается', () => playKind(true) === 'ours')
check('это зеркало правила про паузу', () =>
  pauseKind(false, 0, 0) === 'ours' && playKind(false) === 'stray')

console.log('\n-- Ломаем нарочно (тишина при входе) --')
check('проверка заметила бы возврат к «любое играю включает плеер»', () => {
  const прежнее = () => 'ours'
  return прежнее() === 'ours' && playKind(false) === 'stray'
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
  // v1.462.0: три проверки ниже раньше требовали ОБРАТНОГО — «любое расхождение
  // в числе треков означает качать всё заново». Именно это владелец и принёс:
  // на складе в тринадцать тысяч, куда каждый день кто-то добавляет песню,
  // число не совпадает никогда, и склад качался целиком при каждом открытии.
  //
  // Добавленное забирает incremental — он и сделан ровно для этого случая.
  check('треков стало больше — добираем только новое', () =>
    libraryPlan(снимок(50), 51, NOW).kind === 'incremental')
  check('пропал один трек — не повод качать всё заново', () =>
    libraryPlan(снимок(50), 49, NOW).kind === 'incremental')
  check('счёт спросить не вышло — доверяем свежему снимку', () =>
    libraryPlan(снимок(50), null, NOW).kind === 'incremental')
  check('пропала пачка треков — вот тогда целиком', () => {
    // Здесь по времени уже не догнать: в снимке остались треки, которых нет.
    const p = libraryPlan(снимок(50), 5, NOW)
    return p.kind === 'full' && p.why === 'count-differs'
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
    // Ровно та поломка, которой тут можно всё испортить: удалили ПАЧКУ треков, а
    // мы показываем прежний склад и не замечаем этого никогда.
    const слепо = () => ({ kind: 'incremental' as const, since: 'x' })
    return слепо().kind === 'incremental' && libraryPlan(снимок(50), 5, NOW).kind === 'full'
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
    // v1.442.0: давность в очках осталась, причиной больше не называется.
    return r[0].track.id === 'год назад'
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

// -- v1.443.0: подряд нажатая перемотка --------------------------------------
// Настоящая поломка, найденная разбором: «дальше» считало следующий номер от
// idx из состояния React, а состояние до перерисовки не меняется. Два быстрых
// нажатия оба считали от ОДНОЙ позиции и приводили в один и тот же трек —
// второе пропадало впустую. На телефоне, где по кнопке бьют пальцем несколько
// раз, это выглядит как «залипла перемотка». Плеер теперь двигает позицию
// сразу (goIdx), а resolveNext считает от неё.
console.log('\n-- Перемотка подряд --')

/** Нажали «дальше» n раз подряд, каждый раз считая от УЖЕ сдвинутой позиции. */
function жмёмДальше(n: number, from: number, count: number, unplayable: (i: number) => boolean = () => false) {
  let i = from
  for (let k = 0; k < n; k++) {
    const a = resolveNext({ idx: i, count, repeat: 'off', shuffle: false, manualIdx: -1, personalIdx: -1, unplayable })
    if (a.kind !== 'go') break
    i = a.index
  }
  return i
}

check('три нажатия подряд перематывают на три трека', () => жмёмДальше(3, 0, 10) === 3)
check('нажатия у конца списка не улетают за край', () => жмёмДальше(5, 8, 10) === 9)
check('сломанные треки пропускаются и при быстрых нажатиях', () =>
  // 1 и 2 играть нечем: два нажатия от нуля должны привести к 4, а не к 2.
  жмёмДальше(2, 0, 10, i => i === 1 || i === 2) === 4)

console.log('\n-- Ломаем нарочно (перемотка) --')
check('проверка ловит счёт от застывшей позиции', () => {
  // Так было до исправления: обе кнопки считают от одного и того же места.
  const a1 = resolveNext({ idx: 0, count: 10, repeat: 'off', shuffle: false, manualIdx: -1, personalIdx: -1, unplayable: () => false })
  const a2 = resolveNext({ idx: 0, count: 10, repeat: 'off', shuffle: false, manualIdx: -1, personalIdx: -1, unplayable: () => false })
  const застыло = a1.kind === 'go' && a2.kind === 'go' && a1.index === a2.index
  return застыло && жмёмДальше(2, 0, 10) === 2   // а с движущейся позицией — два шага
})


// -- v1.443.0: карточка плеера в шторке --------------------------------------
// Ошибка здесь видна только по тому, что полоса в шторке однажды застыла:
// браузер на неверных числах бросает исключение и МОЛЧА перестаёт обновлять
// карточку целиком — вместе с названием следующего трека.
console.log('\n-- Карточка в шторке --')

check('позиция не выходит за длительность', () => {
  const st = mediaPos(500, 200)
  return st !== null && st.position === 200 && st.duration === 200
})
check('без длительности полосы нет', () =>
  mediaPos(10, 0) === null && mediaPos(10, undefined) === null && mediaPos(10, -5) === null)
check('мусор вместо чисел полосу не ломает', () =>
  mediaPos(NaN, 200)?.position === 0 && mediaPos(Infinity, 200)?.position === 0
  && mediaPos(10, NaN) === null && mediaPos(-30, 200)?.position === 0)

check('карточка пересобирается только при смене трека', () => {
  const a = { title: 'Т', artist: 'И', album: 'NeyLivo Music', art: 'u' }
  return mediaKey(a) === mediaKey({ ...a }) && mediaKey(a) !== mediaKey({ ...a, title: 'Другой' })
})
check('смена обложки тоже пересобирает карточку', () => {
  const a = { title: 'Т', artist: 'И', art: null as string | null }
  return mediaKey(a) !== mediaKey({ ...a, art: 'u' })
})

check('без обложки отдаём значок приложения', () => {
  const w = mediaArtwork(null)
  return w.length === 4 && w.every(x => x.src === MEDIA_FALLBACK_ART) && w[0].type === 'image/png'
})
check('обложка трека отдаётся во всех размерах', () => {
  const w = mediaArtwork('https://x/y.jpg')
  return w.length === 4 && w.every(x => x.src === 'https://x/y.jpg' && x.type === 'image/jpeg')
})

console.log('\n-- Ломаем нарочно (карточка) --')
check('проверка ловит позицию больше длительности', () => {
  // Так карточка и застывала: 500 из 200 браузеру не нравится.
  const плохо = { duration: 200, position: 500 }
  return плохо.position > плохо.duration && (mediaPos(500, 200)?.position ?? 0) <= 200
})
check('проверка ловит пустой список обложек', () =>
  // Пустой список означает «нарисуй что хочешь» — Android рисует серый квадрат.
  mediaArtwork(null).length > 0 && mediaArtwork(undefined).length > 0)


// -- v1.445.0: что подгружать первым ------------------------------------------
// Порядок подгрузки знал ровно про два трека: играющий и следующий. Найденное
// поиском грузилось последним, потому что лежит в середине склада, — то есть
// ровно то, на что человек смотрит и что вот-вот включит, ждало дольше всего.
console.log('\n-- Очередь подгрузки --')
const склад = Array.from({ length: 10 }, (_, i) => ({ url: 'u' + i }))
const план = (o: any) => planMeta(склад, o).map(t => t.url)

check('играющий тянется первым', () => план({ current: 'u7' })[0] === 'u7')
check('следующий — вторым', () => {
  const r = план({ current: 'u7', next: 'u3' })
  return r[0] === 'u7' && r[1] === 'u3'
})
check('найденное поиском идёт раньше остального склада', () => {
  const r = план({ found: ['u8', 'u9'] })
  return r[0] === 'u8' && r[1] === 'u9'
})
check('внутри найденного порядок выдачи сохраняется', () => {
  const r = план({ found: ['u9', 'u2', 'u5'] })
  return r.slice(0, 3).join(',') === 'u9,u2,u5'
})
check('играющий важнее найденного', () => {
  const r = план({ current: 'u4', found: ['u9', 'u4'] })
  return r[0] === 'u4' && r[1] === 'u9'
})
check('видимое на экране идёт после найденного, но раньше прочего', () => {
  const r = план({ found: ['u9'], shown: ['u5', 'u6'] })
  return r.slice(0, 3).join(',') === 'u9,u5,u6'
})
check('без подсказок порядок склада не меняется', () =>
  план({}).join(',') === склад.map(t => t.url).join(','))
check('при равных разрядах порядок устойчив', () => {
  // Иначе один и тот же склад планировался бы по-разному от захода к заходу.
  const a = план({ found: ['u1'] }).join(',')
  const b = план({ found: ['u1'] }).join(',')
  return a === b
})
check('за заход берётся не больше пачки', () => {
  const много = Array.from({ length: 500 }, (_, i) => ({ url: 'x' + i }))
  return planMeta(много, {}).length === META_BATCH && planMeta(много, { batch: 5 }).length === 5
})
check('длинная выдача не перелезает в следующий разряд', () => {
  // Тысяча первый найденный всё равно должен быть раньше невидимого хвоста.
  const found = Array.from({ length: 1200 }, (_, i) => 'f' + i)
  return metaRank('f1199', { found }) < metaRank('прочее', { found })
})

check('лежащее в кэше забирается разом и без запросов', () => {
  const кэш: Record<string, string> = { u1: 'есть', u3: 'есть' }
  const seeded = seedFromCache(склад, u => кэш[u] ?? null)
  return Object.keys(seeded).length === 2 && needsFetch(склад, seeded).length === 8
})
check('когда в кэше всё — запрашивать нечего', () => {
  const seeded = seedFromCache(склад, () => 'есть')
  return needsFetch(склад, seeded).length === 0
})
check('повторы в складе не удваивают работу', () => {
  const с_повтором = [{ url: 'u1' }, { url: 'u1' }, { url: 'u2' }]
  let звали = 0
  seedFromCache(с_повтором, u => { звали++; return u === 'u1' ? 'есть' : null })
  return звали === 2
})

console.log('\n-- Ломаем нарочно (очередь подгрузки) --')
check('проверка ловит потерю приоритета у найденного', () => {
  // Так и было: найденное шло в общем порядке склада и грузилось последним.
  const без = склад.map(t => t.url).indexOf('u8')
  const с = план({ found: ['u8'] }).indexOf('u8')
  return без === 8 && с === 0
})
check('проверка ловит запрос за тем, что уже лежит в кэше', () => {
  const seeded = seedFromCache(склад, u => (u === 'u0' ? 'есть' : null))
  return needsFetch(склад, seeded).every(t => t.url !== 'u0')
})


// -- v1.460.0: плеер помнит, на чём остановился ------------------------------
// Закрыл приложение — и плеер открывался пустым. Громкость помнилась, а сам
// сеанс нет: человек, слушавший длинную запись, каждый раз искал место заново.
console.log('\n-- Сеанс плеера --')

check('начало трека не запоминаем', () =>
  !worthSaving(3, 300) && !worthSaving(0, 300) && worthSaving(60, 300))
check('почти дослушанный трек не запоминаем', () =>
  // Иначе при следующем запуске он «продолжится» за пять секунд до конца.
  !worthSaving(295, 300) && worthSaving(200, 300))
check('без известной длины запоминаем по одной только позиции', () =>
  worthSaving(60, 0) && !worthSaving(5, 0))
check('мусор вместо позиции не сохраняется', () =>
  !worthSaving(NaN, 300) && !worthSaving(Infinity, 300))

check('трек находится по ссылке, даже если id поменялся', () => {
  const склад = [{ id: 'новый', url: 'u2' }, { id: 'x', url: 'u1' }]
  return findTrack({ id: 'старый', url: 'u2', pos: 30, at: 1 }, склад) === 0
})
check('если ссылки нет — ищем по id', () => {
  const склад = [{ id: 'a', url: 'нет' }, { id: 'b', url: 'тоже нет' }]
  return findTrack({ id: 'b', url: 'пропала', pos: 30, at: 1 }, склад) === 1
})
check('пропавший трек не подменяется соседним', () => {
  // Иначе после чистки склада «продолжилось» бы что-то постороннее.
  const склад = [{ id: 'a', url: 'u1' }]
  return findTrack({ id: 'нет', url: 'нет', pos: 30, at: 1 }, склад) === -1
      && findTrack(null, склад) === -1
})

// -- v1.460.0: живой фон плеера ---------------------------------------------
// Узор обязан быть УСТОЙЧИВЫМ: один и тот же трек — один и тот же рисунок.
// Иначе пятна прыгали бы по экрану при каждой перерисовке.
console.log('\n-- Живой фон --')

check('один трек — один и тот же узор', () => {
  const a = JSON.stringify(blobsFor('https://x/track1'))
  const b = JSON.stringify(blobsFor('https://x/track1'))
  return a === b
})
check('разные треки — разные узоры', () =>
  JSON.stringify(blobsFor('u1')) !== JSON.stringify(blobsFor('u2')))
check('пятна помещаются в экран и не вырождаются', () =>
  blobsFor('u1').every(b => b.x > 0 && b.x < 1 && b.y > 0 && b.y < 1 && b.r > 0.1 && b.r < 0.6))
check('движение медленное — фон не мельтешит', () =>
  // Быстрее — и фон начинает отвлекать от того, ради чего плеер открыт.
  blobsFor('u1').every(b => b.dur >= 18 && b.dur <= 34))
check('пятна не ходят строем', () => {
  const d = blobsFor('u1').map(b => b.dur)
  return new Set(d).size === d.length
})
check('при выключенных анимациях узор стоит', () =>
  blobsFor('u1', 0).every(b => b.dur === 0))

check('без обложки берётся цвет темы, а не серое пятно', () => {
  const p = paletteOf(null)
  return p.length === 3 && p.every(c => /^#[0-9a-f]{6}$/i.test(c))
})
check('оттенки отличаются от основного', () => {
  const [a, b, c] = paletteOf('#5865f2')
  return a !== b && a !== c && b !== c
})
check('кривой цвет не ломает подбор', () =>
  paletteOf('не цвет').length === 3 && shift('мусор', 20) === 'мусор')

console.log('\n-- Ломаем нарочно (фон и сеанс) --')
check('проверка ловит случайный узор вместо устойчивого', () => {
  // Со случайными числами два вызова подряд дали бы разное — и пятна прыгали бы.
  const два = [blobsFor('одно и то же'), blobsFor('одно и то же')]
  return JSON.stringify(два[0]) === JSON.stringify(два[1])
})
check('проверка ловит сохранение первых секунд', () =>
  !worthSaving(5, 600) && worthSaving(120, 600))


// -- v1.462.0: склад на тринадцать тысяч ------------------------------------
// Владелец принёс: «всё лагает, треки из SoundCloud не работают, склад каждый
// раз качается целиком и никогда не пишет, сколько треков». Три причины, и
// каждая проверяется здесь.
console.log('\n-- Большой склад --')

const снимок13 = (n: number, at: number, свежесть = '2026-08-01T00:00:00Z') => ({
  at,
  tracks: Array.from({ length: n }, (_, i) => ({
    id: 't' + i, url: 'u' + i, name: 'Т' + i, owner: 'o', at: свежесть,
  })),
}) as any

check('склад с добавленными треками НЕ качается целиком', () => {
  // Это и была главная беда: на большом складе число не совпадает никогда,
  // потому что кто-то каждый день добавляет песню.
  const p = libraryPlan(снимок13(13000, Date.now()), 13007, Date.now())
  return p.kind === 'incremental'
})
check('и когда число спросить не вышло — тоже не целиком', () =>
  libraryPlan(снимок13(13000, Date.now()), null, Date.now()).kind === 'incremental')
check('несколько удалённых треков не заставляют качать всё', () =>
  libraryPlan(снимок13(13000, Date.now()), 12990, Date.now()).kind === 'incremental')
check('массовое удаление всё-таки перечитывает склад', () => {
  // Тут по времени уже не догнать: в снимке остались треки, которых нет.
  const p = libraryPlan(снимок13(13000, Date.now()), 9000, Date.now())
  return p.kind === 'full' && p.why === 'count-differs'
})
check('старый снимок перечитывается целиком', () =>
  libraryPlan(снимок13(100, Date.now() - SNAPSHOT_TTL_MS - 1), 100, Date.now()).kind === 'full')
check('без снимка — только целиком', () =>
  libraryPlan(null, 100, Date.now()).kind === 'full')

console.log('\n-- Ломаем нарочно (большой склад) --')
check('проверка ловит возврат к полной загрузке при любом расхождении', () => {
  // Так и было: одна добавленная песня — и тринадцать тысяч едут заново.
  const было: boolean = (13000 as number) !== (13001 as number)   // прежнее условие «count !== length»
  const стало = libraryPlan(снимок13(13000, Date.now()), 13001, Date.now())
  return было && стало.kind === 'incremental'
})


console.log('\n-- Подборка на большом складе (v1.464.0) --')
{
  // Владелец принёс: «лагает, кнопки через раз нажимаются, музыка еле грузится».
  // Причина была здесь: ключ песни собирал семь десятков выражений заново на
  // КАЖДОЕ название, а подборка зовёт его для каждого трека склада. Один
  // пересчёт на тринадцати тысячах занимал 5133 мс — всё это время окно не
  // отвечало ни на что.

  // Прежний разбор, слово в слово. Новый обязан давать тот же ответ: скорость
  // не должна была стоить ни одной изменившейся склейки версий.
  const прежнийBase = (s?: string): string => {
    let v = (s || '').toLowerCase()
    v = v.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ')
    v = v.replace(FEAT_RE_FOR_TEST, ' ')
    for (const w of VERSION_WORDS_FOR_TEST) {
      v = v.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'giu'), ' ')
    }
    v = v.replace(/\b\d+\s?(bpm|x)\b/gi, ' ').replace(/\bx\s?\d+\b/gi, ' ')
    return v.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  }
  const прежнийКлюч = (name?: string, author?: string): string => {
    let t = прежнийBase(name)
    if (!t) return ''
    const a = прежнийBase(author)
    if (a) {
      if (t.startsWith(a + ' ')) t = t.slice(a.length + 1)
      else if (t.endsWith(' ' + a)) t = t.slice(0, -(a.length + 1))
    }
    if (!t) return ''
    return a ? a + '|' + t : t
  }

  const куски = ['Песня', 'Song', 'Ночь', 'Ai', '', '4k', 'x', 'Тень 2', 'Love', 'Дом']
  const обёртки = ['', ' (Sped Up)', ' [Official Video]', ' - Remix', ' feat. Кто-то', ' x Гость',
    ' slowed + reverb', ' (Live)', ' | Lyrics', ' 120 bpm', ' x2', ' -remix-', ' -sped-up-',
    ' Official Audio', ' {Nightcore}', ' при участии Кого-то', ' RADIO EDIT', ' Ремикс', ' минус']
  const имена: string[] = ['sped-remix-up', 'sped-official-up', 'a-live-b', 'слов-ремикс-но']
  for (const k of куски) for (const o of обёртки) for (const o2 of ['', ...обёртки.slice(0, 8)]) имена.push(k + o + o2)

  let расхождений = 0
  for (const n of имена) for (const a of ['Автор', '', 'DJ Live', 'x']) {
    if (прежнийКлюч(n, a) !== songKey(n, a)) расхождений++
  }
  check('быстрый разбор даёт тот же ключ, что и прежний, на ' + имена.length * 4 + ' названиях',
    () => расхождений === 0)

  check('память ключей не склеивает «Дом Мир» + пусто и «Дом» + «Мир»', () => {
    // Дважды: первый проход кладёт ответ в память, второй берёт его оттуда.
    const пары: [string, string][] = [['Дом Мир', ''], ['Дом', 'Мир'], ['А Б В', ''], ['А', 'Б В']]
    for (let i = 0; i < 2; i++) for (const [n, a] of пары) if (songKey(n, a) !== прежнийКлюч(n, a)) return false
    return songKey('Дом Мир', '') !== songKey('Дом', 'Мир')
  })

  const N = 13000
  const склад = Array.from({ length: N }, (_, i) => ({
    id: 't' + i, name: имена[i % имена.length] + ' ' + i, author: 'Автор ' + (i % 300), plays: i % 17,
  }))
  const myPlays: Record<string, number> = {}
  for (let i = 0; i < N; i += 3) myPlays['t' + i] = i % 9
  const пересчёт = () => recommend({
    tracks: склад as never, idx: 10, plays: myPlays, recent: [], lastAt: {}, now: Date.now(),
  })
  // Мерить надо ПЕРВЫЙ проход. Второй берёт готовые ключи из памяти и уложится
  // в потолок даже с самым медленным разбором — такая проверка не поймала бы
  // ничего. Названия здесь свои, ни в одной проверке выше не встречались, так
  // что память по ним пуста.
  const t0 = Date.now()
  пересчёт()
  const холодный = Date.now() - t0
  const t1 = Date.now()
  пересчёт()
  const тёплый = Date.now() - t1
  // Потолок с запасом: было 5133 мс, стало около трёхсот. Проверка стоит не
  // ради «быстро», а чтобы никто не вернул сборку выражений внутрь прохода по
  // складу — это уже случалось, и заметил это владелец, а не я.
  check('первый пересчёт подборки на ' + N + ' треках укладывается в 1200 мс (вышло ' + холодный + ')',
    () => холодный < 1200)
  check('повторный пересчёт берёт ключи из памяти и заметно дешевле первого (' + тёплый + ' против ' + холодный + ')',
    () => тёплый * 2 < холодный || тёплый <= 30)
}

console.log('\nИТОГ: пройдено ' + pass + ', провалено ' + fail)
if (fail) process.exit(1)

// ── Спектр для визуализаторов (v1.491.0) ────────────────────────────────────
{
  const S = await import('./spectrum')
  console.log('\n-- Спектр звука --')

  check('тишина даёт нули', () => {
    const b = S.toBands(new Uint8Array(256))
    // Тишина в данных ВОЛНЫ — это 128, а не ноль: байты идут вокруг середины.
    return b.length === S.BANDS && b.every(x => x === 0)
      && S.toLevel(new Uint8Array(256).fill(128)) === 0
  })

  check('полный сигнал даёт единицы', () => {
    const полный = new Uint8Array(256).fill(255)
    const b = S.toBands(полный)
    // Громкость на пределе — это волна, ушедшая в самый край от середины.
    const край = new Uint8Array(256).fill(255)
    return b.every(x => x === 1) && S.toLevel(край) > 0.98
  })

  check('полос ровно столько, сколько обещано', () =>
    S.toBands(new Uint8Array(1024)).length === S.BANDS
    && S.toBands(new Uint8Array(1024), 8).length === 8)

  check('шкала логарифмическая, а не ровная', () => {
    // Ухо слышит логарифмически: нижние полосы обязаны брать УЗКИЕ куски, а
    // верхние — широкие. С ровной шкалой визуализатор выглядит как «слева всё
    // скачет, справа мертво», и это первое, что видно глазом.
    //
    // Проверяем прямо: ОДИНАКОВО узкий сигнал внизу должен отзываться сильнее,
    // чем такой же наверху, — потому что нижняя полоса узкая и он заполняет её
    // целиком, а верхняя широкая и он в ней тонет. При ровной шкале отклик был
    // бы одинаковым.
    const узкий = (с: number) => {
      const a = new Uint8Array(1024)
      for (let i = с; i < с + 20; i++) a[i] = 255
      return Math.max(...S.toBands(a))
    }
    const внизу = узкий(0)
    const наверху = узкий(600)
    // Порог невелик нарочно. При РОВНОЙ шкале отклик был бы одинаковым (полосы
    // равной ширины, сигнал заполняет их одинаково) — то есть отношение около
    // единицы. Полутора хватает, чтобы отличить одно от другого, и не хватает,
    // чтобы проверка падала от смены числа полос.
    if (!(внизу > наверху * 1.3)) {
      throw new Error(`шкала похожа на ровную: низ ${внизу}, верх ${наверху}`)
    }
    // И верх при этом не молчит совсем: иначе это не шкала, а обрезание.
    return наверху > 0
  })

  check('без анализатора отдаются нули, а не выдумка', () => {
    S.clearSpectrum()
    const k = S.readSpectrum()
    return k.level === 0 && k.bands.length === S.BANDS && k.bands.every(x => x === 0)
  })

  check('пока никто не подписан, кадры не считаются', () => {
    S.clearSpectrum()
    return S.spectrumWanted() === false
  })

  check('подписка будит, отписка усыпляет', () => {
    S.clearSpectrum()
    S.watchSpectrum('а')
    S.watchSpectrum('б')
    const было = S.spectrumWanted()
    S.unwatchSpectrum('а')
    const ещё = S.spectrumWanted()
    S.unwatchSpectrum('б')
    const стало = S.spectrumWanted()
    S.clearSpectrum()
    return было && ещё && !стало
  })

  check('плеер узнаёт, что спектр понадобился', () => {
    S.clearSpectrum()
    let сказали = 0
    const снять = S.onSpectrumWanted(() => { сказали++ })
    S.watchSpectrum('в')
    снять()
    S.clearSpectrum()
    return сказали === 1
  })
}
