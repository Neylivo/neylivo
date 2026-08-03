// v1.440.0: как выглядит системное уведомление.
//
// Что было. Заголовок и текст собирались прямо в месте отправки: где-то «Имя»,
// где-то «Имя — #канал», а телом уходило СЫРОЕ содержимое сообщения. Из-за
// этого в уведомлении показывались служебные вставки (пересланное сообщение,
// карточки игр, спойлеры) и простыни на тысячу знаков, которые система всё
// равно обрезает как попало. Плюс два сообщения подряд из одного места
// показывались двумя одинаковыми плашками.
//
// Здесь — правила показа, отдельно и проверяемо.

/** Длина, после которой система всё равно обрежет сама — режем красиво. */
export const BODY_MAX = 140

export interface NotifyInput {
  author: string
  text?: string | null
  /** Название канала, если это сервер. */
  channel?: string | null
  /** Есть вложение, а текста нет. */
  hasAttach?: boolean
  /** Упомянули лично. */
  mention?: boolean
  /** Сколько ещё сообщений пришло из этого же места до открытия. */
  more?: number
}

export interface NotifyText { title: string; body: string }

/** Убрать из текста то, что человеку в уведомлении не нужно. */
export function cleanBody(text: string | undefined | null): string {
  let s = (text || '').replace(/\r/g, '')
  // Служебные вставки приложения (пересланное, карточки игр, приглашения):
  s = s.replace(/\u2063[^\u2063]*\u2063[^\n]*/g, ' ')
  // Спойлер показывать нельзя: его для того и поставили.
  s = s.replace(/\|\|[^|]*\|\|/g, '▮▮')
  // Разметка: в системном окне она не рисуется, а знаки видны.
  s = s.replace(/```[\s\S]*?```/g, '「код」').replace(/`([^`]+)`/g, '$1')
  s = s.replace(/^>\s?/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1').replace(/~~([^~]+)~~/g, '$1')
  // Ссылка целиком в уведомлении бесполезна — она длинная и не нажимается.
  s = s.replace(/https?:\/\/\S+/g, '🔗 ссылка')
  return s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

/** Обрезать по словам, а не посреди слова. */
export function trimBody(s: string, max = BODY_MAX): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

/**
 * Заголовок и тело уведомления.
 *
 * Заголовок: кто и куда написал. Упоминание помечено — по нему человек решает,
 * бросать ли дела. Тело: очищенный текст, «Вложение» вместо пустоты и хвост
 * «и ещё N сообщений», когда за это время пришло несколько.
 */
export function fmtNotification(i: NotifyInput): NotifyText {
  const who = (i.author || 'Сообщение').trim()
  const title = (i.mention ? '@ ' : '') + who + (i.channel ? ' — #' + i.channel : '')
  const clean = cleanBody(i.text)
  let body = clean || (i.hasAttach ? 'Вложение' : 'Новое сообщение')
  body = trimBody(body)
  const more = Math.max(0, i.more ?? 0)
  if (more > 0) body += '\n' + plusMessages(more)
  return { title, body }
}

/** «и ещё 1 сообщение / 2 сообщения / 5 сообщений». */
export function plusMessages(n: number): string {
  const d = n % 100
  const w = d >= 11 && d <= 14 ? 'сообщений'
    : n % 10 === 1 ? 'сообщение'
    : n % 10 >= 2 && n % 10 <= 4 ? 'сообщения'
    : 'сообщений'
  return 'и ещё ' + n + ' ' + w
}
