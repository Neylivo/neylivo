// v1.356.0: проверка разбора слэш-команд.
//
// Зачем. Здесь была настоящая поломка, которую нельзя увидеть глазами: команды
// ботов искались через \w — только латиница. Все готовые боты называют команды
// по-русски (/кубик, /опрос, /шар), поэтому подсказка не появлялась, а набранная
// целиком команда уходила в чат обычным текстом. Бот выглядел мёртвым, хотя
// работал. Проверяем именно то, что было сломано, — на настоящих именах команд.
//
// Запуск: npm run test:slash
export {}

import { slashPrefix, parseSlash } from './slashCmd'

let pass = 0, fail = 0
function check(name: string, fn: () => boolean) {
  let ok = false, err = ''
  try { ok = fn() } catch (e: any) { err = e?.message ?? String(e) }
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  ПРОВАЛ ' + name + (err ? ' — ' + err : '')) }
}

// Ровно те имена, что заводит bot-create для готовых ботов.
const REAL = ['кубик', 'монетка', 'выбери', 'опрос', 'статистика', 'шар']

console.log('── Подсказка по началу имени ──')
check('русская команда подсказывается', () => slashPrefix('/ку') === 'ку')
check('пустое начало сразу после «/»', () => slashPrefix('/') === '')
check('латиница по-прежнему работает', () => slashPrefix('/he') === 'he')
check('регистр приводится к нижнему', () => slashPrefix('/КУ') === 'ку')
check('дефис и цифры в имени', () => slashPrefix('/git-log2') === 'git-log2')
check('после пробела подсказки нет', () => slashPrefix('/кубик 20') === null)
check('обычный текст — не команда', () => slashPrefix('привет') === null)
check('косая не в начале — не команда', () => slashPrefix('см. /кубик') === null)

console.log('\n── Готовая команда ──')
check('русская команда разбирается', () => {
  const p = parseSlash('/кубик')
  return p?.name === 'кубик' && p.rest === ''
})
check('довод после команды', () => {
  const p = parseSlash('/кубик 20')
  return p?.name === 'кубик' && p.rest === '20'
})
check('довод с пробелами и палками', () => {
  const p = parseSlash('/выбери чай | кофе | сон')
  return p?.name === 'выбери' && p.rest === 'чай | кофе | сон'
})
check('лишние пробелы по краям не мешают', () => parseSlash('  /монетка  ')?.name === 'монетка')
check('без имени — не команда', () => parseSlash('/') === null)
check('обычный текст — не команда', () => parseSlash('когда /кубик') === null)

console.log('\n── Все команды готовых ботов ──')
for (const n of REAL) {
  check(`«/${n}» распознаётся целиком`, () => parseSlash('/' + n)?.name === n)
  check(`«/${n}» подсказывается по началу`, () => {
    const half = '/' + n.slice(0, 2)
    const pre = slashPrefix(half)
    return pre !== null && n.startsWith(pre)
  })
}

console.log('\n── Ломаем нарочно ──')
check('проверка заметила бы возврат к \\w', () => {
  // Ровно та регулярка, что стояла до v1.356.0. Если кто-то вернёт её обратно,
  // тесты выше покраснеют — а этот показывает, чем именно она плоха.
  const old = /^\/(\w*)$/
  const nowWorks = slashPrefix('/ку') === 'ку'
  return !old.test('/ку') && nowWorks
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
