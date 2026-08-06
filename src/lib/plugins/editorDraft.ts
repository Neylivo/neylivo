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
    // v1.419.0. Панели существуют с v1.417.0, и ни одной заготовки с ними не
    // было: человек, открывший конструктор, о них попросту не узнавал.
    key: 'panel', label: 'Свой уголок в чате', emoji: '🧩',
    hint: 'Панель над полем ввода — со своими строками',
    permissions: ['panel', 'music'],
    body: `function onLoad(ponoi) {
  async function draw() {
    const now = await ponoi.music.now()
    // Панель обновляется повторным описанием — так делается всё живое.
    ponoi.ui.addPanel({
      slot: 'chat',                       // chat | player | library | sidebar
      title: 'Что играет',
      rows: [
        { type: 'label', key: 'now', label: 'Сейчас', value: now ? now.title : 'плеер закрыт' },
        { type: 'button', key: 'next', label: 'Следующий', onClick: async () => {
          await ponoi.music.next()
          draw()
        } },
      ],
    })
  }
  draw()
  ponoi.on('music', draw)
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

/**
 * Вычистить то, что человек вставил из чата с ИИ (v1.426.0).
 *
 * Ответ ИИ теперь устроен как просили: сначала название, потом описание и только
 * внизу код. Человек копирует всё разом — и получал «В файле нет шапки плагина»,
 * потому что перед шапкой оказывались две строки прозы. Формально он виноват,
 * по делу — нет: приложение прекрасно видит, где начинается файл.
 *
 * Что убираем:
 *   • markdown-заборы ```js вокруг кода — их дописывает почти любой ИИ;
 *   • всё, что стоит ПЕРЕД шапкой плагина: название, описание, «вот твой плагин».
 *
 * Чего НЕ делаем: не трогаем сам код и не пытаемся угадать шапку, если её нет
 * вовсе — тогда честная ошибка полезнее молчаливой догадки.
 */
export function cleanPasted(text: string): string {
  let t = (text ?? '').replace(/\r\n?/g, '\n')
  // Забор с языком (```js, ```javascript) и без него.
  t = t.replace(/^[\s\S]*?```[a-zA-Z]*\n/, m => (/\/\*\*/.test(m) ? m : ''))
  t = t.replace(/```[\s\S]*$/, '')
  const at = t.indexOf('/**')
  if (at > 0) {
    const before = t.slice(0, at)
    // Если до шапки шёл код (а не проза), ничего не режем: это чужой файл со
    // своим порядком, и обрезать у него начало было бы потерей.
    if (!/[;{}=]\s*$/.test(before.trim())) t = t.slice(at)
  }
  return t.trim() + '\n'
}

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
  // Строку пишем ВСЕГДА, даже когда не выбрано ничего.
  //
  // v1.499.0: отсутствие @permissions теперь означает «все» — так задумано для
  // файлов, написанных руками, где забытая строка роняла плагин на первом
  // вызове. Но в конструкторе разрешения ВЫБИРАЮТ, и «не выбрал ничего» — это
  // осознанное «ничего», а не забывчивость. Опусти мы строку здесь — плагин,
  // которому человек не дал ни одного права, молча получил бы все.
  lines.push(d.permissions.length
    ? ` * @permissions ${d.permissions.join(', ')}`
    : ' * @permissions none')
  if (d.permissions.includes('net') && d.hosts.trim()) lines.push(` * @hosts ${d.hosts.trim()}`)
  if (d.icon.trim()) lines.push(` * @icon ${d.icon.trim()}`)
  if (d.banner.trim()) lines.push(` * @banner ${d.banner.trim()}`)
  lines.push(' */', '')
  return lines.join('\n') + stripHeader(d.body)
}

/**
 * Разбор уже установленного плагина обратно в форму — чтобы его можно было менять.
 *
 * v1.350.0: раньше при неразбираемой шапке возвращался null, а конструктор в
 * этом случае открывался с ПУСТОЙ заготовкой — то есть код плагина молча
 * подменялся чужим примером, и человек, нажав «Сохранить», терял свой. Такое
 * стало возможно, когда появилась проверка @icon: плагин, поставленный раньше с
 * http-ссылкой на картинку, разбираться перестал. Теперь тело сохраняется в
 * любом случае, а поля шапки просто остаются пустыми — их видно и можно
 * заполнить заново.
 */
