// Локализация интерфейса «на лету»: словарь + MutationObserver.
// Приложение написано по-русски. Переводчик подменяет текстовые узлы и атрибуты
// (placeholder/title) прямо в DOM, поэтому работает во всём интерфейсе без
// переписывания компонентов. Не трогает: сообщения пользователей (.msgs),
// код, эмодзи-сетку и код друга. Русский — исходный текст без изменений.


// v1.116.0: полный словарь — все надписи интерфейса, собранные по исходникам.



const CYR = /[а-яё]/i

// Долбоёбский (v1.76.0): коверкаем АБСОЛЮТНО каждое русское слово в кашу.
// Раньше менялись только отдельные сочетания (жи/ши, тся…) — большинство слов
// оставались нормальными. Плюс правила на \b не работали: в JS \b не считает
// кириллицу «словом», так что /\bчто\b/ вообще никогда не срабатывал.
// Теперь берём каждое слово целиком и прогоняем через цепочку превращений.
const DOLB_SWAP: Record<string, string> = {
  'а': 'о', 'о': 'а', 'е': 'и', 'и': 'е', 'я': 'йа', 'ю': 'йу',
  'А': 'О', 'О': 'А', 'Е': 'И', 'И': 'Е', 'Я': 'Йа', 'Ю': 'Йу',
}
const DOLB_FINAL: Record<string, string> = { 'б': 'п', 'в': 'ф', 'г': 'к', 'д': 'т', 'з': 'с', 'ж': 'ш', 'к': 'г' }
function toDolb(t: string): string {
  if (!CYR.test(t)) return t
  return t.replace(/[а-яёА-ЯЁ]+/g, w => {
    let out = w
      .replace(/ться$|тся$/g, 'цца')
      .replace(/^что$/i, m => (m[0] === 'Ч' ? 'Што' : 'што'))
      .replace(/^привет/i, m => (m[0] === 'П' ? 'Превед' : 'превед'))
      .replace(/жи/g, 'жы').replace(/Жи/g, 'Жы')
      .replace(/ши/g, 'шы').replace(/Ши/g, 'Шы')
      .replace(/чн/g, 'шн')
      .replace(/ик$/g, 'ег').replace(/ики$/g, 'еги')
    out = out.replace(/[аоеияюАОЕИЯЮ]/g, ch => DOLB_SWAP[ch] ?? ch)
    out = out.replace(/[бвгдзжк]$/, c => DOLB_FINAL[c] ?? c)
    return out
  })
}

// v1.291.0: английский словарь (108 КБ) живёт в отдельном модуле и подтягивается
// только при переключении на английский — русскому пользователю, а это язык по
// умолчанию, он не нужен ни разу, но раньше скачивался всегда.
let enMod: typeof import('./i18n.en') | null = null
let enLoading: Promise<typeof import('./i18n.en')> | null = null
function loadEn() {
  if (!enLoading) enLoading = import('./i18n.en').then(m => (enMod = m))
  return enLoading
}
// Пока словарь не подгружен, возвращаем исходный русский текст: подмена просто не
// произойдёт, а не сломается. Практически это невидимо — applyLang ждёт загрузки
// ДО первого прохода по DOM (см. ниже).
function toEn(t: string): string { return enMod ? enMod.toEn(t) : t }

let cur = 'ru'
let mo: MutationObserver | null = null
let mute = false
const origText = new Map<Text, string>()
const origAttr = new Map<Element, Record<string, string>>()

// v1.357.0: что переводчик не трогает.
//
// Раньше в списке были только сообщения, код и эмодзи-сетка, а всё остальное
// считалось интерфейсом. Но именами распоряжается человек: сервер «Друзья»,
// канал «все», роль «Участник», ник «Настройки» — это ровно те строки, что
// лежат в словаре, и они молча превращались во Friends, all, Member, Settings.
// Перевод чужого имени — не помощь, а подмена: человек видит не то, что написал
// он или его собеседник.
//
// Помечать надо источник, а не бороться со словарём: угадать, какие слова люди
// назовут своими вещами, нельзя. Отсюда .notr и стандартный translate="no" —
// второй заодно останавливает встроенный переводчик браузера, который коверкал
// ники так же и без нас.
// Классы, в которых лежит только то, что назвал человек. Разметку из-за этого
// не переписываем: у каждого такого места класс уже есть, и он говорит ровно то
// что надо — «здесь имя», а не «здесь подпись».
const UGC_CLASSES = [
  'me-nm',            // участник в списке и собеседник в списке ЛС
  'nm',               // автор сообщения
  'ch-txt', 'ch-emo', // название канала
  'srv-title-nm', 'srvtag-nm', 'sset-prev-nm',  // название сервера
  'sb-name',          // сервер в боковой панели
  'pfr-name', 'pfr-uname', 'pc-name', 'pqs-acc-name', 'pqs-acc-uname',  // имя и юзернейм
  'cfc-nm', 'fwd-row-nm', 'c2-bub-nm', 'vo-nm', 'wall-author',          // имена в списках и звонках
  'chr-name', 'redit-role-nm', 'sset-rolechip',                          // названия ролей
  'plate-prev-nm', 'botp-prev-nm', 'pet2-pv-un',                         // предпросмотры профиля и бота
  'act-name',         // название игры — оно тоже не наше
  'cat-nm', 'cat-author',   // имя бота или плагина и его автор
  'forum-card-t', 'thread-view-t',  // заголовки обсуждений
  // v1.371.0: карточка трека в трекотеке — название и исполнитель приходят из
  // чужой записи, переводить их нельзя.
  'mus2-card-t', 'mus2-card-a',
  'mus2-up-t',        // название трека в ленте «дальше»
  'tog-nm', 'tog-code',  // имя в лобби и код — их придумали не мы
  'mag-tx',           // название игры и трека в строке активности
]
const SKIP_SEL = ['.msgs', 'pre', 'code', '.emoji-scroll', '.pqs-code-val', '.notr', '[translate="no"]']
  .concat(UGC_CLASSES.map(c => '.' + c)).join(', ')
export { UGC_CLASSES }
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
  else if (cur === 'dolb') out = toDolb(out)
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
export async function applyLang(lang: string) {
  if (lang === 'staro') lang = 'ru' // v1.116.0: старорусский язык удалён
  if (lang === cur) return
  // Словарь грузим ДО того, как объявим язык текущим и пойдём по DOM: иначе первый
  // проход прошёл бы впустую по ещё пустому словарю иполовина интерфейса осталась бы русской
  // до следующей перерисовки.
  if (lang === 'en') await loadEn()
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


// v1.122.0: переводы вкладки «Ожидание» (входящие/исходящие заявки)


// v1.123.0: перевод описания личного шрифта интерфейса

// v1.167.0: словарь не обновлялся с v1.123.0 — за 40+ версий (папки серверов,
// звуки, интеграции профиля, статистика CS2/Dota2, права, автомод и многое
// другое) переключение на английский оставляло половину интерфейса русской.
// Полный проход по исходникам, добор всех непереведённых строк.
