// Локализация интерфейса «на лету»: словарь + MutationObserver.
// Приложение написано по-русски. Переводчик подменяет текстовые узлы и атрибуты
// (placeholder/title) прямо в DOM, поэтому работает во всём интерфейсе без
// переписывания компонентов. Не трогает: сообщения пользователей (.msgs),
// код, эмодзи-сетку и код друга. Русский — исходный текст без изменений.

const DICT_EN: Record<string, string> = {
  // Настройки: разделы
  'Настройки пользователя': 'User Settings', 'Мой аккаунт': 'My Account', 'Внешний вид': 'Appearance',
  'Чат': 'Chat', 'Уведомления': 'Notifications', 'Голос и видео': 'Voice & Video',
  'Горячие клавиши': 'Keybinds', 'Язык': 'Language', 'Дисплей': 'Display',
  'Конфиденциальность': 'Privacy', 'Активность': 'Activity', 'Дополнительно': 'Advanced', 'Выйти': 'Log Out',
  // Аккаунт
  'Код друга': 'Friend Code', 'Копировать': 'Copy', 'твой код': 'your code',
  'Тема профиля': 'Profile Theme', 'Основной цвет': 'Primary color', 'Акцент': 'Accent', 'Сбросить': 'Reset',
  'Питомец профиля': 'Profile Pet', 'Показывать питомца': 'Show pet', 'Выбрать файл': 'Choose file',
  'Убрать': 'Remove', 'Размер': 'Size', 'Позиция': 'Position', 'Имя пользователя': 'Username',
  'О себе': 'About Me', 'Сохранить': 'Save', 'Сохранено': 'Saved', 'Загрузка…': 'Uploading…',
  // Внешний вид
  'Фон чата': 'Chat Background', 'Фоновое фото': 'Background photo', 'Выбрать фото': 'Choose photo',
  'Сбросить фон': 'Reset background', 'Размытие': 'Blur', 'Затемнение': 'Dim', 'нет фото': 'no photo',
  'Своя тема': 'Custom Theme', 'Тема': 'Theme', 'Размер шрифта': 'Font size',
  'Компактный режим': 'Compact mode', 'Анимации интерфейса': 'Interface animations',
  'Автосмена темы': 'Auto theme switch', 'Шрифт и форма': 'Font & Shape', 'Шрифт интерфейса': 'UI font',
  'Системный': 'System', 'Моноширинный': 'Monospace', 'Скругление углов': 'Corner radius',
  'Отступ между сообщениями': 'Message spacing', 'Затемнение текстур (читаемость)': 'Texture dim (readability)',
  'Использовать свою тему': 'Use custom theme', 'Тёмный фон': 'Dark background', 'Основной фон': 'Main background',
  'Панель': 'Panel', 'Наведение': 'Hover', 'Активный': 'Active', 'Светлая': 'Light', 'Полночь': 'Midnight',
  'Лес': 'Forest', 'Роза': 'Rose', 'Закат': 'Sunset', 'Аметист': 'Amethyst', 'Океан': 'Ocean',
  'Багровый': 'Crimson', 'Графит': 'Graphite', 'Космос': 'Cosmos',
  // Чат
  '24-часовой формат времени': '24-hour time format', 'Показывать аватары': 'Show avatars',
  'Группировать сообщения': 'Group messages', 'Крупные эмодзи': 'Big emoji',
  'Отправка сообщений': 'Message sending', 'Enter — отправить': 'Enter — send',
  'Ctrl/⌘ + Enter — отправить': 'Ctrl/⌘ + Enter — send',
  // Уведомления
  'Системные уведомления': 'System notifications', 'Звуки уведомлений': 'Notification sounds',
  'Упоминания': 'Mentions', 'Счётчик на иконке': 'Badge counter',
  // Голос
  'Громкость микрофона': 'Microphone volume', 'Громкость динамика': 'Speaker volume',
  // Горячие клавиши
  'Настраиваемые': 'Custom', 'Открыть Музыку': 'Open Music', 'Открыть личные сообщения': 'Open direct messages',
  'Саундпад': 'Soundboard', 'Сохранить момент (15 сек)': 'Save moment (15 sec)', 'Стандартные': 'Default',
  'Быстрый переход': 'Quick switcher', 'Отправить': 'Send', 'Новая строка': 'New line', 'Закрыть': 'Close',
  'Нажми клавиши…': 'Press keys…',
  // Дисплей / конфиденциальность / активность / дополнительно
  'Масштаб интерфейса': 'UI scale', 'Сбросить масштаб': 'Reset zoom',
  'ЛС от всех пользователей': 'DMs from everyone', 'ЛС с участниками сервера': 'DMs from server members',
  'Сбор данных об использовании': 'Usage data collection', 'Своя активность': 'Custom activity',
  'Показывать пользовательский статус': 'Show custom status', 'Режим разработчика': 'Developer mode',
  'Очистить все данные': 'Clear all data',
  // Каналы / сервер
  'Текстовые каналы': 'Text channels', 'канал': 'channel', 'покинуть сервер': 'leave server',
  'Пригласить': 'Invite', 'Закреплённые': 'Pinned', 'Закреплённые сообщения': 'Pinned messages',
  'Нет закреплённых сообщений': 'No pinned messages', 'Голосовой звонок': 'Voice call',
  'Скрыть участников': 'Hide members', 'Показать участников': 'Show members',
  'Свернуть категорию': 'Collapse category', 'Развернуть категорию': 'Expand category',
  // Присутствие / друзья
  'В сети': 'Online', 'Не в сети': 'Offline', 'Друзья': 'Friends', 'Добавить в друзья': 'Add friend',
  'Личные сообщения': 'Direct messages',
  // Звонок
  'В звонке': 'In call', 'Звоним…': 'Calling…', 'ждём, пока кто-нибудь присоединится': 'waiting for someone to join',
  'Соединение…': 'Connecting…', 'Переподключение…': 'Reconnecting…', 'Микрофон': 'Microphone',
  'Камера': 'Camera', 'Демонстрация экрана': 'Screen share', 'Отключиться': 'Disconnect', 'Вы': 'You',
  'экран': 'screen', 'Момент сохранён': 'Moment saved',
  // Разное
  'Куда отправимся?': 'Where would you like to go?', 'Эмодзи': 'Emoji', 'Свои': 'Custom emoji',
  'Поиск…': 'Search…', 'Часто используемые': 'Frequently used', 'Добавить свой эмодзи': 'Add custom emoji',
  'Добавить': 'Add', 'Спойлер — нажми, чтобы раскрыть': 'Spoiler — click to reveal', 'СПОЙЛЕР': 'SPOILER',
  'Копировать код': 'Copy code', 'Ответить': 'Reply', 'Изменить': 'Edit', 'Закрепить': 'Pin',
  'Открепить': 'Unpin', 'Удалить': 'Delete', 'Удалить сообщение?': 'Delete message?', 'изменено': 'edited',
  'Музыка': 'Music', 'печатает…': 'is typing…', 'печатают…': 'are typing…',
  'Несколько человек печатают…': 'Several people are typing…', 'Отмена': 'Cancel',
}

