import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel, Message } from '../types'
import { MeBar } from './MeBar'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { createInvite, listMembers } from '../lib/servers'
import { CallRoom } from './CallRoom'
import { joinRoom, Room } from '../lib/livekit'

export function ServerView({ server, username, avatarUrl, onAvatar, onLeft }:
  { server: Server; username: string; avatarUrl?: string | null; onAvatar?: (u: string) => void; onLeft: () => void }) {
  const { user } = useAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const [curChannel, setCurChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<any[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const [call, setCall] = useState<Room | null>(null)
  const isOwner = server.owner === user?.id

  useEffect(() => { loadChannels(); loadMembers() /* eslint-disable-next-line */ }, [server.id])

  async function loadMembers() { setMembers(await listMembers(server.id)) }

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

  async function invite() {
    if (!user) return
    const res = await createInvite(server.id, user.id)
    if (res.error) return alert(res.error.message)
    try { await navigator.clipboard.writeText(res.code!) } catch {}
    prompt('Код приглашения скопирован. Отправь его другу:', res.code!)
  }

  async function leave() {
    if (!user || isOwner) return
    if (!confirm('Покинуть сервер?')) return
    await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', user.id)
    onLeft()
  }

  async function startCall() {
    if (!curChannel || !user) return
    try { setCall(await joinRoom('ch_' + curChannel.id, user.id, username)) } catch (e: any) { alert(e.message ?? String(e)) }
  }

  async function sendMsg(t: string, attach?: { url: string; type: string }) {
    if (!curChannel || !user) return
    const { error } = await supabase.from('messages').insert({
      channel_id: curChannel.id, author: user.id, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
    })
    if (error) alert(error.message)
  }

  return (
    <>
      <aside className="channels">
        <div className="srv-title">
          {server.name}
          <button className="srv-invite" title="Пригласить" onClick={invite}>🔗</button>
        </div>
        <div className="ch-list">
          <div className="ch-sec">Текстовые каналы</div>
          {channels.map(c => (
            <div key={c.id} className={'ch' + (curChannel?.id === c.id ? ' on' : '')}
              onClick={() => selectChannel(c)}># {c.name}</div>
          ))}
          <div className="ch add" onClick={createChannel}>＋ канал</div>
          <div className="dm-sec-t">Участники — {members.length}</div>
          {members.map(m => (
            <div key={m.user_id} className="dm-item">
              <Avatar name={m.member_name} url={m.avatar_url} size={32} />
              <span className="me-nm">{m.member_name}</span>
              {m.role === 'owner' && <span className="mut" title="Владелец">👑</span>}
            </div>
          ))}
          {!isOwner && <div className="ch add" style={{ color: '#ed4245' }} onClick={leave}>⎋ покинуть сервер</div>}
        </div>
        <MeBar username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} />
      </aside>
      <main className="chat">
        <header className="chat-head"># {curChannel?.name ?? '—'}<button className="call-start" title="Голосовой звонок" onClick={startCall}>📞</button></header>
        {call && <CallRoom room={call} onLeave={() => setCall(null)} />}
        <div className="msgs">
          <MessageList messages={messages as any} />
          <div ref={bottomRef} />
        </div>
        {curChannel && <Composer placeholder={'Написать в #' + curChannel.name} onSend={sendMsg} />}
      </main>
    </>
  )
}
