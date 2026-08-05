// v1.445.0: отметка безопасности в каталоге плагинов.
//
// Что было. В каталоге все плагины выглядели одинаково: название, автор,
// описание и список разрешений. Отличить плагин, который честно делает
// заявленное, от плагина, который читает переписку и шлёт её на чужой сайт,
// человек мог только одним способом — открыть код и прочитать. Разрешения
// показываются при установке, но «net» рядом с «messages.read» ни о чём не
// говорит тому, кто не знает, что эти два вместе значат.
//
// Что делает этот разбор. Смотрит на КОД и на шапку и отвечает на один вопрос:
// есть ли расхождение между тем, что плагин про себя говорит, и тем, что он
// делает. Найденное показывается в каталоге всем и всегда — не по просьбе, а
// само.
//
// Чего этот разбор НЕ делает, и написать это надо прямо в самом приложении:
//   • это не проверка человеком и не гарантия. Отметка «замечаний нет» значит
//     ровно «бросающегося в глаза не нашлось», а не «плагин безопасен»;
//   • это статический разбор текста. Код можно написать так, что разбор ничего
//     не заметит, — именно поэтому спрятанный код (eval и подобное) сам по себе
//     считается замечанием: раз прочитать нельзя, доверять нечему;
//   • настоящая защита — не здесь, а в песочнице (worker без доступа к странице),
//     в разрешениях и в списке доменов @hosts. Разбор их не заменяет и ничего
//     не разрешает: он только называет вещи своими именами.
//
// Проверки: src/lib/plugins/__test.ts (npm run test:plugins).
import { ALL_PERMISSIONS, type Permission, type PluginManifest } from './types'
import { unusedPermissions } from './editorDraft'

export type AuditLevel = 'clean' | 'warn' | 'unsafe'

export interface Finding {
  /** Метка для проверок — текст можно менять, метку нет. */
  code: string
  level: 'warn' | 'danger'
  text: string
}

export interface AuditResult {
  level: AuditLevel
  findings: Finding[]
}

// Какое разрешение чем пользуется — берётся из ОДНОГО места с конструктором
// плагинов (editorDraft.ts, таблица NEEDS). Своя вторая копия этого списка
// разошлась бы с первой на первом же новом методе, и каталог начал бы ругать
// плагины за то, что конструктор считает правильным.

/** Разрешение, за которым в коде не нашлось ни следа. */
export function unusedPerms(code: string, permissions: readonly Permission[]): Permission[] {
  return unusedPermissions(stripComments(code), [...permissions])
}

/** Комментарии выкидываем: шапка плагина сама по себе упоминает все разрешения,
 *  и без этого «просит больше, чем делает» не нашлось бы никогда. */
