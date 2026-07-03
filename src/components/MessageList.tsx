import { Fragment, useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Attachment } from './Composer'
import { timeShort, dayLabel } from '../lib/ui'
import { loadCustom } from '../lib/emoji'
import type { RxSummary } from '../lib/reactions'
import { Icon } from './icons'

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
}

const QUICK = ['👍', '❤️', '😂', '🔥', '🎉', '😢']

// Render message text, replacing :name: tokens with custom-emoji images.
// Uses the synchronous shared-emoji cache (loadCustom); the component re-renders
// on 'ponoi-custom-emoji' so newly-synced emoji resolve for everyone.
function renderContent(text: string) {
  const custom = loadCustom()
  const parts = text.split(/(:[a-zA-Z0-9_]+:)/g)
  return parts.map((p, i) => {
    const m = p.match(/^:([a-zA-Z0-9_]+):$/)
    if (m && custom[m[1]]) return <img key={i} className="inline-emoji" src={custom[m[1]]} alt={p} />
    return <Fragment key={i}>{p}</Fragment>
  })
}

interface Props {
  messages: UiMessage[]
  reactions?: Record<string, RxSummary[]>
  currentUser?: string
  canPin?: (m: UiMessage) => boolean
  onReact?: (id: string, emoji: string) => void
  onPin?: (id: string, pinned: boolean) => void
  onDelete?: (id: string) => void
}

export function MessageList({ messages, reactions = {}, currentUser, canPin, onReact, onPin, onDelete }: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [, setEmojiVer] = useState(0)

  // Re-render message bodies when the shared custom-emoji cache updates.
  useEffect(() => {
    const h = () => setEmojiVer(v => v + 1)
    window.addEventListener('ponoi-custom-emoji', h)
    return () => window.removeEventListener('ponoi-custom-emoji', h)
  }, [])

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
        const grouped = !showDay && m.author === lastAuthor && (ts - lastTs) < 7 * 60 * 1000
        lastAuthor = m.author; lastTs = ts; lastDay = day
        const rx = reactions[m.id] ?? []
        return (
          <Fragment key={m.id}>
            {showDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
            <div className={'msg' + (grouped ? ' grouped' : '') + (m.pinned ? ' pinned' : '')}
              onContextMenu={e => { e.preventDefault(); setPickFor(null); setMenu({ id: m.id, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 260) }) }}>
              <div className="msg-gutter">
                {grouped
                  ? <span className="msg-ts-hover">{new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                  : <Avatar name={m.author_name} url={m.author_avatar} size={40} />}
              </div>
              <div className="msg-body">
                {m.pinned && <div className="msg-pinned-tag"><Icon name="pin" size={13} /> Закреплено</div>}
                {!grouped && <div className="msg-hdr"><span className="nm">{m.author_name}</span><span className="msg-time">{timeShort(m.created_at)}</span></div>}
                {m.content && <div className="msg-txt">{renderContent(m.content)}</div>}
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
                <button title="Реакция" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="smile" size={18} /></button>
                {rx.length === 0 && pickFor === m.id && <div className="rx-quick tools-quick">
                  {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}>{e}</button>)}
                </div>}
                <button title="Ещё" onClick={e => { setPickFor(null); setMenu({ id: m.id, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 260) }) }}><Icon name="more" size={18} /></button>
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
          {(canPin ? canPin(menuMsg) : true) &&
            <div className="ctx-item" onClick={() => { onPin?.(menu.id, !menuMsg.pinned); setMenu(null) }}><Icon name="pin" size={15} /> {menuMsg.pinned ? 'Открепить' : 'Закрепить'}</div>}
          {menuMsg.content && <div className="ctx-item" onClick={() => { navigator.clipboard?.writeText(menuMsg.content ?? ''); setMenu(null) }}><Icon name="copy" size={15} /> Копировать текст</div>}
          {menuMsg.author === currentUser && <div className="ctx-item danger" onClick={() => { onDelete?.(menu.id); setMenu(null) }}><Icon name="trash" size={15} /> Удалить</div>}
        </div>
      </>}
    </>
  )
}