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
  /** Своя картинка и шапка карточки плагина (v1.349.0), https или пусто. */
  icon: string
  banner: string
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
  if (d.icon.trim()) lines.push(` * @icon ${d.icon.trim()}`)
  if (d.banner.trim()) lines.push(` * @banner ${d.banner.trim()}`)
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
      icon: m.icon ?? '', banner: m.banner ?? '',
    }
  } catch { return null }
}

export function draftFromTemplate(t: Template): Draft {
  return { name: '', id: '', version: '1.0.0', description: '', permissions: [...t.permissions], hosts: '', body: t.body, icon: '', banner: '' }
}

// ── Какие разрешения нужны этому коду ─────────────────────────────────────
//
// v1.346.0. Самая частая беда при написании плагина руками: код зовёт
// ponoi.notify, а в @permissions разрешения нет — и плагин падает уже у
// человека, красной строкой на карточке. Формально ошибка понятная, но доходить
// до неё не должен никто: по коду прекрасно видно, что он собирается делать.
//
// Разбор нарочно простой — по вызовам, а не разбором синтаксиса: плагин может
// быть написан как угодно, а нам достаточно не пропустить очевидное. Ошибка в
// сторону «попросили лишнего» безопаснее: лишнее разрешение человек снимет
// сам, а недостающее сломает плагин.
const NEEDS: { re: RegExp; perms: Permission[]; what: string }[] = [
  { re: /\bponoi\s*\.\s*css\s*\(/,                          perms: ['css'],                       what: 'ponoi.css' },
  { re: /\bponoi\s*\.\s*notify\s*\(/,                       perms: ['notify'],                    what: 'ponoi.notify' },
  { re: /\bponoi\s*\.\s*commands\s*\.\s*register\s*\(/,     perms: ['commands'],                  what: 'ponoi.commands.register' },
  { re: /\bponoi\s*\.\s*messages\s*\.\s*send\s*\(/,         perms: ['messages.write'],            what: 'ponoi.messages.send' },
  { re: /\bponoi\s*\.\s*storage\s*\./,                       perms: ['storage'],                   what: 'ponoi.storage' },
  { re: /\bponoi\s*\.\s*net\s*\.\s*fetch\s*\(/,             perms: ['net'],                       what: 'ponoi.net.fetch' },
  { re: /\bponoi\s*\.\s*voice\s*\./,                         perms: ['voice'],                     what: 'ponoi.voice' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addSettingsPage\s*\(/,     perms: ['settings'],                  what: 'ponoi.ui.addSettingsPage' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addComposerButton\s*\(/,   perms: ['ui'],                        what: 'ponoi.ui.addComposerButton' },
  // Действие над сообщением получает само сообщение — поэтому и чтение тоже.
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addMessageAction\s*\(/,    perms: ['ui', 'messages.read'],       what: 'ponoi.ui.addMessageAction' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`]message['"`]/,         perms: ['messages.read'],             what: "ponoi.on('message')" },
]

export interface NeededPerm { perm: Permission; what: string }

/** Что код собирается делать — и какое разрешение для этого нужно. */
export function permissionsFromCode(body: string): NeededPerm[] {
  const out: NeededPerm[] = []
  for (const n of NEEDS) {
    if (!n.re.test(body)) continue
    for (const p of n.perms) if (!out.some(x => x.perm === p)) out.push({ perm: p, what: n.what })
  }
  return out
}

/** Чего коду не хватает при текущем наборе разрешений. */
export function missingPermissions(body: string, have: Permission[]): NeededPerm[] {
  return permissionsFromCode(body).filter(n => !have.includes(n.perm))
}

/** Разрешения, объявленные впустую: код их не использует. */
export function unusedPermissions(body: string, have: Permission[]): Permission[] {
  const need = permissionsFromCode(body).map(n => n.perm)
  // hosts-разрешение net проверяется вместе с net; остальные — как есть.
  return have.filter(p => !need.includes(p))
}
