import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel, Message } from '../types'
import { colorFor, initial, timeShort } from '../lib/ui'
import { MeBar } from './MeBar'

export function ServerView({ server, username }: { server: Server; username: string }) {
  const { user } = useAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const [curChannel, setCurChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadChannels() /* eslint-disable-next-line */ }, [server.id])

  async function loadChannels() {
    const { data } = await supabase.from('channels').select('*').eq('server_id', server.id).order('name')
    const list = data ?? []
    setChannels(list)
    if (list.length) selectChannel(list[0]); else { setCurChannel(null); setMessages([]) }
  }

  async function selectChannel(c: Channel) {
    setCurChannel(c)
    const { data } = await supabase.from('messages').select('*')
      .eq('channel_id', c.id).order('created_at').limit(100)
    setMessages(data ?? [])
  }

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('messages:' + curChannel.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => setMessages(m => [...m, p.new as Message]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function createChannel() {
    const name = prompt('Название канала')?.trim()
    if (!name) return
    const { error } = await supabase.from('channels').insert({ server_id: server.id, name })
    if (error) return alert(error.message)
    loadChannels()
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t || !curChannel || !user) return
    setText('')
    const { error } = await supabase.from('messages').insert({
      channel_id: curChannel.id, author: user.id, author_name: username, content: t,
    })
    if (error) alert(error.message)
  }

  return (
    <>
      <aside className="channels">
        <div className="srv-title">{server.name}</div>
        <div className="ch-list">
          {channels.map(c => (
            <div key={c.id} className={'ch' + (curChannel?.id === c.id ? ' on' : '')}
              onClick={() => selectChannel(c)}># {c.name}</div>
          ))}
          <div className="ch add" onClick={createChannel}>＋ канал</div>
        </div>
        <MeBar username={username} />
      </aside>
      <main className="chat">
        <header className="chat-head"># {curChannel?.name ?? '—'}</header>
        <div className="msgs">
          {messages.map(m => (
            <div key={m.id} className="msg">
              <div className="msg-av" style={{ background: colorFor(m.author_name) }}>{initial(m.author_name)}</div>
              <div className="msg-body">
                <div className="msg-hdr"><b>{m.author_name}</b><span className="msg-time">{timeShort(m.created_at)}</span></div>
                <div className="msg-txt">{m.content}</div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        {curChannel && (
          <form className="composer" onSubmit={send}>
            <input placeholder={'Написать в #' + curChannel.name} value={text} onChange={e => setText(e.target.value)} />
            <button type="submit">➤</button>
          </form>
        )}
      </main>
    </>
  )
}
