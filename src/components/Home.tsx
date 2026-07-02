import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel, Message } from '../types'

const PALETTE = ['#5865f2', '#eb459e', '#3ba55d', '#faa61a', '#ed4245', '#9b59b6', '#1abc9c']
function colorFor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function Home() {
  const { user } = useAuth()
  const [username, setUsername] = useState('Вы')
  const [servers, setServers] = useState<Server[]>([])
  const [curServer, setCurServer] = useState<Server | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [curChannel, setCurChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('username').eq('id', user.id).single()
      .then(({ data }) => { if (data?.username) setUsername(data.username) })
    loadServers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function loadServers(select?: Server) {
    const { data } = await supabase.from('servers').select('*').order('created_at')
    const list = data ?? []
    setServers(list)
    const pick = select ?? curServer ?? list[0] ?? null
    if (pick) selectServer(pick)
  }

  async function selectServer(s: Server) {
    setCurServer(s)
    const { data } = await supabase.from('channels').select('*').eq('server_id', s.id).order('name')
    const list = data ?? []
    setChannels(list)
    if (list.length) selectChannel(list[0])
    else { setCurChannel(null); setMessages([]) }
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
        payload => setMessages(m => [...m, payload.new as Message]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function createServer() {
    const name = prompt('Название сервера')?.trim()
    if (!name || !user) return
    const { data, error } = await supabase.from('servers').insert({ name, owner: user.id }).select().single()
    if (error) { alert(error.message); return }
    if (data) {
      await supabase.from('channels').insert({ server_id: data.id, name: 'общий' })
      await loadServers(data as Server)
    }
  }

  async function createChannel() {
    if (!curServer) return
    const name = prompt('Название канала')?.trim()
    if (!name) return
    const { error } = await supabase.from('channels').insert({ server_id: curServer.id, name })
    if (error) { alert(error.message); return }
    selectServer(curServer)
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
    <div className="app">
      <nav className="servers">
        {servers.map(s => (
          <button key={s.id} className={'srv' + (curServer?.id === s.id ? ' on' : '')}
            title={s.name} onClick={() => selectServer(s)}>{s.name.slice(0, 2).toUpperCase()}</button>
        ))}
        <button className="srv add" title="Создать сервер" onClick={createServer}>＋</button>
      </nav>

      <aside className="channels">
        <div className="srv-title">{curServer?.name ?? 'Нет серверов'}</div>
        <div className="ch-list">
          {channels.map(c => (
            <div key={c.id} className={'ch' + (curChannel?.id === c.id ? ' on' : '')}
              onClick={() => selectChannel(c)}># {c.name}</div>
          ))}
          {curServer && <div className="ch add" onClick={createChannel}>＋ канал</div>}
        </div>
        <div className="me">
          <span className="me-av" style={{ background: colorFor(username) }}>{username.slice(0, 1).toUpperCase()}</span>
          <span className="me-nm">{username}</span>
          <button className="me-out" onClick={() => supabase.auth.signOut()} title="Выйти">⎋</button>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-head"># {curChannel?.name ?? '—'}</header>
        <div className="msgs">
          {messages.map(m => (
            <div key={m.id} className="msg">
              <div className="msg-av" style={{ background: colorFor(m.author_name) }}>{m.author_name.slice(0, 1).toUpperCase()}</div>
              <div className="msg-body">
                <div className="msg-hdr">
                  <b>{m.author_name}</b>
                  <span className="msg-time">{new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
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
    </div>
  )
}
