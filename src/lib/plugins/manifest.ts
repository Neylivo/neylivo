import { ALL_PERMISSIONS, PluginParseError, type Permission, type PluginManifest } from './types'

// v1.286.0: разбор шапки .ponoi-файла. Формат намеренно тот же, к которому уже
// привыкли люди по BetterDiscord/exteraGram — блочный комментарий с @полями в
// начале файла, а дальше обычный JS:
//
//   /**
//    * @name Автоперевод
//    * @id auto-translate
//    * @version 1.0.0
//    * @author nubas
//    * @description Переводит входящие сообщения
//    * @permissions messages.read, ui, storage
//    * @hosts translate.googleapis.com
//    * @icon https://example.com/icon.png
//    * @banner https://example.com/banner.jpg
//    */
//   export function onLoad(ponoi) { ... }

/** Потолок размера файла. Плагин — это логика, а не ассеты; всё, что больше, почти
 *  наверняка попытка запихнуть в чат бинарник под видом плагина. */

// Длины поджаты под то, как поля реально показываются в списке и на экране
// установки: без потолка чужой плагин может расползтись на весь экран.
const MAX_NAME = 60
const MAX_AUTHOR = 40
const MAX_DESC = 300
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
// Домен без схемы и пути: именно с ним потом сверяется url при запросах (см. api.ts).
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

function cut(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? t.slice(0, max) + '…' : t
}

/**
 * Достаёт поля из первого блочного комментария файла. Возвращает карту имя→значение;
 * повторяющиеся поля берутся по первому вхождению (чтобы нельзя было спрятать
 * второй @permissions ниже по файлу и надеяться, что прочитают именно его).
 */
function readTags(code: string): Record<string, string> {
  const m = code.match(/\/\*\*([\s\S]*?)\*\//)
  if (!m) throw new PluginParseError('В файле нет шапки плагина (блок /** ... */ с полями @name, @id и т.д.)')
  const out: Record<string, string> = {}
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/^\s*\*?\s?/, '')
    const t = line.match(/^@(\w[\w.-]*)\s+(.*)$/)
    if (!t) continue
    const key = t[1].toLowerCase()
    if (!(key in out)) out[key] = t[2].trim()
  }
  return out
}

/**
 * Откуда взялся список разрешений (v1.557.0, находка F6 аудита).
 *
 * «Забыл написать @permissions» и «сознательно написал @permissions *» до сих
 * пор выглядели для человека ОДИНАКОВО — обе строки давали все разрешения и
 * один и тот же красный экран. А означают они разное: во втором случае автор
 * решение принял, в первом его не было вовсе. Человеку, который решает
 * «ставить или нет», разница существенная, и теперь она видна.
 *
 * list    — перечислено руками, действует ровно перечисленное;
 * star    — «*», то есть осознанное «дай всё»;
 * omitted — строки @permissions в шапке нет вовсе;
 * none    — осознанное «ничего» (так пишет конструктор).
 */
export type PermsSource = 'list' | 'star' | 'omitted' | 'none'

export function permsSourceOf(raw: string | undefined): PermsSource {
  if (!raw || !raw.trim()) return 'omitted'
  const t = raw.trim().toLowerCase()
  if (t === 'none') return 'none'
  if (raw.split(/[,\s]+/).some(x => x.trim() === '*')) return 'star'
  return 'list'
}

