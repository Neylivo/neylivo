// v1.427.0: проверка кнопки «назад» на телефоне. Запуск: npm run test:back
//
// Зачем в окне, а не в обычном Node. Ловушка «назад» держится на настоящей
// истории браузера: pushState, событие popstate, порядок записей. Подделать это
// заглушкой можно, но проверять тогда будет нечего — вся суть в том, как
// реагирует настоящая история.
//
// Что здесь ловится. Первая версия ставила свой обработчик popstate каждой
// ловушке, и одно нажатие «назад» закрывало ВСЕ открытые окна разом: событие
// приходит всем слушателям. Нашлось это ровно такой проверкой, поэтому она и
// осталась в наборе.
export {}

import { pushBackTrap, backTrapDepth } from './mobileBack'

let pass = 0, fail = 0
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  ПРОВАЛ ' + name + (extra ? ' — ' + extra : '')) }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

;(async () => {
  console.log('── Одно окно ──')
  const было = history.length
  let закрыто = 0
  pushBackTrap(() => { закрыто++ })
  check('в истории появилась одна запись', history.length - было === 1, 'прибавилось ' + (history.length - было))
  check('окно держит «назад»', backTrapDepth() === 1)
  history.back(); await wait(150)
  check('«назад» закрыла окно', закрыто === 1, 'закрытий ' + закрыто)
  check('ловушка снялась', backTrapDepth() === 0)

  console.log('\n── Закрыли своими руками ──')
  let сам = 0
  const снять = pushBackTrap(() => { сам++ })
  снять()
  await wait(120)
  check('обработчик больше не срабатывает', сам === 0, 'срабатываний ' + сам)
  check('запись из истории убрана', backTrapDepth() === 0)

  console.log('\n── Два окна друг над другом ──')
  let низ = 0, верх = 0
  pushBackTrap(() => { низ++ })
  pushBackTrap(() => { верх++ })
  check('оба держат «назад»', backTrapDepth() === 2)
  history.back(); await wait(180)
  // Главное: одно нажатие закрывает ТОЛЬКО верхнее окно. Раньше закрывались оба.
  check('одно «назад» закрыло только верхнее', верх === 1 && низ === 0, `верх ${верх}, низ ${низ}`)
  check('нижнее ещё держит', backTrapDepth() === 1)
  history.back(); await wait(180)
  check('второе «назад» закрыло нижнее', низ === 1, 'низ ' + низ)
  check('ловушек не осталось', backTrapDepth() === 0)

  console.log('\n── Ломаем нарочно ──')
  // Прежнее поведение: у каждой ловушки свой слушатель. Событие приходит всем —
  // и одно «назад» закрывает всё открытое.
  let былоБы = 0
  const l1 = () => { былоБы++ }
  const l2 = () => { былоБы++ }
  window.addEventListener('popstate', l1)
  window.addEventListener('popstate', l2)
  history.pushState({}, '')
  history.back(); await wait(180)
  window.removeEventListener('popstate', l1)
  window.removeEventListener('popstate', l2)
  check('проверка заметила бы возврат к слушателю на каждое окно', былоБы === 2, 'срабатываний ' + былоБы)

  console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
  ;(window as any).__done = fail ? 'ПРОВАЛ' : 'ОК'
})()
