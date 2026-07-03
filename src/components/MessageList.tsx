import { Fragment, useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Attachment } from './Composer'
import { timeShort, dayLabel } from '../lib/ui'
import { renderMd, mentionsUser } from '../lib/md'
import type { RxSummary } from '../lib/reactions'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'
import { toastOk } from '../lib/toast'

export interface UiMessage {
  id: string
  author: string
  author_name: string
  content?: string | null
  created_at: string
  attach_url?: string | null
  attach_type?: string | null
  author_avatar?: string | null
  pinned?: boolean
  reply_to?: string | null
  reply_author?: string | null
  reply_preview?: string | null
  edited?: boolean
}

const QUICK = ['👍', '❤️', '😂', '🔥', '🎉', '😢']

// Detect a message consisting solely of emoji (1..8) so it can render large.
function isEmojiOnly(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  try {
    const stripped = t.replace(/\s+/g, '')
    const re = /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D)+$/u
    const count = [...stripped.matchAll(/\p{Extended_Pictographic}/gu)].length
    return re.test(stripped) && count >= 1 && count <= 8
  } catch { return false }
}

// Рендер текста: мини-маркдаун Discord (жирный/курсив/код/цитаты/спойлеры/ссылки) + кастом-эмодзи.
function renderContent(text: string) {
  return renderMd(text)
}

interface Props {
  messages: UiMessage[]
  reactions?: Record<string, RxSummary[]>
  currentUser?: string
  currentUserName?: string
  canPin?: (m: UiMessage) => boolean
  onReact?: (id: string, emoji: string) => void
  onPin?: (id: string, pinned: boolean) => void
  onDelete?: (id: string) => void
  onReply?: (m: UiMessage) => void
  onEdit?: (id: string, content: string) => void | Promise<void>
}

