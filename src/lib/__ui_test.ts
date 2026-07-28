// v1.358.0: проверки мелких правил интерфейса.
//
// Сюда попадает то, от чего зависит, что человек увидит, но что живёт не в
// разметке: пороги, разбор строк, границы. Разметку проверяет смоук, а это —
// правила, у которых есть «слишком рано» и «слишком поздно».
//
// Запуск: npm run test:ui
export {}

import { isLongText, LONG_LINES, LONG_CHARS } from './longText'

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

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
