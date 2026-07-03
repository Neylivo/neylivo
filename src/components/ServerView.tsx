import { toastErr, toastOk } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel, Message } from '../types'
import { MeBar } from './MeBar'
import { AvatarWithStatus } from './AvatarWithStatus'
import { usePresence } from '../lib/presence'
import { notifyMessage } from '../lib/notify'
import { sendPush } from '../lib/push'
import { MiniProfile, MiniProfileData } from './MiniProfile'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { createInvite, listMembers } from '../lib/servers'
import { CallRoom } from './CallRoom'
import { joinRoom, Room } from '../lib/livekit'
import { loadReactions, toggleReaction, groupReactions, setPin, deleteMessage, editMessage } from '../lib/reactions'
import type { RxSummary } from '../lib/reactions'
import { Icon } from './icons'
import { useTyping } from '../lib/typing'

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
  const { statusOf } = usePresence()
  const [mini, setMini] = useState<MiniProfileData | null>(null)
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [showPins, setShowPins] = useState(false)
  const [showMembers, setShowMembers] = useState(() => localStorage.getItem('ponoi_members_open') !== '0')
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string } | null>(null)
  const msgsRef = useRef<Message[]>([])
  const { typers, notifyTyping } = useTyping(curChannel?.id ?? null, username)

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
    loadRx((data ?? []).map(m => m.id))
  }

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('messages:' + curChannel.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => {
          const msg = p.new as Message
          setMessages(m => [...m, msg])
          if (msg.author !== user?.id) notifyMessage(msg.author_name + ' \u2014 #' + curChannel.name, msg.content ?? '')
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => { const msg = p.new as Message; setMessages(m => m.map(x => x.id === msg.id ? msg : x)) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => { msgsRef.current = messages }, [messages])

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('rx:' + curChannel.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' },
        () => loadRx(msgsRef.current.map(m => m.id)))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  async function createChannel() {
    const name = prompt('Название канала')?.trim()
    if (!name) return
    const { error } = await supabase.from('channels').insert({ server_id: server.id, name })
    if (error) return toastErr(error.message)
    loadChannels()
  }

  async function invite() {
    if (!user) return
    const res = await createInvite(server.id, user.id)
    if (res.error) return toastErr(res.error.message)
    try { await navigator.clipboard.writeText(res.code!) } catch {}
    toastOk('Код приглашения скопирован: ' + res.code)
  }

  async function leave() {
    if (!user || isOwner) return
    if (!await confirmUi('Покинуть сервер «' + server.name + '»?', { okText: 'Покинуть' })) return
    await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', user.id)
    onLeft()
  }

  async function startCall() {
    if (!curChannel || !user) return
    try { setCall(await joinRoom('ch_' + curChannel.id, user.id, username)) } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  async function sendMsg(t: string, attach?: { url: string; type: string }) {
    if (!curChannel || !user) return
    const { error } = await supabase.from('messages').insert({
      channel_id: curChannel.id, author: user.id, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
      reply_to: replyTarget?.id ?? null, reply_author: replyTarget?.author ?? null, reply_preview: replyTarget?.preview ?? null,
    })
    if (error) { toastErr(error.message); return }
    setReplyTarget(null)
    const targets = members.map(m => m.user_id).filter(id => id !== user.id)
    sendPush(targets, username + ' \u2014 #' + curChannel.name, t || 'Вложение', '/')
  }

  async function loadRx(ids: string[]) {
    const rows = await loadReactions('reactions', ids)
    setReactions(groupReactions(rows))
  }
  async function react(id: string, emoji: string) {
    if (!user) return
    await toggleReaction('reactions', id, user.id, emoji)
    loadRx(msgsRef.current.map(m => m.id))
  }
  async function pin(id: string, pinned: boolean) {
    await setPin('messages', id, pinned)
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, pinned } as any) : m)))
  }
  async function removeMsg(id: string) {
    if (!await confirmUi('Удалить сообщение?', { okText: 'Удалить' })) return
    await deleteMessage('messages', id)
    setMessages(ms => ms.filter(m => m.id !== id))
  }
  async function editMsg(id: string, content: string) {
    await editMessage('messages', id, content)
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, content, edited: true } as any) : m)))
  }

  return (
    <>
      <aside className="channels">
        <div className="srv-title">
          {server.name}
          <button className="srv-invite" title="Пригласить" onClick={invite}><Icon name="link" size={16} /></button>
        </div>
        <div className="ch-list">
          <div className="ch-sec">Текстовые каналы</div>
          {channels.map(c => (
            <div key={c.id} className={'ch' + (curChannel?.id === c.id ? ' on' : '')}
              onClick={() => selectChannel(c)}># {c.name}</div>
          ))}
          <div className="ch add" onClick={createChannel}><Icon name="plus" size={14} /> канал</div>
          {!isOwner && <div className="ch add" style={{ color: '#ed4245' }} onClick={leave}><Icon name="signout" size={14} /> покинуть сервер</div>}
        </div>
        <MeBar username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} />
      </aside>
      <main className="chat">
        <header className="chat-head"># {curChannel?.name ?? '—'}
          <button className="pin-btn" title="Закреплённые" onClick={() => setShowPins(s => !s)}><Icon name="pin" size={18} /></button>
          <button className="call-start" title="Голосовой звонок" onClick={startCall}><Icon name="phone" size={18} /></button>
          <button className={'pin-btn' + (showMembers ? ' on' : '')} title={showMembers ? 'Скрыть участников' : 'Показать участников'}
            onClick={() => setShowMembers(v => { localStorage.setItem('ponoi_members_open', v ? '0' : '1'); return !v })}><Icon name="users" size={18} /></button>
        </header>
        {showPins && <div className="pins-panel">
          <div className="pins-h"><Icon name="pin" size={15} /> Закреплённые сообщения</div>
          {messages.filter(m => (m as any).pinned).length === 0 && <div className="mut" style={{ padding: 10, fontSize: 13 }}>Нет закреплённых сообщений</div>}
          {messages.filter(m => (m as any).pinned).map(m => (
            <div key={m.id} className="pin-row"><b>{m.author_name}:</b> <span>{m.content}</span>
              <button className="pin-un" title="Открепить" onClick={() => pin(m.id, false)}><Icon name="close" size={14} /></button></div>
          ))}
        </div>}
        {call && <CallRoom room={call} meId={user!.id} meName={username} onLeave={() => setCall(null)} />}
        <div className="msgs">
          <MessageList messages={messages as any} reactions={reactions} currentUser={user?.id} currentUserName={username}
            canPin={m => isOwner || m.author === user?.id} onReact={react} onPin={pin} onDelete={removeMsg}
            onReply={m => setReplyTarget({ id: m.id, author: m.author_name, preview: (m.content || 'вложение').slice(0, 120) })} onEdit={editMsg} />
          <div ref={bottomRef} />
        </div>
        {typers.length > 0 && <div className="typing-ind"><span className="typing-dots"><i/><i/><i/></span>{typers.length >= 3 ? 'Несколько человек печатают…' : typers.join(', ') + (typers.length === 2 ? ' печатают…' : ' печатает…')}</div>}
        {curChannel && <Composer placeholder={'Написать в #' + curChannel.name} onSend={sendMsg}
          mentionables={members.map(m => m.member_name).filter(Boolean)}
          replyingTo={replyTarget ? { author: replyTarget.author, preview: replyTarget.preview } : null}
          onCancelReply={() => setReplyTarget(null)} onType={notifyTyping} />}
      </main>
      {showMembers && <aside className="members">
        {(() => {
          const on = members.filter(m => statusOf(m.user_id) !== 'offline')
          const off = members.filter(m => statusOf(m.user_id) === 'offline')
          const row = (m: any) => (
            <div key={m.user_id} className="member" onClick={e => setMini({
              userId: m.user_id, name: m.member_name, avatarUrl: m.avatar_url, status: statusOf(m.user_id),
              role: m.role, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 220) })}>
              <AvatarWithStatus name={m.member_name} url={m.avatar_url} size={32} status={statusOf(m.user_id)} />
              <span className="me-nm" style={{ color: m.role === 'owner' ? '#faa61a' : undefined }}>{m.member_name}</span>
              {m.role === 'owner' && <span className="mut" title="Владелец"><Icon name="crown" size={14} /></span>}
            </div>
          )
          return <>
            {on.length > 0 && <div className="dm-sec-t">В сети — {on.length}</div>}
            {on.map(row)}
            {off.length > 0 && <div className="dm-sec-t">Не в сети — {off.length}</div>}
            {off.map(row)}
          </>
        })()}
      </aside>}
      {mini && <MiniProfile data={mini} onClose={() => setMini(null)} />}
    </>
  )
}
