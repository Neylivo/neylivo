// Диплинки на сообщение («Скопировать ссылку на сообщение»). Раньше ссылка была
// декоративной: копировался ponoi://msg/<id> без канала/сервера/ЛС и без обработчика,
// который бы такую ссылку открыл — как в Electron (кастомный протокол), так и внутри
// самого приложения (вставленная в чат ссылка ничего не делала при клике).
//
// v1.558.0 (переименование в NeyLivo): новые ссылки — neylivo://, но СТАРЫЕ
// ponoi:// продолжают открываться. Их уже разослали друг другу в переписке, и
// сломать их переименованием значило бы наказать людей за то, что продукт
// сменил имя. Схема одна и та же, различается только слово.
/** Своя схема ссылок. Старое имя принимается наравне — см. ОБЕ_СХЕМЫ. */
export const СХЕМА = 'neylivo'
/** Что считается нашей ссылкой. Порядок важен только для читаемости. */
export const ОБЕ_СХЕМЫ = ['neylivo', 'ponoi'] as const
/** Начинается ли строка с нашей схемы (любой из двух). */
export const нашаСсылка = (url: string) => ОБЕ_СХЕМЫ.some(x => url.startsWith(x + '://'))

export type MsgLinkCtx =
  | { kind: 'server'; serverId: string; channelId: string }
  | { kind: 'dm'; dmId: string }

export function buildMsgLink(ctx: MsgLinkCtx, messageId: string): string {
  return ctx.kind === 'server'
    ? `${СХЕМА}://msg/s/${ctx.serverId}/${ctx.channelId}/${messageId}`
    : `${СХЕМА}://msg/d/${ctx.dmId}/${messageId}`
}

// Разбирает ссылку и рассылает нужные события навигации — дальше их подхватывают
// Home.tsx (переключение на сервер/ЛС) и ServerView.tsx/DMHome.tsx (выбор канала/диалога + прыжок).
export function openMsgLink(url: string): boolean {
  const s = /^(?:neylivo|ponoi):\/\/msg\/s\/([^/]+)\/([^/]+)\/([^/?#]+)/.exec(url)
  if (s) {
    window.dispatchEvent(new CustomEvent('ponoi-open-server', { detail: { id: s[1], channelId: s[2], messageId: s[3] } }))
    return true
  }
  const d = /^(?:neylivo|ponoi):\/\/msg\/d\/([^/]+)\/([^/?#]+)/.exec(url)
  if (d) {
    window.dispatchEvent(new CustomEvent('ponoi-open-dm-thread', { detail: { threadId: d[1], messageId: d[2] } }))
    return true
  }
  return false
}
