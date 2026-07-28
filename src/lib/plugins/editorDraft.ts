// v1.336.0: чистая часть конструктора плагинов — заготовки, сборка шапки и
// разбор готового плагина обратно в форму.
//
// Отдельно от компонента намеренно: всё это можно и нужно проверять без
// браузера (см. npm run test:plugins). Конструктор, который собирает шапку с
// ошибкой, хуже, чем его отсутствие: человек не поймёт, он ли виноват.
import { parsePlugin } from './manifest'
import type { Permission } from './types'

export interface Draft {
  name: string
  id: string
  version: string
  description: string
  permissions: Permission[]
  hosts: string
  body: string
}

export interface Template {
  key: string
  label: string
  emoji: string
  hint: string
  permissions: Permission[]
  body: string
}

export const TEMPLATES: Template[] = [
  {
    key: 'command', label: 'Своя команда', emoji: '⌨️',
    hint: 'Команда в чате, которая что-то отправляет',
    permissions: ['commands', 'messages.write'],
    body: `function onLoad(ponoi) {
  ponoi.commands.register('привет', 'Поздороваться', async (arg) => {
    await ponoi.messages.send('Привет' + (arg ? ', ' + arg : '') + '!')
  })
}`,
  },
  {
    key: 'style', label: 'Оформление', emoji: '🎨',
    hint: 'Свои цвета и стили поверх приложения',
    permissions: ['css'],
    body: `function onLoad(ponoi) {
  ponoi.css([
    '.msg:hover { background: rgba(88,101,242,.10) !important; }',
    '.ch.on { border-left: 3px solid var(--brand); }',
  ].join('\\n'))
}`,
  },
  {
    key: 'listen', label: 'Реакция на сообщения', emoji: '👂',
    hint: 'Что-то делать, когда пришло новое сообщение',
    permissions: ['messages.read', 'notify'],
    body: `function onLoad(ponoi) {
  ponoi.on('message', (msg) => {
    // msg: id, author, authorName, content, mine, mentionsMe
    if (msg.mentionsMe) ponoi.notify('Тебя упомянул ' + msg.authorName)
  })
}`,
  },
  {
    key: 'settings', label: 'Со своими настройками', emoji: '⚙️',
    hint: 'Страница настроек с переключателями',
    permissions: ['settings', 'storage', 'notify'],
    body: `function onLoad(ponoi) {
  ponoi.ui.addSettingsPage({
    title: 'Мой плагин',
    rows: [
      { type: 'toggle', key: 'on', label: 'Включено', description: 'Пример переключателя', value: true },
      { type: 'text', key: 'text', label: 'Текст', placeholder: 'что-нибудь' },
    ],
  })
  ponoi.on('settings', (e) => ponoi.notify('Поменяли: ' + e.key))
}`,
  },
  {
    key: 'empty', label: 'С нуля', emoji: '📄',
    hint: 'Пустая заготовка',
    permissions: [],
    body: `function onLoad(ponoi) {
  ponoi.log('плагин загрузился')
}`,
  },
]

/** Латиница-дефис из названия: человеку не надо думать, что такое @id. */
export function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  const s = name.toLowerCase().split('').map(ch => map[ch] ?? ch).join('')
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** Шапка отрезается по первому блочному комментарию — ровно как её читает parsePlugin. */
export const stripHeader = (code: string): string => code.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '')

export function buildFile(d: Draft, author: string): string {
  const lines = [
    '/**',
    ` * @name ${d.name || 'Без названия'}`,
    ` * @id ${d.id || 'my-plugin'}`,
    ` * @version ${d.version || '1.0.0'}`,
    ` * @author ${author}`,
  ]
  if (d.description.trim()) lines.push(` * @description ${d.description.trim().replace(/\s+/g, ' ')}`)
  if (d.permissions.length) lines.push(` * @permissions ${d.permissions.join(', ')}`)
  if (d.permissions.includes('net') && d.hosts.trim()) lines.push(` * @hosts ${d.hosts.trim()}`)
  lines.push(' */', '')
  return lines.join('\n') + stripHeader(d.body)
}

/** Разбор уже установленного плагина обратно в форму — чтобы его можно было менять. */
export function draftFrom(code: string): Draft | null {
  try {
    const m = parsePlugin(code)
    return {
      name: m.name, id: m.id, version: m.version, description: m.description,
      permissions: m.permissions, hosts: m.hosts.join(', '), body: stripHeader(code),
    }
  } catch { return null }
}

export function draftFromTemplate(t: Template): Draft {
  return { name: '', id: '', version: '1.0.0', description: '', permissions: [...t.permissions], hosts: '', body: t.body }
}
