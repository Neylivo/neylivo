// v1.532.0: в разметке нет классов без стилей. Запуск: npm run test:naked
//
// Владелец прислал снимок экрана друзей: «Сейчас никого нет в сетиСтатус не
// мешает разговору — можно написать сейчас.Показать всех друзей Новая беседа» —
// всё слиплось в строку, кнопки серыми прямоугольниками. Причина оказалась
// простой и обидной: разметку переписали, а стилей к новым классам не написали
// ни одного. Браузер честно нарисовал голый html.
//
// Ошибки при этом нет нигде: ни в сборке, ни в типах, ни в одной проверке. Экран
// просто разваливается — и увидеть это можно только глазами или вот так.
//
// Что делает проверка: собирает все имена классов из наших компонентов и все
// имена классов из наших стилей, и сообщает о тех, что есть в разметке и не
// упомянуты в стилях НИ РАЗУ.
//
// Чего она НЕ делает: не判 судит, достаточно ли стилей. Класс, у которого есть
// хоть одно правило, считается одетым — за остальное отвечают глаза и снимки.
const fs = require('fs')
const path = require('path')

const КОРЕНЬ = path.join(__dirname, '..')
const СТИЛИ = ['src/styles.css', 'src/neylivo-ui.css']

/** Все .tsx приложения, кроме проверок и стендов. */
function файлы(dir, out = []) {
  for (const имя of fs.readdirSync(dir)) {
    const p = path.join(dir, имя)
    if (fs.statSync(p).isDirectory()) { файлы(p, out); continue }
    if (!/\.tsx$/.test(имя) || имя.startsWith('__')) continue
    out.push(p)
  }
  return out
}

// className="a b" и className={'a' + (x ? ' b' : '')} — берём все строковые куски.
function классыИзРазметки(текст) {
  const из = new Set()
  for (const m of текст.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    const кусок = m[1] ?? m[2] ?? ''
    for (const s of кусок.matchAll(/'([^']*)'|"([^"]*)"/g)) {
      for (const к of (s[1] ?? s[2] ?? '').split(/\s+/)) {
        const чистое = к.trim()
        if (/^[a-z][a-z0-9-]{2,}$/.test(чистое)) из.add(чистое)
      }
    }
    if (m[1]) for (const к of m[1].split(/\s+/)) {
      const чистое = к.trim()
      if (/^[a-z][a-z0-9-]{2,}$/.test(чистое)) из.add(чистое)
    }
  }
  return из
}

const css = СТИЛИ.map(f => fs.readFileSync(path.join(КОРЕНЬ, f), 'utf8')).join('\n')
const вСтилях = new Set()
for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)/g)) вСтилях.add(m[1])

let failed = 0
const голые = []
for (const f of файлы(path.join(КОРЕНЬ, 'src'))) {
  const текст = fs.readFileSync(f, 'utf8')
  for (const к of классыИзРазметки(текст)) {
    if (вСтилях.has(к)) continue
    голые.push(path.relative(КОРЕНЬ, f).replace(/\\/g, '/') + ' -> .' + к)
  }
}

// ПОЧЕМУ СПИСОК-ОСНОВА, А НЕ «НИ ОДНОГО ГОЛОГО».
//
// Прямой запрет ловит и то, что классом не является вовсе: значения вкладок
// ('gifs', 'url'), куски имён, собираемых на лету ('fcard-' + вид), пометки на
// частях svg. Разбирать это по-настоящему — писать разбор JSX, а такая проверка
// сама станет источником ошибок.
//
// Поэтому фиксируется СЕГОДНЯШНЕЕ положение: всё, что найдено сейчас, записано
// в naked-baseline.json как принятое. Проверка падает только на НОВОМ голом
// классе — то есть ровно тогда, когда кто-то опять напишет разметку без стилей.
// Именно так пропал экран друзей.
const ОСНОВА = path.join(__dirname, 'naked-baseline.json')
let принятые = []
try { принятые = JSON.parse(fs.readFileSync(ОСНОВА, 'utf8')) } catch { /* основы ещё нет */ }
const принято = new Set(принятые)
const новые = голые.filter(г => !принято.has(г))
// Служебный ход: с --write список нынешних записывается в основу.
if (process.argv.includes('--write')) {
  fs.writeFileSync(ОСНОВА, JSON.stringify(голые.slice().sort(), null, 1) + String.fromCharCode(10))
  console.log('в основу записано: ' + голые.length)
  process.exit(0)
}

console.log('── Классы в разметке без единого стиля ──')
console.log('   принято как есть: ' + принято.size + ', новых: ' + новые.length)
if (новые.length === 0) {
  console.log('  ok   новых голых классов нет')
} else {
  failed = 1
  for (const г of новые.slice(0, 40)) console.log('  ПРОВАЛ ' + г)
  if (новые.length > 40) console.log('  …и ещё ' + (новые.length - 40))
  console.log('  Одеть их стилями — или, если это не класс, дописать в scripts/naked-baseline.json')
}
console.log('\nИТОГ: провалено ' + failed)
process.exit(failed)