const REGEX_EN: [RegExp, string][] = [
  [/^Написать в #(.+)$/, 'Message #$1'],
  [/^Написать @(.+)$/, 'Message @$1'],
  [/^Покинуть сервер «(.+)»\?$/, 'Leave server “$1”?'],
  [/^Громкость: (\d+)%$/, 'Volume: $1%'],
  [/^В сети — (\d+)$/, 'Online — $1'],
  [/^Не в сети — (\d+)$/, 'Offline — $1'],
  [/^(.+), (.+) печатают…$/, '$1, $2 are typing…'],
  [/^(.+) печатает…$/, '$1 is typing…'],
]

function toEn(t: string): string {
  const hit = DICT_EN[t]
  if (hit) return hit
  for (const [re, rep] of REGEX_EN) if (re.test(t)) return t.replace(re, rep)
  return t
}

const CYR = /[а-яё]/i

// Старорусскій: і перед гласной, ъ после конечной согласной.
function toStaro(t: string): string {
  if (!CYR.test(t)) return t
  return t
    .replace(/и(?=[аеёиоуыэюя])/g, 'і')
    .replace(/И(?=[АЕЁИОУЫЭЮЯаеёиоуыэюя])/g, 'І')
    .replace(/([бвгджзклмнпрстфхцчшщБВГДЖЗКЛМНПРСТФХЦЧШЩ])(?![а-яёіъьА-ЯЁІЪЬ])/g, '$1ъ')
}

// Долбоёбский: превед-стайл.
function toDolb(t: string): string {
  if (!CYR.test(t)) return t
  return t
    .replace(/привет/gi, m => (m[0] === 'П' ? 'Превед' : 'превед'))
    .replace(/ться\b/g, 'цца').replace(/тся\b/g, 'цца')
    .replace(/жи/g, 'жы').replace(/Жи/g, 'Жы')
    .replace(/ши/g, 'шы').replace(/Ши/g, 'Шы')
    .replace(/\bчто\b/g, 'што').replace(/\bЧто\b/g, 'Што')
    .replace(/ик\b/g, 'ег')
    .replace(/чн/g, 'шн')
}

// Бурмалды: кошачий диалект — мяу в конце фраз.
function toBurm(t: string): string {
  if (!CYR.test(t)) return t
  const core = t.trimEnd()
  const tail = t.slice(core.length)
  if (core.length <= 3 || /мяу[.!?…]*$/i.test(core)) return t
  const m = core.match(/^([\s\S]*?)([.!?…]*)$/)
  return (m ? m[1] + ', мяу' + m[2] : core + ', мяу') + tail
}

let cur = 'ru'
let mo: MutationObserver | null = null
let mute = false
const origText = new Map<Text, string>()
const origAttr = new Map<Element, Record<string, string>>()

const SKIP_SEL = '.msgs, pre, code, .emoji-scroll, .pqs-code-val'
function skipped(n: Node): boolean {
  const el = n.nodeType === 1 ? (n as Element) : n.parentElement
  return !!el && !!el.closest(SKIP_SEL)
}

function tx(raw: string): string {
  if (cur === 'ru') return raw
  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m || !m[2]) return raw
  let out = m[2]
  if (cur === 'en') out = toEn(out)
  else if (cur === 'staro') out = toStaro(out)
  else if (cur === 'dolb') out = toDolb(out)
  else if (cur === 'burm') out = toBurm(out)
  return m[1] + out + m[3]
}

