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

import { slashPrefix, parseSlash, buildArgs, splitArgs, argHint } from './slashCmd'

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

console.log('\n── Доводы доходят до бота ──')
// Готовые боты заводятся с пустым options, и до v1.359.0 всё написанное после
// команды выбрасывалось: «/шар завтра дождь?» приходил к боту без вопроса вовсе.
check('у команды без описанных доводов текст не теряется', () => {
  const p = parseSlash('/шар завтра идти в туалет?')
  return !!p && buildArgs(p.rest, []).text === 'завтра идти в туалет?'
})
check('число для кубика доходит', () => {
  const p = parseSlash('/кубик 20')
  return !!p && buildArgs(p.rest, []).text === '20'
})
check('варианты с палками доходят целиком', () => {
  const p = parseSlash('/выбери чай | кофе | сон')
  return !!p && buildArgs(p.rest, []).text === 'чай | кофе | сон'
})
check('вопрос шару доходит целиком', () => {
  const p = parseSlash('/шар Стоит ли деплоить в пятницу?')
  return !!p && buildArgs(p.rest, []).text === 'Стоит ли деплоить в пятницу?'
})
check('команда без довода не выдумывает пустой', () => {
  const p = parseSlash('/монетка')
  return !!p && buildArgs(p.rest, []).text === undefined
})
check('описанные доводы по-прежнему раскладываются', () => {
  const a = buildArgs('вася 5', [{ name: 'кому' }, { name: 'сколько' }])
  return a['кому'] === 'вася' && a['сколько'] === '5'
})
check('свой довод по имени text главнее подстраховки', () => {
  const a = buildArgs('привет мир', [{ name: 'text' }])
  return a.text === 'привет'
})

console.log('\n── Доводы команды и подсказки (v1.475.0) ──')
{
  const доводы = [
    { name: 'вопрос', required: true },
    { name: 'варианты' },
  ]
  check('пока довод набирается, он ещё не значение', () => {
    const s = splitArgs('пиц', доводы)
    return s.current === 0 && s.prefix === 'пиц' && s.values['вопрос'] === undefined
  })
  check('пробел после слова переводит к следующему доводу', () => {
    const s = splitArgs('пицца ', доводы)
    return s.values['вопрос'] === 'пицца' && s.current === 1 && s.prefix === ''
  })
  check('последний довод забирает весь остаток', () => {
    // Иначе «/опрос пицца да, нет, может» дошло бы до плагина как «да,».
    const s = splitArgs('пицца да, нет, может', доводы)
    return s.values['вопрос'] === 'пицца' && s.values['варианты'] === 'да, нет, может'
  })
  check('единственный довод — это вся строка', () => {
    const s = splitArgs('позвонить маме', [{ name: 'что' }])
    return s.values['что'] === 'позвонить маме' && s.current === 0
  })
  check('пустая строка — набирается первый довод', () => {
    const s = splitArgs('', доводы)
    return s.current === 0 && s.prefix === '' && Object.keys(s.values).length === 0
  })
  check('без объявленных доводов подсказывать нечего', () => {
    const s = splitArgs('что угодно', [])
    return s.current === -1 && Object.keys(s.values).length === 0
  })
  check('подсказка выделяет текущий довод и помнит обязательные', () => {
    const h = argHint(доводы, 1)
    return h.length === 2 && h[0].req === true && h[0].on === false && h[1].on === true
  })
  check('за пределы списка доводов подсказка не уезжает', () => {
    const s = splitArgs('a b c d e ', доводы)
    return s.current === доводы.length - 1
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
check('проверка заметила бы потерю довода', () => {
  // Ровно тот разбор, что стоял до v1.359.0: без описанных доводов — пусто,
  // и бот получал команду без единого слова из того, что ему написали.
  const oldWay = (rest: string, options: { name: string }[]) => {
    const args: Record<string, string> = {}
    const parts = rest.split(/\s+/).filter(Boolean)
    options.forEach((o, i) => { if (parts[i] !== undefined) args[o.name] = parts[i] })
    return args
  }
  return oldWay('завтра дождь?', []).text === undefined
    && buildArgs('завтра дождь?', []).text === 'завтра дождь?'
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
