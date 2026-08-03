// v1.452.0: прохождение сюжетных игр — проценты, миссия и открываемый список.
//
// Что было. Про игру в присутствии было ровно одно: «Играет в X». Для сетевых
// игр этого хватает — там есть счёт, карта и матчи (см. gameMatches.ts,
// opendota.ts). А у сюжетной игры ничего этого нет: ни матчей, ни счёта, и
// человек, который третий вечер проходит кампанию, выглядел так же, как тот,
// кто только что запустил игру. Ни на каком месте он находится, ни сколько
// осталось — не видно ни ему, ни друзьям.
//
// Откуда берутся данные, и это главное. НЕ выдумываются. В приложении нет и не
// будет зашитого списка миссий «Ведьмака» или «Half-Life»: любой такой список
// я бы писал по памяти, а значит с ошибками, и человек читал бы выдумку под
// видом факта. Список приносит сам человек — вставляет текстом (из вики, из
// меню игры, откуда угодно), а приложение только считает и показывает. Отметки
// «пройдено» тоже ставит он: автоматического источника для одиночных игр не
// существует, и делать вид, что он есть, нельзя.
//
// Что приложение делает само:
//   • считает проценты и «миссия N из M» — и в присутствии, и в панели ОДНОЙ
//     функцией, чтобы строка активности не разошлась с открытым списком;
//   • помнит заметки к каждой миссии — это и есть «советы внизу»: свои, а не
//     сочинённые приложением;
//   • собирает вопрос для ИИ вместе с местом прохождения (см. askContext) —
//     сам ИИ подключается отдельно, здесь только подготовка.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

/** Одна миссия: название и заметка к ней (свой совет, ссылка, что угодно). */
export interface Mission {
  name: string
  /** Пройдена. */
  done: boolean
  /** Своя заметка — показывается внизу панели, когда миссия выбрана. */
  note?: string
}

export interface Campaign {
  /** Название игры — ровно то, что видно в активности. */
  game: string
  missions: Mission[]
  /** Когда список правили в последний раз (мс). */
  at: number
}

/** Сколько всего и сколько пройдено. */
export function counts(c: Campaign | null | undefined): { done: number; total: number } {
  const list = c?.missions ?? []
  return { done: list.filter(m => m.done).length, total: list.length }
}

/** Проценты прохождения, целые. Пустой список — ноль, а не деление на ноль. */
export function percent(c: Campaign | null | undefined): number {
  const { done, total } = counts(c)
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}

/**
 * Текущая миссия — первая непройденная.
 *
 * Почему именно так, а не «последняя отмеченная»: человек проходит по порядку, и
 * первая незакрытая — это то, где он стоит. Если отмечено всё, текущей нет:
 * кампания пройдена.
 */
export function currentIndex(c: Campaign | null | undefined): number {
  const list = c?.missions ?? []
  const i = list.findIndex(m => !m.done)
  return i
}

export function currentMission(c: Campaign | null | undefined): Mission | null {
  const i = currentIndex(c)
  return i >= 0 ? (c!.missions[i] ?? null) : null
}

/** Пройдено ли всё. */
export function isComplete(c: Campaign | null | undefined): boolean {
  const { done, total } = counts(c)
  return total > 0 && done === total
}

/** Короткая строка для присутствия: «Миссия 7 из 20 · 35%».
 *  Пусто — показывать нечего (списка нет), и в активность ничего не уйдёт. */
export function shortLabel(c: Campaign | null | undefined): string {
  const { done, total } = counts(c)
  if (total <= 0) return ''
  if (isComplete(c)) return `Пройдено полностью · ${total} из ${total}`
  return `Миссия ${done + 1} из ${total} · ${percent(c)}%`
}

/** Строка с названием миссии — для панели и для подсказки при наведении.
 *  Длинные названия режем: в присутствие уходит всем, и место там не резиновое. */
export function fullLabel(c: Campaign | null | undefined, maxName = 60): string {
  const short = shortLabel(c)
  if (!short) return ''
  const m = currentMission(c)
  if (!m) return short
  const name = m.name.length > maxName ? m.name.slice(0, maxName - 1).trimEnd() + '…' : m.name
  return short + ' · ' + name
}

/** То, что уходит в присутствие. null — делиться нечем. */
export interface StoryShare { mission: string; done: number; total: number; pct: number }

export function storyShare(c: Campaign | null | undefined): StoryShare | null {
  const { done, total } = counts(c)
  if (total <= 0) return null
  const m = currentMission(c)
  return { mission: m?.name ?? '', done, total, pct: percent(c) }
}

/** Как показать чужое прохождение, полученное в присутствии. Считает то же
 *  самое, что shortLabel, — иначе своё и чужое разошлись бы в написании. */
export function shareLabel(s: StoryShare | null | undefined): string {
  if (!s || !s.total) return ''
  if (s.done >= s.total) return `Пройдено полностью · ${s.total} из ${s.total}`
  return `Миссия ${s.done + 1} из ${s.total} · ${s.pct}%`
}

// ── Список миссий приносит человек ───────────────────────────────────────────

/** Сколько миссий разрешаем: длиннее — это уже не кампания, а вставленная
 *  случайно страница целиком. */
export const MAX_MISSIONS = 500
/** Длина названия: всё, что длиннее, — почти наверняка абзац текста. */
export const MAX_MISSION_NAME = 200

/**
 * Разобрать вставленный список. Терпим к тому, как его скопировали:
 * нумерация «1.», «1)», маркеры «-», «•», лишние пробелы и пустые строки.
 *
 * Порядок сохраняется как есть: человек вставляет список в том порядке, в
 * котором проходит, и переставлять его за него нельзя.
 */
