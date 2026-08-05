// v1.445.0: правила выхода плагина в интернет — одним местом.
//
// Зачем вынесено. Проверки (только https, только объявленные в @hosts домены,
// никогда не к самому Ponoi и его серверу, белый список заголовков) жили внутри
// одной функции pluginFetch. Как только рядом появился второй способ выйти в
// сеть — потоковый, для ИИ-моделей, — эти проверки пришлось бы написать второй
// раз. Второй список всегда расходится с первым: достаточно один раз забыть
// добавить в него новую проверку, и обход готов.
//
// Теперь оба способа зовут одни и те же функции отсюда. Проверка на это есть
// в src/lib/plugins/__attack_test.ts: там поток штурмуется тем же набором
// запрещённых адресов, что и обычный запрос.

/** Что можно делать. GET и POST мало: половина обычных API — это правки. */
export const NET_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Заголовки, которые плагину можно поставить.
 *
 * Authorization и ключи здесь намеренно: без них не обратиться ни к одному
 * сервису, где нужен ключ, — а это почти все, и все ИИ-модели в том числе. Ключ
 * плагин приносит свой, запрос идёт без куки и только на объявленный домен.
 *
 * Cookie нельзя никогда: это единственный заголовок, который браузер считает
 * «своим» для сайта.
 */
export const NET_HEADERS = [
  'content-type', 'accept', 'authorization', 'x-api-key', 'x-auth-token',
  'user-agent', 'accept-language',
  // v1.445.0: этими подписываются у Anthropic и OpenAI-совместимых сервисов —
  // без них своя ИИ-модель в плагине не заводится вовсе.
  'anthropic-version', 'anthropic-beta', 'openai-organization', 'openai-beta', 'x-goog-api-key',
]

export type NetTarget = {
  /** Домены из @hosts этого плагина. */
  hosts: readonly string[]
  /** Домен самого приложения. */
  selfHost: string
  /** Домен нашего сервера (Supabase). */
  supaHost: string
}

/**
 * Можно ли туда ходить. Возвращает причину отказа или null.
 *
 * Отдельной функцией — чтобы и обычный запрос, и поток спрашивали одно и то же.
 */
/**
 * v1.465.0: постоянное соединение (WebSocket) идёт через ЭТУ ЖЕ проверку.
 *
 * Разница ровно одна — схема: у запроса https, у соединения wss. Всё
 * остальное — объявленные домены, запрет на самого Ponoi и его сервер — обязано
 * совпадать до буквы, поэтому проверка одна, а схема — довод. Второй список
 * правил рано или поздно разошёлся бы с первым, и это был бы готовый обход.
 */
export function checkTarget(rawUrl: string, t: NetTarget, scheme: 'https:' | 'wss:' = 'https:'): string | null {
  let url: URL
  try { url = new URL(String(rawUrl ?? '')) } catch { return 'Плохой адрес запроса.' }
  if (url.protocol !== scheme) {
    return scheme === 'wss:' ? 'Разрешены только wss-адреса.' : 'Разрешены только https-адреса.'
  }
  const host = url.hostname.toLowerCase()
  // v1.481.0: звёздочка в @hosts означает «любой сайт».
  //
  // Прямое решение владельца: приложение не мешает автору плагина, а честно
  // предупреждает человека при установке. Плагин со звёздочкой показывается на
  // экране установки красной строкой «может обращаться к ЛЮБЫМ сайтам» — то
  // есть выбор остаётся за тем, кто ставит, а не за нами.
  //
  // Что звёздочка НЕ открывает — два адреса ниже. Это не «ещё одно
  // ограничение», а граница безопасности: запрос к самому Ponoi и к его
  // серверу ушёл бы с нашего origin, то есть с правами человека, и тогда
  // изоляция сессии (главное, что вообще есть у песочницы) перестала бы
  // существовать.
  const любой = t.hosts.some(h => h.trim() === '*')
  if (!любой && !t.hosts.some(h => h.toLowerCase() === host)) {
    return `Домен ${url.hostname} не объявлен в @hosts этого плагина.`
  }
  // Своё же приложение и свой сервер — не «внешний сайт»: запрос туда пошёл бы
  // через наш origin, чего плагину не положено вообще никогда.
  if (host === t.selfHost.toLowerCase() || (t.supaHost && host === t.supaHost.toLowerCase())) {
    return 'Обращаться к самому Ponoi и его серверу плагинам нельзя.'
  }
  return null
}

export function checkMethod(method: string): string | null {
  return NET_METHODS.includes(method) ? null : 'Разрешены методы ' + NET_METHODS.join(', ') + '.'
}

/** Только разрешённые заголовки и только разумной длины. */
export function pickHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (NET_HEADERS.includes(k.toLowerCase())) out[k] = String(v).slice(0, 500)
  }
  return out
}

export function normMethod(v: unknown): string {
  return String(v ?? 'GET').toUpperCase()
}
