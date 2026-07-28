// v1.352.0: проверка подсказки эмодзи по «:».
//
// Зачем. Подсказка живёт в поле ввода — самом горячем месте приложения, и
// ошибиться тут дорого: сработает на «https://» — и человек получит выпадающий
// список посреди ссылки; ошибёмся с длиной хвоста — и вставка съест соседние
// буквы. Читать это по коду бесполезно, поэтому здесь разбор хвоста и поиск
// прогоняются на настоящих строках, включая те, где подсказки быть НЕ должно.
//
// Запуск: npm run test:emoji
export {}

import { emojiQueryAt, searchEmojiNames, EMOJI_NAMES } from './emojiNames'

let pass = 0, fail = 0
function check(name: string, fn: () => boolean) {
  let ok = false, err = ''
  try { ok = fn() } catch (e: any) { err = e?.message ?? String(e) }
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  ПРОВАЛ ' + name + (err ? ' — ' + err : '')) }
}

console.log('── Когда подсказка должна появиться ──')
check('в начале строки', () => emojiQueryAt(':ог', 3) === 'ог')
check('после пробела', () => emojiQueryAt('привет :ог', 10) === 'ог')
check('после переноса строки', () => emojiQueryAt('строка\n:fi', 10) === 'fi')
check('только слева от курсора', () => emojiQueryAt(':ого хвост', 4) === 'ого')
check('латиница и цифры', () => emojiQueryAt(':pepe2', 6) === 'pepe2')

console.log('\n── Когда подсказки быть не должно ──')
check('внутри ссылки', () => emojiQueryAt('https://ex', 10) === null)
check('во времени 12:30', () => emojiQueryAt('в 12:30', 7) === null)
check('на одной букве', () => emojiQueryAt(':о', 2) === null)
check('на пустом двоеточии', () => emojiQueryAt(':', 1) === null)
check('когда уже закрыли вторым двоеточием', () => emojiQueryAt(':pepe:', 6) === null)
check('после пробела за хвостом', () => emojiQueryAt(':pepe ', 6) === null)

console.log('\n── Вставка не должна съедать соседний текст ──')
check('длина хвоста считается вместе с двоеточием', () => {
  const text = 'привет :огонь'
  const caret = text.length
  const q = emojiQueryAt(text, caret)
  if (q === null) return false
  const start = caret - (q.length + 1)
  // Ровно на этой позиции стоит само двоеточие — значит вставка заменит хвост
  // целиком и не тронет слово «привет».
  return text[start] === ':' && text.slice(0, start) === 'привет '
})

console.log('\n── Поиск по имени ──')
check('русское имя находит символ', () => searchEmojiNames('огон')[0]?.char === '🔥')
check('английское имя находит тот же символ', () => searchEmojiNames('fire')[0]?.char === '🔥')
check('совпадение с начала идёт раньше', () => {
  const r = searchEmojiNames('ко')
  return r.length > 0 && r.every(e => e.char) && r[0].name.startsWith('ко')
})
check('пустой запрос ничего не даёт', () => searchEmojiNames('').length === 0)
check('несуществующее имя ничего не даёт', () => searchEmojiNames('щщщщ').length === 0)
check('лимит соблюдается', () => searchEmojiNames('о', 3).length <= 3)
check('символы в выдаче не повторяются', () => {
  const r = searchEmojiNames('о', 8)
  return new Set(r.map(e => e.char)).size === r.length
})

console.log('\n── Сам список имён ──')
check('имена в нижнем регистре и без пробелов', () =>
  EMOJI_NAMES.every(e => e.name === e.name.toLowerCase().trim() && !/\s/.test(e.name)))
check('у каждого имени есть символ', () => EMOJI_NAMES.every(e => !!e.char))
check('имена не повторяются', () =>
  new Set(EMOJI_NAMES.map(e => e.name)).size === EMOJI_NAMES.length)

console.log('\n── Ломаем нарочно ──')
check('проверка заметила бы срабатывание внутри слова', () => {
  // Если бы требование «начало строки или пробел» пропало, время «12:30» дало бы
  // хвост «30». Сверяем с настоящим разбором — так поломка видна, а не угадывается.
  const broken = /:([\p{L}\p{N}_+-]{2,32})$/u
  return broken.test('в 12:30') && emojiQueryAt('в 12:30', 7) === null
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