export function draftFrom(code: string): Draft | null {
  const body = stripHeader(code)
  try {
    const m = parsePlugin(code)
    return {
      name: m.name, id: m.id, version: m.version, description: m.description,
      permissions: m.permissions, hosts: m.hosts.join(', '), body,
      icon: m.icon ?? '', banner: m.banner ?? '',
    }
  } catch {
    // Шапку прочитать не вышло — но код у нас есть, и терять его нельзя.
    return { name: '', id: '', version: '1.0.0', description: '', permissions: [], hosts: '', body, icon: '', banner: '' }
  }
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
  // v1.419.0. Половины списка здесь не было с самого появления определителя:
  // панель, музыка, буфер обмена и обстановка звались из плагина, а
  // конструктор молчал — то есть человек узнавал о недостающем разрешении
  // единственным способом, от которого этот определитель и должен был спасти:
  // красной строкой на карточке уже установленного плагина.
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addPanel\s*\(/,            perms: ['panel'],                     what: 'ponoi.ui.addPanel' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addHotkey\s*\(/,           perms: ['ui'],                        what: 'ponoi.ui.addHotkey' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*(confirm|prompt)\s*\(/,    perms: ['ui'],                        what: 'ponoi.ui.confirm/prompt' },
  { re: /\bponoi\s*\.\s*clipboard\s*\./,                      perms: ['ui'],                        what: 'ponoi.clipboard' },
  { re: /\bponoi\s*\.\s*music\s*\./,                          perms: ['music'],                     what: 'ponoi.music' },
  { re: /\bponoi\s*\.\s*messages\s*\.\s*recent\s*\(/,        perms: ['messages.read'],             what: 'ponoi.messages.recent' },
  // v1.477.0: «прочитал ли собеседник» — это про открытый разговор, и
  // разрешение то же, что на чтение сообщений.
  { re: /\bponoi\s*\.\s*messages\s*\.\s*readState\s*\(/,     perms: ['messages.read'],             what: 'ponoi.messages.readState' },
  // v1.481.0: любой канал.
  { re: /\bponoi\s*\.\s*messages\s*\.\s*(in|channels)\s*\(/, perms: ['messages.any'],              what: 'ponoi.messages.in/channels' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['\"`]read['\"`]/,          perms: ['messages.read'],             what: "ponoi.on('read')" },
  { re: /\bponoi\s*\.\s*messages\s*\.\s*(react|remove)\s*\(/, perms: ['messages.write'],            what: 'ponoi.messages.react/remove' },
  { re: /\bponoi\s*\.\s*(me|channel|servers|channels)\s*\(/,  perms: ['context'],                   what: 'ponoi.me/channel/servers/channels' },
  { re: /\bponoi\s*\.\s*open\s*\(/,                           perms: ['navigate'],                  what: 'ponoi.open' },
  { re: /\bponoi\s*\.\s*status\s*\./,                         perms: ['status'],                    what: 'ponoi.status' },
  { re: /\bponoi\s*\.\s*sound\s*\.\s*play\s*\(/,             perms: ['notify'],                    what: 'ponoi.sound.play' },
  // Событий с разрешением messages.read несколько, и подписка на любое из них
  // требует того же самого — перечислять их поимённо здесь значит однажды
  // забыть новое (см. таблицу PLUGIN_EVENTS в types.ts).
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`](message\.edit|message\.delete|reaction|typing)['"`]/, perms: ['messages.read'], what: 'подписка на события переписки' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`](channel|voice)['"`]/, perms: ['context'],                   what: "ponoi.on('channel'/'voice')" },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`]music['"`]/,           perms: ['music'],                     what: "ponoi.on('music')" },
  // v1.465.0: семь новых возможностей. Каждая обязана быть здесь, иначе человек
  // узнаёт о недостающем разрешении единственным способом, от которого этот
  // определитель и должен спасать, — красной строкой на уже поставленном плагине.
  { re: /\bponoi\s*\.\s*plugins\s*\.\s*send\s*\(/,           perms: ['ipc'],                       what: 'ponoi.plugins.send' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`]ipc['"`]/,             perms: ['ipc'],                       what: "ponoi.on('ipc')" },
  { re: /\bponoi\s*\.\s*messages\s*\.\s*onBefore(Send|Render)\s*\(/, perms: ['messages.intercept'], what: 'ponoi.messages.onBeforeSend/Render' },
  // Холст живёт либо в панели, либо в своём окне — и разрешение нужно ровно то,
  // где он объявлен (api.ts, ui.getCanvas). Поэтому «panel» просим только у
  // того, кто окон не открывает: игре, живущей в своём окне, чужая панель в
  // плеере и чате не нужна, и требовать её значило бы врать на экране
  // разрешений. Условие смотрит на весь код целиком — отсюда просмотр вперёд.
  { re: /^(?![\s\S]*\bponoi\s*\.\s*apps\s*\.)[\s\S]*\bponoi\s*\.\s*ui\s*\.\s*getCanvas\s*\(/, perms: ['panel'], what: 'ponoi.ui.getCanvas' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`]canvas['"`]/,          perms: ['panel'],                     what: "ponoi.on('canvas')" },
  { re: /\bponoi\s*\.\s*net\s*\.\s*ws\s*\(/,                 perms: ['net'],                       what: 'ponoi.net.ws' },
  { re: /\bponoi\s*\.\s*background\s*\./,                     perms: ['background'],                what: 'ponoi.background' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*(setTheme|clearTheme)\s*\(/, perms: ['ui.theme'],                what: 'ponoi.ui.setTheme' },
  // Пункт меню сообщения отдаёт само сообщение — значит, и чтение тоже.
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addContextMenu\s*\(\s*\{[^}]*target\s*:\s*['"`]message['"`]/, perms: ['ui', 'messages.read'], what: 'ponoi.ui.addContextMenu (message)' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*addContextMenu\s*\(/,      perms: ['ui'],                        what: 'ponoi.ui.addContextMenu' },
  // v1.471.0: своя область экрана.
  { re: /\bponoi\s*\.\s*apps\s*\./,                           perms: ['apps'],                      what: 'ponoi.apps' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`]app['"`]/,             perms: ['apps'],                      what: "ponoi.on('app')" },
  // v1.472.0: таблицы — то же хранилище, то же разрешение. Без строки здесь
  // плагин на ponoi.db молча получал бы отказ при первой же записи.
  { re: /\bponoi\s*\.\s*db\s*\./,                             perms: ['storage'],                   what: 'ponoi.db' },
  { re: /\bponoi\s*\.\s*services\s*\./,                       perms: ['ipc'],                       what: 'ponoi.services' },
  // v1.473.0: свои файлы. Скачивание — это ещё и сеть, поэтому у него своя
  // строка ВЫШЕ общей: иначе она бы до него не дошла, и плагин узнал бы о
  // недостающем «net» уже на живом отказе.
  { re: /\bponoi\s*\.\s*assets\s*\.\s*fetch\s*\(/,           perms: ['storage', 'net'],            what: 'ponoi.assets.fetch' },
  { re: /\bponoi\s*\.\s*assets\s*\.\s*play\s*\(/,            perms: ['storage', 'notify'],         what: 'ponoi.assets.play' },
  { re: /\bponoi\s*\.\s*assets\s*\./,                         perms: ['storage'],                   what: 'ponoi.assets' },
  { re: /\bponoi\s*\.\s*input\s*\./,                          perms: ['input'],                     what: 'ponoi.input' },
  { re: /\bponoi\s*\.\s*on\s*\(\s*['"`]gamepad['"`]/,         perms: ['input'],                     what: "ponoi.on('gamepad')" },
  // v1.475.0: перехват вложений и окно-вопрос.
  { re: /\bponoi\s*\.\s*messages\s*\.\s*onUpload\s*\(/, perms: ['messages.upload'],           what: 'ponoi.messages.onUpload' },
  { re: /\bponoi\s*\.\s*ui\s*\.\s*dialog\s*\(/,          perms: ['ui'],                        what: 'ponoi.ui.dialog' },
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