export function stripComments(code: string): string {
  return String(code ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** Домены, к которым код обращается по виду ссылки. */
export function urlHosts(code: string): string[] {
  const out = new Set<string>()
  for (const m of stripComments(code).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    const h = m[1].toLowerCase().replace(/^www\./, '')
    // Примеры из документации и схемы — не обращение к сайту.
    if (h === 'example.com' || h === 'localhost' || h.endsWith('.example.com')) continue
    if (/^(www\.)?w3\.org$/.test(h)) continue
    out.add(h)
  }
  return [...out]
}

/** Признаки спрятанного кода. Прочитать такой плагин нельзя — значит и
 *  доверять ему не за что, как бы честно ни выглядела шапка. */
export function hiddenCode(code: string): string[] {
  const body = stripComments(code)
  const found: string[] = []
  if (/\beval\s*\(/.test(body)) found.push('eval')
  if (/\bnew\s+Function\s*\(/.test(body)) found.push('new Function')
  if (/\batob\s*\(/.test(body) && /['"`][A-Za-z0-9+/=]{120,}['"`]/.test(body)) found.push('base64')
  // Строка из одних escape-последовательностей длиной с абзац — обычный приём
  // «спрятать текст от чтения».
  if (/(?:\\x[0-9a-f]{2}|\\u[0-9a-f]{4}){40,}/i.test(body)) found.push('escape-строки')
  return found
}

/** Полный разбор. */
export function auditPlugin(code: string, m: Pick<PluginManifest, 'permissions' | 'hosts'>): AuditResult {
  const findings: Finding[] = []
  const perms = m.permissions ?? []
  const hosts = (m.hosts ?? []).map(h => h.toLowerCase().replace(/^www\./, ''))

  const hidden = hiddenCode(code)
  if (hidden.length) {
    findings.push({
      code: 'hidden', level: 'danger',
      text: 'Код спрятан (' + hidden.join(', ') + ') — прочитать, что делает плагин, нельзя',
    })
  }

  if (perms.includes('messages.read') && perms.includes('net')) {
    findings.push({
      code: 'read-and-net', level: 'danger',
      text: 'Видит переписку в открытом канале И может обращаться в интернет — вместе это значит, что переписка может уехать на чужой сайт',
    })
  }

  if (perms.includes('net')) {
    const undeclared = urlHosts(code).filter(h => !hosts.includes(h))
    if (undeclared.length) {
      findings.push({
        code: 'undeclared-host', level: 'warn',
        text: 'В коде есть адреса, не объявленные в @hosts: ' + undeclared.slice(0, 4).join(', ')
          + '. Приложение туда не пустит, но шапка об этом умалчивает',
      })
    }
  } else if (/\bnet\s*\.\s*(fetch|stream)/.test(stripComments(code))) {
    findings.push({
      code: 'net-without-perm', level: 'warn',
      text: 'Плагин пытается ходить в интернет, но разрешения «net» не просит — эти вызовы просто не сработают',
    })
  }

  const unused = unusedPerms(code, perms)
  if (unused.length) {
    findings.push({
      code: 'unused-perms', level: 'warn',
      text: 'Просит больше, чем делает: ' + unused.join(', ') + ' — в коде этих действий нет',
    })
  }

  const level: AuditLevel = findings.some(f => f.level === 'danger') ? 'unsafe'
    : findings.length ? 'warn' : 'clean'
  return { level, findings }
}

/** Подпись для каталога. Официальность не отменяет разбора: плагин от создателя
 *  проходит его так же, как чужой, — поблажек тут нет намеренно. */
export function auditBadge(r: AuditResult, official: boolean): { text: string; kind: 'ok' | 'warn' | 'bad' } {
  if (r.level === 'unsafe') return { text: 'Небезопасный', kind: 'bad' }
  if (r.level === 'warn') return { text: 'Есть замечания', kind: 'warn' }
  if (official) return { text: 'От создателей', kind: 'ok' }
  return { text: 'Не проверен', kind: 'warn' }
}

/** Что значит отметка — этот текст показывается рядом с ней. Врать про
 *  «безопасно» нельзя: разбор автоматический и обойти его можно. */
export const AUDIT_NOTE =
  'Отметка ставится автоматически по коду плагина. «Замечаний нет» значит только то, '
  + 'что бросающегося в глаза не нашлось, — это не проверка человеком. Что бы ни было '
  + 'написано в отметке, плагин работает в песочнице и получает ровно те разрешения, '
  + 'которые ты подтвердишь при установке.'

/** Для тестов: разбор обязан узнавать КАЖДОЕ разрешение. Появится новое, за
 *  которым в коде не видно следа, — каталог начнёт ругать за него все плагины
 *  подряд («просит больше, чем делает»), и отметка обесценится. */
export const AUDITED_PERMISSIONS = ALL_PERMISSIONS


// ── Уровень риска при установке (v1.481.0) ─────────────────────────────────
//
// Владелец выбрал архитектуру «без границ»: приложение не мешает автору
// плагина, но берёт на себя роль честного судьи — при установке человек должен
// увидеть, что именно этот файл сможет делать, и решить сам.
//
// Поэтому список рисков считается ОТ РАЗРЕШЕНИЙ И КОДА, а не от слов автора в
// описании. Красное — то, что касается чужих данных и чужих глаз: переписка,
// файлы, выход наружу, действия от твоего имени. Жёлтое — то, что меняет вид
// или поведение приложения, но само по себе ничего не уносит.

export type RiskLevel = 'red' | 'yellow'

export interface Risk {
  level: RiskLevel
  text: string
}

/** Разрешения, которые в окне установки показываются красным. */
const КРАСНЫЕ: Record<string, string> = {
  'messages.any': 'Читать и писать в ЛЮБОМ канале от твоего имени',
  'messages.intercept': 'Читать и МЕНЯТЬ твои сообщения до отправки и до показа',
  'messages.upload': 'Видеть и МЕНЯТЬ файлы, которые ты отправляешь',
  'messages.read': 'Читать сообщения в открытом канале',
  'messages.write': 'Отправлять сообщения от твоего имени',
  'background': 'Работать в фоне, когда ты на него не смотришь',
}

/** Жёлтое: заметно, но чужого не уносит. */
const ЖЁЛТЫЕ: Record<string, string> = {
  'css': 'Менять внешний вид приложения',
  'ui.theme': 'Менять цвета оформления',
  'apps': 'Открывать свои окна поверх приложения',
  'navigate': 'Открывать каналы вместо тебя',
  'status': 'Менять твою активность, которую видят другие',
  'voice': 'Менять эффект твоего голоса в звонке',
  'music': 'Управлять плеером и Трекотекой',
  'input': 'Видеть подключённые геймпады',
}

/**
 * Чем рискует человек, ставя этот плагин.
 *
 * Отдельной чистой функцией — потому что это единственное место, на которое
 * человек опирается, решая «ставить или нет», и проверять его надо без
 * браузера.
 */
export function installRisks(
  m: { permissions: readonly string[]; hosts: readonly string[] },
  code: string,
): Risk[] {
  const out: Risk[] = []
  for (const p of m.permissions) {
    if (КРАСНЫЕ[p]) out.push({ level: 'red', text: КРАСНЫЕ[p] })
  }
  // Сеть отдельной строкой: важно не «может в интернет», а КУДА именно.
  if (m.permissions.includes('net')) {
    const любой = m.hosts.some(h => h.trim() === '*')
    out.push({
      level: 'red',
      text: любой
        ? 'Отправлять данные на ЛЮБЫЕ сайты — список не ограничен'
        : 'Отправлять данные на сайты: ' + (m.hosts.length ? m.hosts.join(', ') : 'ни один не объявлен'),
    })
  }
  // Спрятанный код — красное всегда: прочитать плагин нельзя, значит и судить
  // о нём по коду нельзя тоже.
  const спрятано = hiddenCode(code)
  if (спрятано.length) {
    out.push({ level: 'red', text: 'Код спрятан (' + спрятано.join(', ') + ') — что он делает, прочитать нельзя' })
  }
  for (const p of m.permissions) {
    if (ЖЁЛТЫЕ[p]) out.push({ level: 'yellow', text: ЖЁЛТЫЕ[p] })
  }
  return out
}

/** Высокий уровень доступа — когда есть хоть одно красное. */
export const highRisk = (risks: Risk[]): boolean => risks.some(r => r.level === 'red')
