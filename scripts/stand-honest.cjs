// Стенд не выдумывает разметку. Запуск: npm run test:stand
//
// Владелец: «у тебя на примерах красивей чем в реальности».
//
// Причина была одна: снимки делались с разметки, которую я писал руками «по
// мотивам» компонентов. Такая разметка всегда аккуратнее настоящей, а иногда и
// вовсе про другое — в стенде годами жил класс .me-bar, которого в приложении
// нет вовсе.
//
// Здесь проверяется простое и проверяемое утверждение: КАЖДЫЙ класс, который
// стенд рисует, встречается в исходниках приложения. Это не гарантирует, что
// разметка совпадает целиком, — но выдуманное ловит сразу, а именно оно и
// делает снимки красивее жизни.
//
// Чего эта проверка НЕ умеет и врать об этом не будет: она не видит лишних
// обёрток и не сверяет вложенность. Настоящий вид показывает npm run look:real,
// где на страницу монтируются сами компоненты.
const fs = require('fs')
const path = require('path')

const КОРЕНЬ = path.join(__dirname, '..')
const СТЕНДЫ = [
  path.join(КОРЕНЬ, 'scripts', 'screens.cjs'),
  path.join(КОРЕНЬ, 'scripts', 'button-gallery.cjs'),
  path.join(КОРЕНЬ, 'scripts', 'layout-test.cjs'),
  path.join(КОРЕНЬ, 'scripts', 'mobile-test.cjs'),
]

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

/** Все классы, которые встречаются в исходниках приложения. */
function классыПриложения() {
  const из = new Set()
  const идти = д => {
    for (const ф of fs.readdirSync(д)) {
      const п = path.join(д, ф)
      if (fs.statSync(п).isDirectory()) { идти(п); continue }
      if (!/\.(tsx?|css)$/.test(ф)) continue
      const т = fs.readFileSync(п, 'utf8')
      // className="a b", className={'a' + (x ? ' b' : '')}, class="a b" и
      // селекторы из css: всё, что похоже на имя класса.
      for (const m of т.matchAll(/class(?:Name)?\s*=\s*[{"']([^"'}]+)/g)) {
        for (const c of m[1].split(/[\s'"+`{}()?:]+/)) if (/^[a-z][\w-]*$/i.test(c)) из.add(c)
      }
      // Имена классов приходят и строками с пробелами: 'chat pfr-chat',
      // ' srv-muted'. Разбираем такие строки на слова, иначе честные классы
      // выглядят выдуманными, и проверка ругается на пустом месте.
      const строки = /(['"])([^'"\n]{1,80})\1/g
      for (const m of т.matchAll(строки)) {
        for (const c of m[2].split(/\s+/)) if (/^[a-z][\w-]*$/i.test(c)) из.add(c)
      }
      // И селекторы из css — там классы короче трёх букв тоже бывают (.av).
      for (const m of т.matchAll(/\.([a-z][\w-]*)/gi)) из.add(m[1])
    }
  }
  идти(path.join(КОРЕНЬ, 'src'))
  return из
}

/** Классы, которые рисует стенд. */
function классыСтенда(файл) {
  const т = fs.readFileSync(файл, 'utf8')
  const из = new Set()
  for (const m of т.matchAll(/class\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/i.test(c)) из.add(c)
  }
  return из
}

console.log('\n── Стенд рисует то, что есть в приложении ──')

const свои = классыПриложения()
// Классы стендов, которых в приложении нет по делу: это подпорки самого стенда.
const ПОДПОРКИ = new Set(['look-row', 'look-lbl', 'look-btns', 'ri', 'notr'])

let всего = 0
const выдуманные = []
for (const ф of СТЕНДЫ) {
  if (!fs.existsSync(ф)) continue
  for (const c of классыСтенда(ф)) {
    всего++
    if (ПОДПОРКИ.has(c) || свои.has(c)) continue
    выдуманные.push(c + ' (' + path.basename(ф) + ')')
  }
}

check('в стендах нет выдуманных классов (' + всего + ' проверено)',
  выдуманные.length === 0, [...new Set(выдуманные)].slice(0, 10).join(', '))

console.log('\nИТОГ: провалено ' + failed)
process.exit(failed ? 1 : 0)
