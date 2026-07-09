// Диплинки на сообщение («Скопировать ссылку на сообщение»). Раньше ссылка была
// декоративной: копировался ponoi://msg/<id> без канала/сервера/ЛС и без обработчика,
// который бы такую ссылку открыл — как в Electron (кастомный протокол), так и внутри
// самого приложения (вставленная в чат ссылка ничего не делала при клике).
export type MsgLinkCtx =
  | { kind: 'server'; serverId: string; channelId: string }
  | { kind: 'dm'; dmId: string }

export function buildMsgLink(ctx: MsgLinkCtx, messageId: string): string {
  return ctx.kind === 'server'
    ? `ponoi://msg/s/${ctx.serverId}/${ctx.channelId}/${messageId}`
    : `ponoi://msg/d/${ctx.dmId}/${messageId}`
}

// Разбирает ссылку и рассылает нужные события навигации — дальше их подхватывают
// Home.tsx (переключение на сервер/ЛС) и ServerView.tsx/DMHome.tsx (выбор канала/диалога + прыжок).
export function openMsgLink(url: string): boolean {
  const s = /^ponoi:\/\/msg\/s\/([^/]+)\/([^/]+)\/([^/?#]+)/.exec(url)
  if (s) {
    window.dispatchEvent(new CustomEvent('ponoi-open-server', { detail: { id: s[1], channelId: s[2], messageId: s[3] } }))
    return true
  }
  const d = /^ponoi:\/\/msg\/d\/([^/]+)\/([^/?#]+)/.exec(url)
  if (d) {
    window.dispatchEvent(new CustomEvent('ponoi-open-dm-thread', { detail: { threadId: d[1], messageId: d[2] } }))
    return true
  }
  return false
}
