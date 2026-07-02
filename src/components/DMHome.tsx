import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { FriendRequest, DMMessage, Profile } from '../types'
import { timeShort } from '../lib/ui'
import { searchUsers, sendRequest, respondRequest, openThread } from '../lib/friends'
import { MeBar } from './MeBar'
import { Avatar } from './Avatar'
import { Composer, Attachment } from './Composer'
import { CallRoom } from './CallRoom'
import { joinRoom, Room } from '../lib/livekit'

interface Friend { id: string; name: string }

export function DMHome({ username, avatarUrl, onAvatar }:
  { username: string; avatarUrl?: string | null; onAvatar?: (u: string) => void }) {
  const { user } = useAuth()
  const meId = user!.id
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [active, setActive] = useState<Friend | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DMMessage[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const [call, setCall] = useState<Room | null>(null)

  async function startCall() {
    if (!threadId) return
    try { setCall(await joinRoom('dm_' + threadId, meId, username)) } catch (e: any) { alert(e.message ?? String(e)) }
  }

  useEffect(() => { loadRequests() /* eslint-disable-next-line */ }, [])

  useEffect(() => {
    const ch = supabase.channel('fr:' + meId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => loadRequests())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [])

  async function loadRequests() {
    const { data } = await supabase.from('friend_requests').select('*')
      .or('from_user.eq.' + meId + ',to_user.eq.' + meId)
    const all = (data ?? []) as FriendRequest[]
    setRequests(all.filter(r => r.status === 'pending' && r.to_user === meId))
    const fr: Friend[] = all.filter(r => r.status === 'accepted').map(r =>
      r.from_user === meId ? { id: r.to_user, name: r.to_name } : { id: r.from_user, name: r.from_name })
    setFriends(fr)
  }

  async function doSearch(v: string) { setQ(v); setResults(await searchUsers(v, meId)) }

  async function add(p: Profile) {
    const { error } = await sendRequest(meId, username, p)
    if (error) alert(error.message); else { setQ(''); setResults([]); alert('Заявка отправлена ' + p.username) }
  }

  async function openChat(f: Friend) {
    setActive(f)
    const t = await openThread(meId, f.id)
    if (!t) return
    setThreadId(t.id)
    const { data } = await supabase.from('dm_messages').select('*')
      .eq('thread_id', t.id).order('created_at').limit(100)
    setMessages((data ?? []) as DMMessage[])
  }

  useEffect(() => {
    if (!threadId) return
    const ch = supabase.channel('dm:' + threadId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: 'thread_id=eq.' + threadId },
        p => setMessages(m => [...m, p.new as DMMessage]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [threadId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function sendMsg(t: string, attach?: { url: string; type: string }) {
    if (!threadId) return
    const { error } = await supabase.from('dm_messages').insert({
      thread_id: threadId, author: meId, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
    })
    if (error) alert(error.message)
  }

  return (
    <>
      <aside className="dm-side">
        <div className="dm-side-top">
          <div className="addfriend">
            <input placeholder="Найти по имени…" value={q} onChange={e => doSearch(e.target.value)} />
          </div>
          {results.map(p => (
            <div key={p.id} className="dm-item" onClick={() => add(p)}>
              <Avatar name={p.username} url={p.avatar_url} size={32} />
              <span className="me-nm">{p.username}</span><span className="mut">＋</span>
            </div>
          ))}
        </div>

        {requests.length > 0 && <>
          <div className="dm-sec-t">Заявки в друзья — {requests.length}</div>
          {requests.map(r => (
            <div key={r.id} className="req">
              <Avatar name={r.from_name} size={32} />
              <span className="nm">{r.from_name}</span>
              <button className="ok" title="Принять" onClick={() => respondRequest(r.id, true).then(loadRequests)}>✓</button>
              <button className="no" title="Отклонить" onClick={() => respondRequest(r.id, false).then(loadRequests)}>✕</button>
            </div>
          ))}
        </>}

        <div className="dm-sec-t">Личные сообщения</div>
        <div className="ch-list">
          {friends.map(f => (
            <div key={f.id} className={'dm-item' + (active?.id === f.id ? ' on' : '')} onClick={() => openChat(f)}>
              <Avatar name={f.name} size={32} />
              <span className="me-nm">{f.name}</span>
            </div>
          ))}
          {friends.length === 0 && <div className="mut" style={{ padding: '6px 12px', fontSize: 13 }}>Пока нет друзей. Найди кого-нибудь выше.</div>}
        </div>
        <MeBar username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} />
      </aside>

      <main className="chat">
        {active ? <>
          <header className="chat-head">@ {active.name}<button className="call-start" title="Позвонить" onClick={startCall}>📞</button></header>
          {call && <CallRoom room={call} onLeave={() => setCall(null)} />}
          <div className="msgs">
            {messages.map(m => (
              <div key={m.id} className="msg">
                <Avatar name={m.author_name} size={40} />
                <div className="msg-body">
                  <div className="msg-hdr"><b>{m.author_name}</b><span className="msg-time">{timeShort(m.created_at)}</span></div>
                  {m.content && <div className="msg-txt">{m.content}</div>}
                  <Attachment url={(m as any).attach_url} type={(m as any).attach_type} />
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <Composer placeholder={'Написать @' + active.name} onSend={sendMsg} />
        </> : <div className="dm-empty">Выбери друга слева, чтобы начать переписку 💬</div>}
      </main>
    </>
  )
}