export function MessageList({ messages, reactions = {}, currentUser, currentUserName, canPin, onReact, onPin, onDelete, onReply, onEdit }: Props) {
  const { settings } = useSettings()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [, setEmojiVer] = useState(0)

  // Re-render message bodies when the shared custom-emoji cache updates.
  useEffect(() => {
    const h = () => setEmojiVer(v => v + 1)
    window.addEventListener('ponoi-custom-emoji', h)
    return () => window.removeEventListener('ponoi-custom-emoji', h)
  }, [])

  // ↑ в пустом композере — редактировать своё последнее сообщение (событие из Composer).
  useEffect(() => {
    const h = () => {
      if (!onEdit) return
      const mine = [...messages].reverse().find(m => m.author === currentUser && m.content)
      if (mine) { setEditing(mine.id); setEditText(mine.content ?? '') }
    }
    window.addEventListener('ponoi-edit-last', h)
    return () => window.removeEventListener('ponoi-edit-last', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentUser, onEdit])

  async function saveEdit(id: string) {
    const t = editText.trim()
    if (t) await onEdit?.(id, t)
    else onDelete?.(id) // стёр весь текст — предложить удалить сообщение (с подтверждением)
    setEditing(null)
  }

  let lastAuthor = ''
  let lastTs = 0
  let lastDay = ''

  const menuMsg = menu ? messages.find(m => m.id === menu.id) : null

  return (
    <>
      {messages.map(m => {
        const ts = new Date(m.created_at).getTime()
        const day = new Date(m.created_at).toDateString()
        const showDay = day !== lastDay
        const isReply = !!m.reply_to
        // Replies always show their own header (so the quote reads clearly).
        const grouped = settings.groupMessages && !isReply && !showDay && m.author === lastAuthor && (ts - lastTs) < 7 * 60 * 1000
        lastAuthor = m.author; lastTs = ts; lastDay = day
        const rx = reactions[m.id] ?? []
        const meMentioned = !!(currentUserName && m.content && m.author !== currentUser && mentionsUser(m.content, currentUserName))
        return (
          <Fragment key={m.id}>
            {showDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
            <div className={'msg' + (grouped ? ' grouped' : '') + (m.pinned ? ' pinned' : '') + (meMentioned ? ' mention-hl' : '')}
              onContextMenu={e => { e.preventDefault(); setPickFor(null); setMenu({ id: m.id, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 300) }) }}>
              <div className="msg-gutter">
                {grouped
                  ? <span className="msg-ts-hover">{timeShort(m.created_at)}</span>
                  : settings.showAvatars
                  ? <Avatar name={m.author_name} url={m.author_avatar} size={40} />
                  : null}
              </div>
              <div className="msg-body">
                {isReply && <div className="msg-reply"><Icon name="reply" size={13} /> <b>{m.reply_author}</b> <span className="msg-reply-tx">{m.reply_preview}</span></div>}
                {m.pinned && <div className="msg-pinned-tag"><Icon name="pin" size={13} /> Закреплено</div>}
                {!grouped && <div className="msg-hdr"><span className="nm">{m.author_name}</span><span className="msg-time">{timeShort(m.created_at)}</span></div>}
                {editing === m.id
                  ? <div className="msg-edit">
                      <textarea className="msg-edit-in" value={editText} autoFocus
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m.id) }
                        }} />
                      <div className="msg-edit-hint">Esc — <button type="button" onClick={() => setEditing(null)}>отмена</button> • Enter — <button type="button" onClick={() => saveEdit(m.id)}>сохранить</button></div>
                    </div>
                  : m.content && <div className={'msg-txt' + (settings.bigEmoji && isEmojiOnly(m.content) ? ' big-emoji' : '')}>{renderContent(m.content)}{m.edited && <span className="msg-edited">(изменено)</span>}</div>}
                <Attachment url={m.attach_url} type={m.attach_type} />
                {rx.length > 0 && <div className="rx-bar">
                  {rx.map(r => {
                    const mine = currentUser ? r.users.includes(currentUser) : false
                    return <button key={r.emoji} className={'rx' + (mine ? ' mine' : '')} onClick={() => onReact?.(m.id, r.emoji)}>
                      <span>{r.emoji}</span><span className="rx-n">{r.count}</span>
                    </button>
                  })}
                  <button className="rx rx-add" title="Добавить реакцию" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="plus" size={14} /></button>
                  {pickFor === m.id && <div className="rx-quick">
                    {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}>{e}</button>)}
                  </div>}
                </div>}
              </div>
              <div className="msg-tools">
                {onReply && <button title="Ответить" onClick={() => onReply(m)}><Icon name="reply" size={18} /></button>}
                <button title="Реакция" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="smile" size={18} /></button>
                {rx.length === 0 && pickFor === m.id && <div className="rx-quick tools-quick">
                  {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}>{e}</button>)}
                </div>}
                {m.author === currentUser && onEdit && m.content && <button title="Изменить" onClick={() => { setEditing(m.id); setEditText(m.content ?? '') }}><Icon name="edit" size={18} /></button>}
                <button title="Ещё" onClick={e => { setPickFor(null); setMenu({ id: m.id, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 300) }) }}><Icon name="more" size={18} /></button>
              </div>
            </div>
          </Fragment>
        )
      })}

      {menu && menuMsg && <>
        <div className="ctx-overlay" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="ctx-quick">
            {QUICK.map(e => <button key={e} onClick={() => { onReact?.(menu.id, e); setMenu(null) }}>{e}</button>)}
          </div>
          {onReply && <div className="ctx-item" onClick={() => { onReply(menuMsg); setMenu(null) }}><Icon name="reply" size={15} /> Ответить</div>}
          {menuMsg.author === currentUser && onEdit && menuMsg.content && <div className="ctx-item" onClick={() => { setEditing(menuMsg.id); setEditText(menuMsg.content ?? ''); setMenu(null) }}><Icon name="edit" size={15} /> Изменить</div>}
          {(canPin ? canPin(menuMsg) : true) &&
            <div className="ctx-item" onClick={() => { onPin?.(menu.id, !menuMsg.pinned); setMenu(null) }}><Icon name="pin" size={15} /> {menuMsg.pinned ? 'Открепить' : 'Закрепить'}</div>}
          {menuMsg.content && <div className="ctx-item" onClick={() => { navigator.clipboard?.writeText(menuMsg.content ?? ''); toastOk('Текст скопирован'); setMenu(null) }}><Icon name="copy" size={15} /> Копировать текст</div>}
          {menuMsg.author === currentUser && <div className="ctx-item danger" onClick={() => { onDelete?.(menu.id); setMenu(null) }}><Icon name="trash" size={15} /> Удалить</div>}
        </div>
      </>}
    </>
  )
}