function parsePermissions(raw: string | undefined): Permission[] {
  // v1.499.0: НЕ НАПИСАЛ @permissions — значит ВСЕ.
  //
  // Владелец: «убери абсолютно все ошибки в плагинах/ботах, чтобы можно было
  // сделать всё как угодно». Самая частая ошибка автора именно эта: код
  // правильный, но в шапке забыта строка — и плагин падает на первом же
  // вызове. Раньше пустой список значил «ничего нельзя», то есть забывчивость
  // наказывалась молчаливой поломкой.
  //
  // Человека это НЕ обманывает: такой плагин показывается на установке всеми
  // красными строками сразу и требует нажать «Я понимаю риски» — ровно как со
  // звёздочкой. То есть проще становится автору, а видно человеку столько же.
  //
  // Написал список — он и действует: автор сам решил ограничиться, и человек
  // согласился именно на это.
  if (!raw || !raw.trim()) return [...ALL_PERMISSIONS]
  // «none» — это осознанное «ничего», а не забывчивость. Так пишет конструктор,
  // когда человек не выбрал ни одного разрешения: иначе его «ничего» молча
  // превратилось бы во «всё».
  if (raw.trim().toLowerCase() === 'none') return []
  const out: Permission[] = []
  // v1.485.0: звёздочка — «все разрешения».
  //
  // Владелец попросил, чтобы добавлять разрешения было легче. Самая частая
  // морока у автора плагина именно эта: написал код, забыл дописать строку в
  // шапке — и плагин падает на первом же вызове, причём человек видит не
  // «автор забыл», а «приложение сломалось».
  //
  // Прятать это не приходится: на экране установки такой плагин показывается
  // всеми красными строками сразу и требует нажать «Я понимаю риски». То есть
  // легче становится автору, а человек видит РОВНО то же, что и раньше.
  if (raw.split(/[,\s]+/).some(x => x.trim() === '*')) return [...ALL_PERMISSIONS]
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const p = part.toLowerCase()
    // Неизвестное разрешение — именно ошибка, а не молчаливый пропуск: иначе плагин,
    // написанный под будущую версию, поставится и будет молча не работать, а человек
    // будет думать, что виновато приложение.
    if (!(ALL_PERMISSIONS as string[]).includes(p)) {
      throw new PluginParseError(`Неизвестное разрешение «${cut(part, 30)}». Плагин рассчитан на другую версию Ponoi.`)
    }
    if (!out.includes(p as Permission)) out.push(p as Permission)
  }
  return out
}

export function parsePlugin(code: string): PluginManifest {
  const tags = readTags(code)

  const id = (tags.id || '').toLowerCase()
  if (!ID_RE.test(id)) {
    throw new PluginParseError('Поле @id обязательно: от 2 до 64 символов, только латиница, цифры и дефис.')
  }
  const name = cut(tags.name || '', MAX_NAME)
  if (!name) throw new PluginParseError('Поле @name обязательно.')
  const version = cut(tags.version || '', 20)
  if (!version) throw new PluginParseError('Поле @version обязательно (например 1.0.0).')

  const permissions = parsePermissions(tags.permissions)
  const permsSource = permsSourceOf(tags.permissions)
  const hosts = (tags.hosts || '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(h => h.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  for (const h of hosts) {
    if (!HOST_RE.test(h)) throw new PluginParseError(`Плохой домен в @hosts: «${cut(h, 40)}».`)
  }
  // v1.485.0: со звёздочкой это НЕ ошибка автора. «@permissions *» значит «дай
  // всё, чтобы не перечислять руками», и требовать после этого ещё и список
  // сайтов — ровно та морока, от которой звёздочка и избавляет. Сеть при этом
  // не открывается сама собой: без @hosts плагину просто некуда идти, и на
  // экране установки так и написано — «ни один сайт не объявлен».
  // v1.499.0: net без @hosts больше НЕ ошибка.
  //
  // Раньше плагин не ставился вовсе — и это было последнее место, где
  // забытая строка в шапке роняла установку. Теперь домены просто не
  // объявлены: сеть от этого не открывается сама собой, плагину некуда идти,
  // и он узнает об этом внятным отказом при первом же запросе, а не отказом
  // поставиться.

  // v1.349.0: своя картинка и шапка. Только https и только картинка по виду
  // адреса: это поле показывается всем, кто видит плагин в каталоге, и грузится
  // их браузерами — javascript: и data: тут не нужны никому.
  const pic = (raw: string | undefined): string | null => {
    const v = (raw ?? '').trim()
    if (!v) return null
    if (!/^https:\/\//i.test(v)) throw new PluginParseError('Ссылка на картинку должна начинаться с https://')
    if (v.length > 500) throw new PluginParseError('Слишком длинная ссылка на картинку.')
    return v
  }

  return {
    id,
    name,
    version,
    author: cut(tags.author || 'неизвестен', MAX_AUTHOR),
    description: cut(tags.description || '', MAX_DESC),
    permissions,
    permsSource,
    // Без разрешения net домены не значат ничего — не храним, чтобы они не создавали
    // ложного впечатления на экране установки.
    hosts: permissions.includes('net') ? hosts : [],
    icon: pic(tags.icon),
    banner: pic(tags.banner),
  }
}

/** Сравнение версий вида 1.2.3; нечисловые куски сравниваются как строки. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.'), pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] ?? '0', 10), nb = parseInt(pb[i] ?? '0', 10)
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na < nb ? -1 : 1
    } else {
      const sa = pa[i] ?? '', sb = pb[i] ?? ''
      if (sa !== sb) return sa < sb ? -1 : 1
    }
  }
  return 0
}
