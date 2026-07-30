// v1.394.0: проверка разбора текста песни. Запуск: npm run test:lyrics
//
// Зачем. Разбор решает две вещи, каждая из которых видна человеку сразу.
// Первая — караоке это или нет: назвать караоке текст без меток времени значит
// показать неподвижную простыню и подсветку невпопад. Вторая — на какой секунде
// какая строка: ошибка тут разъезжается с песней, и это ровно то, ради чего всё
// затевалось. Плюс LRC приходит из чужих рук — с сотыми через двоеточие, со
// сдвигом [offset], с повторами припева и просто с мусором.
export {}

import { parseLyrics, activeLineIndex, pickLyrics, sameName, lyricsScrollMs, lyricsEase, lyricsScale, lyricsTime, LYRICS_LOOKAHEAD, centerScrollTop, autoScrollOk, LYRICS_HOLD_MS } from './lyrics'
import { stamp, words, chunksToLrc, alignPlainToChunks, fillGaps, whyCantRecognize, type SpeechChunk } from './aiLyrics'

let pass = 0, fail = 0
function check(name: string, fn: () => boolean) {
  let ok = false, err = ''
  try { ok = fn() } catch (e: any) { err = e?.message ?? String(e) }
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  ПРОВАЛ ' + name + (err ? ' — ' + err : '')) }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.001

console.log('── Обычный текст ──')
check('строки сохраняются как есть', () => {
  const l = parseLyrics('первая\nвторая\nтретья')
  return l.lines.length === 3 && l.lines[0].text === 'первая' && l.lines[2].text === 'третья'
})
check('обычный текст — не караоке', () => !parseLyrics('первая\nвторая').synced)
check('пустой текст не выдумывает строк', () => {
  const l = parseLyrics('   \n  ')
  return l.lines.length === 0 && !l.synced
})
check('пустые строки между куплетами не теряются', () => {
  const l = parseLyrics('раз\n\nдва')
  return l.lines.length === 3 && l.lines[1].text === ''
})

console.log('\n── LRC с метками времени ──')
const LRC = '[ar:Кто-то]\n[ti:Песня]\n[00:12.50]первая\n[00:15.00]вторая\n[01:02.25]третья'
check('служебные строки не попадают в текст', () => parseLyrics(LRC).lines.length === 3)
check('это караоке', () => parseLyrics(LRC).synced)
check('минуты и секунды считаются верно', () => near(parseLyrics(LRC).lines[2].t!, 62.25))
check('сотые считаются верно', () => near(parseLyrics(LRC).lines[0].t!, 12.5))
check('сотые через двоеточие тоже понимаются', () => near(parseLyrics('[00:12:50]раз\n[00:13:00]два').lines[0].t!, 12.5))
check('одна цифра после точки — это десятые, а не сотые', () => near(parseLyrics('[00:12.5]раз\n[00:13.0]два').lines[0].t!, 12.5))
check('припев с несколькими метками повторяется в каждой', () => {
  const l = parseLyrics('[00:10.00][00:40.00]припев\n[00:20.00]куплет')
  const t = l.lines.filter(x => x.text === 'припев').map(x => x.t)
  return t.length === 2 && near(t[0]!, 10) && near(t[1]!, 40)
})
check('строки идут по времени, даже если в файле вперемешку', () => {
  const l = parseLyrics('[00:30.00]три\n[00:10.00]один\n[00:20.00]два')
  return l.lines[0].text === 'один' && l.lines[1].text === 'два' && l.lines[2].text === 'три'
})
check('[offset] сдвигает время', () => {
  const l = parseLyrics('[offset:+500]\n[00:12.00]раз\n[00:13.00]два')
  return near(l.lines[0].t!, 11.5)
})
check('сдвиг не уводит время в минус', () => {
  const l = parseLyrics('[offset:+5000]\n[00:01.00]раз\n[00:02.00]два')
  return l.lines[0].t === 0
})

console.log('\n── Мусор и пограничное ──')
check('битая метка не съедает строку', () => {
  const l = parseLyrics('[99:99.99]строка')
  return l.lines.length === 1 && l.lines[0].text === '[99:99.99]строка'
})
check('одна метка на сорок строк — это не караоке', () => {
  const many = Array.from({ length: 40 }, (_, i) => 'строка ' + i).join('\n')
  return !parseLyrics('[00:10.00]первая\n' + many).synced
})
check('половина строк с метками — уже караоке', () => {
  const l = parseLyrics('[00:01.00]раз\n[00:02.00]два\nтри\nчетыре')
  return l.synced
})
check('перенос строки Windows не ломает разбор', () => parseLyrics('[00:01.00]раз\r\n[00:02.00]два').lines.length === 2)

console.log('\n── Какая строка звучит сейчас ──')
const L = parseLyrics('[00:10.00]раз\n[00:20.00]два\n[00:30.00]три').lines
check('до первой строки — никакая', () => activeLineIndex(L, 5) === -1)
check('ровно на метке — уже её строка', () => activeLineIndex(L, 10) === 0)
check('между метками — предыдущая', () => activeLineIndex(L, 19.9) === 0)
check('после последней — последняя', () => activeLineIndex(L, 500) === 2)
check('на пустом тексте не падает', () => activeLineIndex([], 10) === -1)

console.log('\n── Какую запись из каталога брать ──')
check('без текста запись не берём', () => pickLyrics([{ trackName: 'A', syncedLyrics: '', plainLyrics: '' }]) === null)
check('из пустого списка — ничего', () => pickLyrics([]) === null)
check('с метками времени важнее, чем без', () => {
  const r = pickLyrics([{ trackName: 'простой', plainLyrics: 'текст' }, { trackName: 'с метками', syncedLyrics: '[00:01.00]текст' }])
  return r!.trackName === 'с метками'
})
check('при равенстве берём ближе по длительности', () => {
  const r = pickLyrics([
    { trackName: 'концерт', syncedLyrics: '[00:01.00]a', duration: 400 },
    { trackName: 'студия', syncedLyrics: '[00:01.00]a', duration: 210 },
  ], 205)
  return r!.trackName === 'студия'
})
check('длительность не перевешивает наличие меток', () => {
  const r = pickLyrics([
    { trackName: 'простой', plainLyrics: 'текст', duration: 205 },
    { trackName: 'с метками', syncedLyrics: '[00:01.00]a', duration: 400 },
  ], 205)
  return r!.trackName === 'с метками'
})
check('без известной длительности берём первый с метками', () => {
  const r = pickLyrics([{ trackName: 'один', syncedLyrics: '[00:01.00]a' }, { trackName: 'два', syncedLyrics: '[00:01.00]b' }])
  return r!.trackName === 'один'
})

console.log('\n── Подгонка под скорость записи (v1.404.0) ──')
check('длительность записи читается из [length]', () =>
  parseLyrics('[length:03:20]\n[00:01.00]раз\n[00:02.00]два').srcDur === 200)
check('[length] числом тоже понимается', () =>
  parseLyrics('[length:200]\n[00:01.00]раз\n[00:02.00]два').srcDur === 200)
check('без [length] длительность неизвестна', () =>
  parseLyrics('[00:01.00]раз\n[00:02.00]два').srcDur === undefined)

check('ускоренная версия: время растягивается обратно', () => {
  // Оригинал 200 с, спидап 160 с. На 80-й секунде спидапа поют 100-ю оригинала.
  const k = lyricsScale(200, 160)
  return Math.abs(80 * k - 100) < 0.001
})
check('замедленная версия тоже подгоняется', () => lyricsScale(160, 200) < 1)
check('без одной из длительностей не трогаем', () =>
  lyricsScale(undefined, 160) === 1 && lyricsScale(200, undefined) === 1)
check('разница в пару секунд — это округление, а не ускорение', () =>
  lyricsScale(200, 198) === 1)
check('разница больше чем вдвое — это другая запись', () =>
  lyricsScale(600, 200) === 1 && lyricsScale(100, 300) === 1)
check('короткие куски не подгоняем', () => lyricsScale(10, 5) === 1)

console.log('\n── Время, по которому ищем строку ──')
check('без поправок это почти само время трека', () =>
  Math.abs(lyricsTime(50, 1, 0) - (50 + LYRICS_LOOKAHEAD)) < 0.001)
check('ручной сдвиг прибавляется', () =>
  Math.abs(lyricsTime(50, 1, 1.5) - (51.5 + LYRICS_LOOKAHEAD)) < 0.001)
check('скорость и сдвиг работают вместе', () =>
  Math.abs(lyricsTime(80, 1.25, -1) - (100 - 1 + LYRICS_LOOKAHEAD)) < 0.001)
check('взгляд вперёд не больше четверти секунды', () => LYRICS_LOOKAHEAD <= 0.25)

check('на спидапе строка находится верно', () => {
  const l = parseLyrics('[length:03:20]\n[00:50.00]первая\n[01:40.00]вторая\n[02:30.00]третья')
  const k = lyricsScale(l.srcDur, 160)   // та же песня, ускоренная до 160 с
  // 80-я секунда спидапа = 100-я оригинала: это уже вторая строка.
  return activeLineIndex(l.lines, lyricsTime(80, k, 0)) === 1
})

console.log('\n── Ломаем нарочно (подгонка) ──')
check('проверка заметила бы, что подгонку перестали делать', () => {
  const l = parseLyrics('[length:03:20]\n[00:50.00]первая\n[01:40.00]вторая\n[02:30.00]третья')
  // Без подгонки на 80-й секунде спидапа нашлась бы ещё первая строка.
  return activeLineIndex(l.lines, lyricsTime(80, 1, 0)) === 0
})

console.log('\n── Ломаем нарочно ──')
check('проверка заметила бы, что метки времени перестали разбираться', () => {
  // Если бы разбор возвращал t=null, караоке молча превратилось бы в простыню.
  const l = parseLyrics('[00:10.00]раз\n[00:20.00]два')
  return l.lines.every(x => typeof x.t === 'number')
})
check('проверка заметила бы, что synced ставится всегда', () => !parseLyrics('просто текст\nбез меток').synced)


console.log('\n-- Строка посередине (v1.420.0) --')
// Раньше положение считалось арифметикой «номер строки x высота строки»: на
// первой же длинной строке, которая переносится на два ряда, весь текст ниже
// съезжал, и поющаяся строка уходила из центра. Считаем по измеренной строке.
check('строка встаёт ровно по середине окна', () =>
  centerScrollTop(300, 60, 400, 10000) === 130)
check('первую строку не тянет в минус', () => centerScrollTop(0, 60, 400, 10000) === 0)
check('последнюю строку не тянет за предел прокрутки', () =>
  centerScrollTop(5000, 60, 400, 700) === 700)
check('высота строки учитывается, а не берётся средняя', () =>
  centerScrollTop(300, 120, 400, 10000) > centerScrollTop(300, 60, 400, 10000))
check('мусорные размеры не ломают счёт', () =>
  centerScrollTop(NaN, 60, 400, 1000) === 0 && centerScrollTop(100, 60, 400, -5) === 0)

console.log('\n-- Уступаем, когда листают руками --')
check('сразу после прокрутки сами не ведём', () => !autoScrollOk(1000, 1500))
check('через паузу ведём снова', () => autoScrollOk(1000, 1000 + LYRICS_HOLD_MS))
check('никто не листал — ведём сами', () => autoScrollOk(0, 999999))

console.log('\n-- ИИ: метки времени --')
check('метка времени пишется в формате LRC', () =>
  stamp(0) === '[00:00.00]' && stamp(83.45) === '[01:23.45]')
check('округление сотых не даёт 100', () => stamp(9.999) === '[00:10.00]')
check('слова сравниваются без знаков и регистра', () =>
  words('Привет, МИР! (2 раза)').join('|') === 'привет|мир|2|раза')

const chunks: SpeechChunk[] = [
  { start: 10, end: 13, text: 'первая строка песни' },
  { start: 14, end: 17, text: 'вторая строка песни' },
  { start: 18, end: 21, text: 'третья строка песни' },
]

console.log('\n-- ИИ: распознанное в текст --')
check('из распознанного собирается LRC с метками', () => {
  const lrc = chunksToLrc(chunks, 200)
  if (!lrc) return false
  const l = parseLyrics(lrc)
  return l.synced && l.lines.length === 3 && l.lines[0].t === 10 && l.srcDur === 200
})
check('в тексте есть честная подпись, откуда он', () => {
  const lrc = chunksToLrc(chunks, 200) ?? ''
  return /Ponoi/.test(lrc) && /на слух/.test(lrc)
})
check('пустое и мусорное не попадает в текст', () => {
  const lrc = chunksToLrc([...chunks, { start: 30, end: 31, text: '(музыка)' }, { start: 40, end: 41, text: '  ' }], 200) ?? ''
  return !/музыка/.test(lrc) && parseLyrics(lrc).lines.filter(x => x.text.trim()).length === 3
})
check('двух строк для текста песни недостаточно', () =>
  chunksToLrc(chunks.slice(0, 2), 200) === null)
check('метки не идут назад, даже если модель их перепутала', () => {
  const lrc = chunksToLrc([
    { start: 10, end: 12, text: 'раз слова песни' },
    { start: 9, end: 11, text: 'два слова песни' },
    { start: 20, end: 22, text: 'три слова песни' },
  ], 100) ?? ''
  const ts = parseLyrics(lrc).lines.map(x => x.t ?? -1)
  return ts.every((t, i) => i === 0 || t > ts[i - 1])
})

console.log('\n-- ИИ: известные слова + услышанное время --')
const known = 'первая строка песни\nсередина без совпадений\nвторая строка песни\nтретья строка песни'
check('слова остаются свои, а время берётся распознанное', () => {
  const lrc = alignPlainToChunks(known, chunks, 200)
  if (!lrc) return false
  const l = parseLyrics(lrc)
  const texts = l.lines.filter(x => x.text.trim()).map(x => x.text)
  return l.synced && texts[0] === 'первая строка песни' && texts[1] === 'середина без совпадений'
    && l.lines[0].t === 10
})
check('строке без совпадения время достаётся между соседями', () => {
  const l = parseLyrics(alignPlainToChunks(known, chunks, 200) ?? '')
  const t = l.lines.map(x => x.t ?? -1)
  return t[1] > t[0] && t[1] < t[2]
})
check('чужое распознанное не притворяется разметкой', () => {
  const alien: SpeechChunk[] = [
    { start: 5, end: 6, text: 'completely different words here' },
    { start: 9, end: 10, text: 'nothing in common at all' },
    { start: 15, end: 16, text: 'another unrelated phrase' },
  ]
  return alignPlainToChunks(known, alien, 200) === null
})
check('короткие слова не склеивают что попало', () => {
  const short: SpeechChunk[] = [
    { start: 5, end: 6, text: 'и не на' }, { start: 8, end: 9, text: 'но и' }, { start: 12, end: 13, text: 'на не' },
  ]
  return alignPlainToChunks('и не на\nно и\nна не', short, 100) === null
})
check('уже проставленные метки в известных словах не мешают', () => {
  const l = alignPlainToChunks('[00:01.00]первая строка песни\n[00:02.00]вторая строка песни\n[00:03.00]третья строка песни', chunks, 200)
  return !!l && parseLyrics(l).lines[0].t === 10
})

console.log('\n-- ИИ: достройка пропусков --')
check('пропуски между известными заполняются ровно', () => {
  const t: (number | null)[] = [10, null, null, 40]
  fillGaps(t, 100)
  return t[1] === 20 && t[2] === 30
})
check('до первой известной метки идут назад, но не в минус', () => {
  const t: (number | null)[] = [null, null, 5, 10]
  fillGaps(t, 100)
  return (t[0] as number) >= 0 && (t[0] as number) < (t[1] as number) && (t[1] as number) < 5
})
check('после последней не уезжают за конец записи', () => {
  const t: (number | null)[] = [10, 20, null, null]
  fillGaps(t, 25)
  return (t[3] as number) <= 25
})

console.log('\n-- ИИ: когда распознавать нечего --')
check('у встроенных проигрывателей звука нет — говорим прямо', () =>
  (whyCantRecognize('https://x/a.mp3', true) ?? '').includes('YouTube'))
check('без ссылки на звук распознавать нечего', () => whyCantRecognize(undefined, false) !== null)
check('обычный файл распознать можно', () => whyCantRecognize('https://x/a.mp3', false) === null)

console.log('\n-- Ломаем нарочно (ИИ) --')
check('проверка заметила бы, что мусор перестали отбрасывать', () => {
  const lrc = chunksToLrc([...chunks, { start: 30, end: 31, text: 'обычные слова тут' }], 200) ?? ''
  return /обычные слова тут/.test(lrc)
})
check('проверка заметила бы, что порог совпадений убрали', () => {
  const half: SpeechChunk[] = [
    { start: 5, end: 6, text: 'первая строка песни' },
    { start: 9, end: 10, text: 'вторая строка песни' },
    { start: 15, end: 16, text: 'третья строка песни' },
  ]
  return alignPlainToChunks(known, half, 100) !== null
})

console.log('\n── Как едет текст (v1.435.0) ──')
check('соседняя строка — быстро', () => lyricsScrollMs(60) < 350)
check('далёкий прыжок дольше, но не бесконечно', () =>
  lyricsScrollMs(2000) === 900 && lyricsScrollMs(200) > lyricsScrollMs(60))
check('вверх и вниз едем одинаково', () => lyricsScrollMs(-300) === lyricsScrollMs(300))
check('даже нулевой сдвиг не мгновенный', () => lyricsScrollMs(0) >= 240)
check('движение начинается в нуле и кончается в единице', () =>
  lyricsEase(0) === 0 && lyricsEase(1) === 1)
check('к концу движение замедляется, а не рвётся', () => {
  const начало = lyricsEase(0.1) - lyricsEase(0)
  const конец = lyricsEase(1) - lyricsEase(0.9)
  return начало > конец
})
check('строка не проезжает мимо и не возвращается', () => {
  // Отскок читался бы как «текст дёрнулся»: значения выше единицы запрещены.
  for (let p = 0; p <= 1.0001; p += 0.01) if (lyricsEase(p) > 1) return false
  return true
})
check('за пределами отрезка ничего не ломается', () =>
  lyricsEase(-5) === 0 && lyricsEase(9) === 1)

console.log('\n── Исполнитель при выборе текста (v1.435.0) ──')
// Ровно тот случай, который принёс владелец: у песни то же название, но другой
// автор — и до этой версии побеждала чужая запись, потому что у неё были метки.
const ЧУЖОЙ = { trackName: 'Осень', artistName: 'Другая Группа', syncedLyrics: '[00:01.00]чужой текст', duration: 200 }
const СВОЙ = { trackName: 'Осень', artistName: 'ДДТ', plainLyrics: 'свой текст', duration: 200 }

check('свой исполнитель важнее меток времени у чужого', () => {
  const r = pickLyrics([ЧУЖОЙ, СВОЙ], 200, { title: 'Осень', artist: 'ДДТ' })
  return r!.artistName === 'ДДТ'
})
check('среди своих же берём ту, что с метками', () => {
  const r = pickLyrics([
    { trackName: 'Осень', artistName: 'ДДТ', plainLyrics: 'без меток', duration: 200 },
    { trackName: 'Осень', artistName: 'ДДТ', syncedLyrics: '[00:01.00]с метками', duration: 200 },
  ], 200, { title: 'Осень', artist: 'ДДТ' })
  return !!r!.syncedLyrics
})
check('исполнитель узнаётся с припиской', () => {
  const r = pickLyrics([ЧУЖОЙ, { ...СВОЙ, artistName: 'ДДТ (Юрий Шевчук)' }], 200, { title: 'Осень', artist: 'ДДТ' })
  return r!.artistName === 'ДДТ (Юрий Шевчук)'
})
check('чужой текст не берётся вовсе, если длина другая', () =>
  pickLyrics([{ ...ЧУЖОЙ, duration: 320 }], 200, { title: 'Осень', artist: 'ДДТ' }) === null)
check('чужого автора пускаем при точном совпадении длины', () => {
  // Тот же самый трек, просто автор в каталоге записан иначе — длина выдаёт.
  const r = pickLyrics([{ ...ЧУЖОЙ, artistName: 'DDT', duration: 202 }], 200, { title: 'Осень', artist: 'ДДТ' })
  return !!r && r.artistName === 'DDT'
})
check('когда своего автора не знаем — работает как раньше', () => {
  const r = pickLyrics([ЧУЖОЙ, СВОЙ], 200)
  return r!.artistName === 'Другая Группа'
})
check('сверка имён не путает разных людей', () =>
  !sameName('Король и Шут', 'Ленинград') && sameName('Король и Шут', 'КОРОЛЬ И ШУТ (KiSh)'))

console.log('\n-- Ломаем нарочно (выбор текста) --')
check('проверка заметила бы возврат к выбору без исполнителя', () => {
  // Прежнее правило: метки времени решают всё. На этих же данных оно берёт
  // чужую запись, а нынешнее — свою.
  const прежнее = [ЧУЖОЙ, СВОЙ].sort((a: any, b: any) =>
    (b.syncedLyrics ? 1000 : 0) - (a.syncedLyrics ? 1000 : 0))[0]
  const теперь = pickLyrics([ЧУЖОЙ, СВОЙ], 200, { title: 'Осень', artist: 'ДДТ' })
  return прежнее.artistName === 'Другая Группа' && теперь!.artistName === 'ДДТ'
})

console.log('\nИТОГ: пройдено ' + pass + ', провалено ' + fail)
if (fail) process.exit(1)
