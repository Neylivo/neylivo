// v1.344.0: плагины без единой строчки кода.
//
// Конструктор из v1.336.0 сильно помог тем, кто программирует: не надо помнить
// формат шапки. Но человеку, который кода не знает вовсе, он не помог ничем —
// перед ним всё равно поле с JavaScript.
//
// Здесь — готовые «рецепты»: человек выбирает, что должно происходить, и
// заполняет одно-два поля обычными словами. Код собирается сам, из проверенных
// кусков. Результат — обычный плагин, который можно потом открыть в коде и
// доделать руками: никакого отдельного «упрощённого формата» не заводим.
import type { Permission } from './types'

export interface RecipeField {
  key: string
  label: string
  placeholder: string
  /** Многострочное поле — для текстов ответов. */
  multiline?: boolean
  /** Выбор цвета вместо текста. */
  color?: boolean
  value: string
}

export interface Recipe {
  key: string
  emoji: string
  label: string
  /** Что получится — одной фразой, до заполнения полей. */
  hint: string
  permissions: Permission[]
  fields: RecipeField[]
  /** Собирает тело плагина из заполненных полей. */
  build: (v: Record<string, string>) => string
}

/** Строка в кавычках для вставки в код: чужой текст не должен ломать синтаксис. */
export function q(s: string): string {
  return JSON.stringify(String(s ?? ''))
}

export const RECIPES: Recipe[] = [
  {
    key: 'command',
    emoji: '💬',
    label: 'Команда с ответом',
    hint: 'Пишешь /команду — плагин отправляет заготовленный текст',
    permissions: ['commands', 'messages.write'],
    fields: [
      { key: 'cmd', label: 'Команда', placeholder: 'правила', value: 'правила' },
      { key: 'text', label: 'Что отправить', placeholder: 'Не ругаться, не спамить.', multiline: true, value: '' },
    ],
    build: v => `function onLoad(neylivo) {
  neylivo.commands.register(${q(v.cmd)}, ${q('Отправить: ' + v.text.slice(0, 60))}, async () => {
    await neylivo.messages.send(${q(v.text)})
  })
}`,
  },
  {
    key: 'reply',
    emoji: '🔔',
    label: 'Отвечать на слово',
    hint: 'Кто-то написал нужное слово — плагин отвечает сам',
    permissions: ['messages.read', 'messages.write'],
    fields: [
      { key: 'word', label: 'Слово или фраза', placeholder: 'привет', value: 'привет' },
      { key: 'text', label: 'Что ответить', placeholder: 'И тебе привет!', multiline: true, value: '' },
    ],
    build: v => `function onLoad(neylivo) {
  var word = ${q(v.word.toLowerCase())}
  neylivo.on('message', async function (msg) {
    // Своё же сообщение пропускаем — иначе плагин ответит сам себе.
    if (msg.mine) return
    var text = String(msg.content || '').toLowerCase()
    if (text.indexOf(word) === -1) return
    await neylivo.messages.send(${q(v.text)})
  })
}`,
  },
  {
    key: 'notify',
    emoji: '👀',
    label: 'Замечать упоминания',
    hint: 'Тебя упомянули — всплывает заметное уведомление',
    permissions: ['messages.read', 'notify'],
    fields: [
      { key: 'text', label: 'Текст уведомления', placeholder: 'Тебя зовут!', value: 'Тебя зовут!' },
    ],
    build: v => `function onLoad(neylivo) {
  neylivo.on('message', function (msg) {
    if (!msg.mentionsMe) return
    neylivo.notify(${q(v.text)} + ' — ' + msg.authorName)
  })
}`,
  },
  {
    key: 'colors',
    emoji: '🎨',
    label: 'Свои цвета',
    hint: 'Перекрашивает подсветку и рамку выбранного канала',
    permissions: ['css'],
    fields: [
      { key: 'accent', label: 'Цвет', placeholder: '#5865f2', color: true, value: '#5865f2' },
    ],
    build: v => `function onLoad(neylivo) {
  var c = ${q(v.accent)}
  neylivo.css([
    '.ch.on { border-left: 3px solid ' + c + '; }',
    '.msg:hover { background: ' + c + '1a !important; }',
    '.pqs2-item.on { box-shadow: inset 2px 0 0 ' + c + '; }',
  ].join('\\n'))
}`,
  },
  {
    key: 'timer',
    emoji: '⏰',
    label: 'Напоминалка',
    hint: 'Команда /напомни через сколько минут — и о чём',
    permissions: ['commands', 'notify'],
    fields: [
      { key: 'cmd', label: 'Команда', placeholder: 'напомни', value: 'напомни' },
    ],
    build: v => `function onLoad(neylivo) {
  neylivo.commands.register(${q(v.cmd)}, 'Напомнить через N минут: /' + ${q(v.cmd)} + ' 10 чай', function (arg) {
    var m = String(arg || '').trim().match(/^(\\d+)\\s*(.*)$/)
    if (!m) { neylivo.notify('Напиши так: 10 заварить чай'); return }
    var mins = parseInt(m[1], 10)
    if (!mins || mins > 720) { neylivo.notify('От 1 до 720 минут'); return }
    var what = m[2] || 'Напоминание'
    neylivo.notify('Напомню через ' + mins + ' мин')
    setTimeout(function () { neylivo.notify('⏰ ' + what) }, mins * 60000)
  })
}`,
  },
]

/** Значения полей рецепта по умолчанию. */
export function recipeDefaults(r: Recipe): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of r.fields) out[f.key] = f.value
  return out
}

/** Всё ли заполнено — пустой рецепт собрал бы плагин, который ничего не делает. */
export function recipeReady(r: Recipe, v: Record<string, string>): boolean {
  return r.fields.every(f => String(v[f.key] ?? '').trim().length > 0)
}
