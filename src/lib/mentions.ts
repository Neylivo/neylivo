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

// ── v1.449.0: право на @everyone/@here и на упоминание ролей ──────────────────
//
// Что было. Права MENTION_EVERYONE и MENTION_ROLES проверялись ровно в одном
// месте — в поле ввода у ОТПРАВИТЕЛЯ (Composer.tsx). База их не проверяет
// нигде: во всех правилах доступа этих битов нет вовсе. То есть право обходилось
// тривиально — своим клиентом, ботом или плагином через ponoi.messages.send: в
// сообщение вписывалось @everyone, и звенело у всех.
//
// Как теперь. Решает ПОЛУЧАТЕЛЬ. Каждый клиент, рисуя чужое сообщение, сам
// смотрит, было ли у автора право на такое упоминание, и если не было —
// обращается с ним как с обычным текстом: без подсветки и без звонка. Обойти
// это своим клиентом нельзя: он управляет только тем, что видит сам.
//
// Почему не в базе. Проверка «что написано в тексте сообщения» — это правило на
// содержимое, а не на доступ; оно потребовало бы разбора текста в SQL и падало
// бы на любом хитром написании. Решение получателя честнее: оно ровно про то,
// звенеть ли ЕМУ.

/** Права упоминания у автора сообщения. undefined — «правила не применяются»
 *  (личная переписка, где ролей нет вовсе). */
export type MentionRights = {
  /** Автор может звать @everyone и @here. */
  everyone?: boolean
  /** Автор может упоминать роли. */
  roles?: boolean
}

/** Текст сообщения глазами получателя: то, что автору не позволено, упоминанием
 *  не считается. Возвращает, звенеть ли лично мне. */
export function mentionsMe(text: string, myName: string, rights?: MentionRights): boolean {
  if (!text || !myName) return false
  const общее = /@everyone(?![\p{L}\p{N}_])/u.test(text) || mentionsHere(text)
  // Право не выдано — обращаемся как с обычным текстом.
  if (общее && rights?.everyone !== false) return true
  return nameMentioned(text, myName)
}

/** То же для упоминания роли. */
export function mentionsMyRole(text: string, roleName: string, rights?: MentionRights): boolean {
  if (rights?.roles === false) return false
  return nameMentioned(text, roleName)
}