export function parseMissions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    // Нумерация и маркеры в начале строки — это оформление, а не название.
    line = line.replace(/^\s*(?:\d{1,3}\s*[.)\]:-]\s*|[-–—•*·]\s+)/, '').trim()
    if (!line) continue
    if (line.length > MAX_MISSION_NAME) line = line.slice(0, MAX_MISSION_NAME).trimEnd()
    // Повторы выкидываем: вставленная таблица часто содержит заголовок дважды.
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= MAX_MISSIONS) break
  }
  return out
}

/** Собрать кампанию из вставленного текста, сохранив уже отмеченное.
 *  Список правят и дополняют — терять из-за этого отметки нельзя. */
export function buildCampaign(game: string, text: string, old?: Campaign | null, now = Date.now()): Campaign {
  const wasDone = new Set((old?.missions ?? []).filter(m => m.done).map(m => m.name.toLowerCase()))
  const notes = new Map((old?.missions ?? []).filter(m => m.note).map(m => [m.name.toLowerCase(), m.note!]))
  const missions = parseMissions(text).map(name => ({
    name,
    done: wasDone.has(name.toLowerCase()),
    note: notes.get(name.toLowerCase()),
  }))
  return { game, missions, at: now }
}

/**
 * Отметить миссию пройденной или снять отметку.
 *
 * Отмечая миссию, закрываем и всё, что до неё: человек не проходит седьмую,
 * пропустив третью, а требовать от него двадцати нажатий по очереди — издевка.
 * Снимая отметку — открываем всё, что после: раз он вернулся сюда, дальше он
 * ещё не был.
 */
export function toggleMission(c: Campaign, index: number, now = Date.now()): Campaign {
  const list = c.missions
  if (index < 0 || index >= list.length) return c
  const turningOn = !list[index].done
  return {
    ...c,
    at: now,
    missions: list.map((m, i) => {
      if (turningOn) return i <= index ? { ...m, done: true } : m
      return i >= index ? { ...m, done: false } : m
    }),
  }
}

/** Заметка к миссии. */
export function setNote(c: Campaign, index: number, note: string, now = Date.now()): Campaign {
  if (index < 0 || index >= c.missions.length) return c
  const text = String(note ?? '').slice(0, 2000)
  return {
    ...c, at: now,
    missions: c.missions.map((m, i) => (i === index ? { ...m, note: text || undefined } : m)),
  }
}

// ── Заготовка под вопрос к ИИ ────────────────────────────────────────────────
//
// Сам ИИ здесь не зовётся: подключение отдельное. Но место прохождения к вопросу
// надо приложить ОДИНАКОВО везде, откуда бы ни спрашивали, — иначе один экран
// расскажет ИИ, где человек стоит, а другой промолчит, и совет будет не о том.

/** Что известно про место прохождения — приложить к вопросу. */
export function askContext(c: Campaign | null | undefined): string {
  const { done, total } = counts(c)
  if (!c || total <= 0) return ''
  const m = currentMission(c)
  const parts = [
    `Игра: ${c.game}.`,
    isComplete(c)
      ? `Кампания пройдена полностью (${total} миссий).`
      : `Сейчас на миссии «${m?.name ?? '—'}» — это ${done + 1}-я из ${total}, пройдено ${percent(c)}%.`,
  ]
  const пройдено = c.missions.filter(m2 => m2.done).slice(-3).map(m2 => m2.name)
  if (пройдено.length) parts.push(`Последние пройденные: ${пройдено.join('; ')}.`)
  if (m?.note) parts.push(`Своя заметка к текущей миссии: ${m.note}`)
  return parts.join(' ')
}

/** Полный текст вопроса — то, что уйдёт ИИ. Пустой вопрос не отправляем. */
export function askPrompt(c: Campaign | null | undefined, question: string): string {
  const q = String(question ?? '').trim()
  if (!q) return ''
  const ctx = askContext(c)
  const rules = 'Отвечай коротко и по делу. Не рассказывай, что будет дальше по сюжету, '
    + 'если об этом не спросили прямо: испортить сюжет хуже, чем не ответить.'
  return ctx ? `${ctx}\n\nВопрос: ${q}\n\n${rules}` : `${q}\n\n${rules}`
}

// ── Где это лежит ────────────────────────────────────────────────────────────
//
// На устройстве: прохождение — личная заметка, а не общие данные, и таблицы под
// него в базе нет. В присутствие уходит только выжимка (storyShare): миссия,
// сколько пройдено и проценты — этого хватает друзьям и не выкладывает наружу
// весь список с заметками.

const KEY = 'ponoi_campaigns_v1'

function readAll(): Record<string, Campaign> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

/** Ключ — название игры в нижнем регистре: та же игра не должна заводить две
 *  записи из-за регистра в названии активности. */
const key = (game: string) => String(game ?? '').trim().toLowerCase()

export function loadCampaign(game: string): Campaign | null {
  if (!game) return null
  const c = readAll()[key(game)]
  return c && Array.isArray(c.missions) ? c : null
}

export function saveCampaign(c: Campaign) {
  try {
    const all = readAll()
    all[key(c.game)] = c
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* приватный режим или переполнение — прохождение не важнее работы */ }
  // Присутствие пересобирается по этому событию: иначе проценты в активности
  // обновлялись бы только к следующему перезапуску.
  try { window.dispatchEvent(new CustomEvent('ponoi-campaign', { detail: { game: c.game } })) } catch {}
}

export function forgetCampaign(game: string) {
  try {
    const all = readAll()
    delete all[key(game)]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
  try { window.dispatchEvent(new CustomEvent('ponoi-campaign', { detail: { game } })) } catch {}
}

/** Все игры, по которым что-то заведено, — свежие сверху. */
export function listCampaigns(): Campaign[] {
  return Object.values(readAll())
    .filter(c => c && Array.isArray(c.missions))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}
