// v1.413.0: упоминания — отдельно от разметчика сообщений.
//
// Зачем разделять. Эти три функции — простые проверки строки, и нужны они не
// только там, где рисуется сообщение: по ним решают, звенеть ли уведомлению.
// Пока они жили в md.tsx, каждый, кому нужно было одно «есть ли тут моё имя»,
// тянул за собой весь разметчик — со всеми его правилами, подсветкой кода и
// разбором ссылок. Общий слушатель уведомлений живёт с первой секунды
// приложения, и из-за этого разметчик поехал в стартовую сборку, а она и без
// него подпирала потолок.
//
// md.tsx их переэкспортирует, чтобы прежние места ничего не заметили.

function nameMentioned(text: string, name: string): boolean {
  if (!text || !name) return false
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try { return new RegExp('@' + esc + '(?![\\p{L}\\p{N}_])', 'iu').test(text) } catch { return false }
}

/** Есть ли в тексте @here — v1.248.0, как в Discord: оповещает только тех, кто
 *  сейчас в сети (в отличие от @everyone — всех). Отдельный экспорт нужен там,
 *  где важно различить «все» и «только онлайн» (фильтр пуш-уведомлений). */
export function mentionsHere(text: string): boolean {
  if (!text) return false
  return /@here(?![\p{L}\p{N}_])/u.test(text)
}

/** Есть ли в тексте упоминание конкретного пользователя (или @everyone/@here).
 *  @here трактуется как личное упоминание для того, кто СЕЙЧАС читает: раз
 *  клиент запущен и получает это сообщение, значит, он и так в сети. */
export function mentionsUser(text: string, name: string): boolean {
  if (!text || !name) return false
  if (/@everyone(?![\p{L}\p{N}_])/u.test(text)) return true
  if (mentionsHere(text)) return true
  return nameMentioned(text, name)
}

/** Есть ли в тексте упоминание роли по имени (@Название роли), v1.239.0. */
export function mentionsRoleName(text: string, roleName: string): boolean {
  return nameMentioned(text, roleName)
}
