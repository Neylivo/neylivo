// v1.394.0: проверка разбора текста песни. Запуск: npm run test:lyrics
//
// Зачем. Разбор решает две вещи, каждая из которых видна человеку сразу.
// Первая — караоке это или нет: назвать караоке текст без меток времени значит
// показать неподвижную простыню и подсветку невпопад. Вторая — на какой секунде
// какая строка: ошибка тут разъезжается с песней, и это ровно то, ради чего всё
// затевалось. Плюс LRC приходит из чужих рук — с сотыми через двоеточие, со
// сдвигом [offset], с повторами припева и просто с мусором.
export {}

import { parseLyrics, activeLineIndex, pickLyrics } from './lyrics'

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

console.log('\n── Ломаем нарочно ──')
check('проверка заметила бы, что метки времени перестали разбираться', () => {
  // Если бы разбор возвращал t=null, караоке молча превратилось бы в простыню.
  const l = parseLyrics('[00:10.00]раз\n[00:20.00]два')
  return l.lines.every(x => typeof x.t === 'number')
})
check('проверка заметила бы, что synced ставится всегда', () => !parseLyrics('просто текст\nбез меток').synced)

console.log('\nИТОГ: пройдено ' + pass + ', провалено ' + fail)
if (fail) process.exit(1)
