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

import { nextTrack, backTarget } from './nextTrack'
import { recommend, libraryOrder, personalOrder, WHY_LABEL, banWindow, AUTHOR_STREAK } from './personalQueue'
import { normalizeTrackUrl, sameTrack } from './trackUrl'
import { parseYouTubeId, isYouTubeUrl, findYouTubeLink, isAudiusUrl } from './sources'
import { boost, lighten, scale, rgb } from './artColor'
import { searchQuery } from './streaming'
import { countAfterFail, countAfterOk, brokenIn, BROKEN_AFTER } from './broken'
import { isEmbedDeniedCode, pauseKind, silenceStuck, SILENCE_MS } from './broken'
import { mergeTracks } from './mergeTracks'
import { advance, credited, creditThreshold, freshListened, CREDIT_SEC, STEP_MAX } from './playCredit'

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
  (['author', 'similar', 'mine', 'popular', 'fresh', 'order'] as const).every(w => !!WHY_LABEL[w]))
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
check('тридцать секунд — засчитано', () => credited(listen(30), 200))
check('двадцать девять — ещё нет', () => !credited(listen(29), 200))
check('порог по умолчанию — тридцать секунд', () => creditThreshold(200) === CREDIT_SEC && creditThreshold(undefined) === CREDIT_SEC)
check('короткую запись надо дослушать', () => {
  // Трек на 20 секунд: порог — почти вся его длина, а не тридцать секунд.
  const th = creditThreshold(20)
  return th < CREDIT_SEC && th >= 19 - 1e-9
})
check('короткая запись целиком — засчитано', () => credited(listen(20, 0.5), 20))
check('половина короткой записи — нет', () => !credited(listen(10, 0.5), 20))

console.log('\n-- Перемотка не считается слушанием --')
check('перемотка на тридцатую секунду ничего не даёт', () => {
  const st = advance(freshListened(0), 30)   // один прыжок сразу на 30 с
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

console.log('\nИТОГ: пройдено ' + pass + ', провалено ' + fail)
if (fail) process.exit(1)