function txText(n: Text) {
  if (skipped(n)) return
  const base = origText.get(n) ?? n.data
  const t = tx(base)
  if (t !== n.data) {
    if (!origText.has(n)) origText.set(n, n.data)
    mute = true; n.data = t; mute = false
  }
}

function txAttrs(el: Element) {
  if (skipped(el)) return
  for (const a of ['placeholder', 'title']) {
    const now = el.getAttribute(a)
    if (now == null) continue
    const saved = origAttr.get(el)?.[a] ?? now
    const t = tx(saved)
    if (t !== now) {
      const rec = origAttr.get(el) ?? {}
      if (!(a in rec)) { rec[a] = now; origAttr.set(el, rec) }
      mute = true; el.setAttribute(a, t); mute = false
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === 3) { txText(root as Text); return }
  if (root.nodeType !== 1) return
  const el = root as Element
  txAttrs(el)
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = tw.nextNode())) txText(n as Text)
  el.querySelectorAll('[placeholder],[title]').forEach(txAttrs)
}

function restore() {
  mute = true
  origText.forEach((v, n) => { try { n.data = v } catch { /* узла уже нет */ } })
  origAttr.forEach((rec, el) => { for (const a in rec) try { el.setAttribute(a, rec[a]) } catch { /* узла уже нет */ } })
  mute = false
  origText.clear(); origAttr.clear()
}

/** Применить язык интерфейса. Вызывается при старте и при смене в настройках. */
export function applyLang(lang: string) {
  if (lang === cur) return
  cur = lang
  if (mo) { mo.disconnect(); mo = null }
  restore()
  if (lang === 'ru') return
  walk(document.body)
  mo = new MutationObserver(muts => {
    if (mute) return
    for (const m of muts) {
      if (m.type === 'characterData') txText(m.target as Text)
      else if (m.type === 'childList') m.addedNodes.forEach(n => walk(n))
      else if (m.type === 'attributes') txAttrs(m.target as Element)
    }
  })
  mo.observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['placeholder', 'title'],
  })
}
