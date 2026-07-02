
import { Fragment } from 'react'
import { Avatar } from './Avatar'
import { Attachment } from './Composer'
import { timeShort, dayLabel } from '../lib/ui'

export interface UiMessage {
  id: string
  author: string
  author_name: string
  content?: string | null
  created_at: string
  attach_url?: string | null
  attach_type?: string | null
  author_avatar?: string | null
}

export function MessageList({ messages }: { messages: UiMessage[] }) {
  let lastAuthor = ''
  let lastTs = 0
  let lastDay = ''
  return (
    <>
      {messages.map(m => {
        const ts = new Date(m.created_at).getTime()
        const day = new Date(m.created_at).toDateString()
        const showDay = day !== lastDay
        const grouped = !showDay && m.author === lastAuthor && (ts - lastTs) < 7 * 60 * 1000
        lastAuthor = m.author; lastTs = ts; lastDay = day
        return (
          <Fragment key={m.id}>
            {showDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
            <div className={'msg' + (grouped ? ' grouped' : '')}>
              <div className="msg-gutter">
                {grouped
                  ? <span className="msg-ts-hover">{new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                  : <Avatar name={m.author_name} url={m.author_avatar} size={40} />}
              </div>
              <div className="msg-body">
                {!grouped && <div className="msg-hdr"><span className="nm">{m.author_name}</span><span className="msg-time">{timeShort(m.created_at)}</span></div>}
                {m.content && <div className="msg-txt">{m.content}</div>}
                <Attachment url={m.attach_url} type={m.attach_type} />
              </div>
              <div className="msg-tools">
                <button title="Ответить">↩</button>
                <button title="Ещё">⋯</button>
              </div>
            </div>
          </Fragment>
        )
      })}
    </>
  )
}
