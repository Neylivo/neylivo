import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { FriendRequest, DMMessage, Profile } from '../types'
import { searchUsers, sendRequest, respondRequest, openThread, findByCode } from '../lib/friends'
import { friendCode, tagFor } from '../lib/friendCode'
import { MeBar } from './MeBar'
import { Avatar } from './Avatar'
import { AvatarWithStatus } from './AvatarWithStatus'
import { usePresence, STATUS_LABEL } from '../lib/presence'
import { notifyMessage } from '../lib/notify'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { CallRoom } from './CallRoom'
import { joinRoom, Room } from '../lib/livekit'
import { loadReactions, toggleReaction, groupReactions, setPin, deleteMessage } from '../lib/reactions'
import type { RxSummary } from '../lib/reactions'

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
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [showPins, setShowPins] = useState(false)
  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'add'>('online')
  const [ffilter, setFfilter] = useState('')
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [codeMsg, setCodeMsg] = useState('')
  const { statusOf } = usePresence()
  const msgsRef = useRef<DMMessage[]>([])

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

  async function addByCode() {
    const p = await findByCode(code)
    if (!p) { setCodeMsg('Пользователь с таким кодом не найден'); return }
    if (p.id === meId) { setCodeMsg('Это твой собственный код :)'); return }
    const { error } = await sendRequest(meId, username, p)
    if (error) setCodeMsg(error.message)
    else { setCode(''); setCodeMsg('Заявка отправлена ' + friendCode(p.username, p.id)) }
  }

  async function openChat(f: Friend) {
    setActive(f)
    const t = await openThread(meId, f.id)
    if (!t) return
    setThreadId(t.id)
    const { data } = await supabase.from('dm_messages').select('*')
      .eq('thread_id', t.id).order('created_at').limit(100)
    setMessages((data ?? []) as DMMessage[])
    loadRx(((data ?? []) as DMMessage[]).map(m => m.id))
  }

  useEffect(() => {
    if (!threadId) return
    const ch = supabase.channel('dm:' + threadId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: 'thread_id=eq.' + threadId },
        p => {
          const msg = p.new as DMMessage
          setMessages(m => [...m, msg])
          if (msg.author !== meId) notifyMessage(msg.author_name, msg.content ?? '')
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [threadId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => { msgsRef.current = messages }, [messages])

  useEffect(() => {
    if (!threadId) return
    const ch = supabase.channel('drx:' + threadId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_reactions' },
        () => loadRx(msgsRef.current.map(m => m.id)))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [threadId])

  async function sendMsg(t: string, attach?: { url: string; type: string }) {
    if (!threadId) return
    const { error } = await supabase.from('dm_messages').insert({
      thread_id: threadId, author: meId, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
    })
    if (error) alert(error.message)
  }

  async function loadRx(ids: string[]) {
    const rows = await loadReactions('dm_reactions', ids)
    setReactions(groupReactions(rows))
  }
  async function react(id: string, emoji: string) {
    await toggleReaction('dm_reactions', id, meId, emoji)
    loadRx(msgsRef.current.map(m => m.id))
  }
  async function pin(id: string, pinned: boolean) {
    await setPin('dm_messages', id, pinned)
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, pinned } as any) : m)))
  }
  async function removeMsg(id: string) {
    if (!confirm('Удалить сообщение?')) return
    await deleteMessage('dm_messages', id)
    setMessages(ms => ms.filter(m => m.id !== id))
  }

  return (
    <>
      <aside className="dm-side">
        <div className="dm-friends-nav" onClick={() => setActive(null)}>👥 Друзья</div>
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
          <header className="chat-head">@ {active.name}
            <button className="pin-btn" title="Закреплённые" onClick={() => setShowPins(s => !s)}>📌</button>
            <button className="call-start" title="Позвонить" onClick={startCall}>📞</button>
          </header>
          {showPins && <div className="pins-panel">
            <div className="pins-h">📌 Закреплённые сообщения</div>
            {messages.filter(m => (m as any).pinned).length === 0 && <div className="mut" style={{ padding: 10, fontSize: 13 }}>Нет закреплённых сообщений</div>}
            {messages.filter(m => (m as any).pinned).map(m => (
              <div key={m.id} className="pin-row"><b>{m.author_name}:</b> <span>{m.content}</span>
                <button className="pin-un" title="Открепить" onClick={() => pin(m.id, false)}>✕</button></div>
            ))}
          </div>}
          {call && <CallRoom room={call} onLeave={() => setCall(null)} />}
          <div className="msgs">
            <MessageList messages={messages as any} reactions={reactions} currentUser={meId}
              canPin={() => true} onReact={react} onPin={pin} onDelete={removeMsg} />
            <div ref={bottomRef} />
          </div>
          <Composer placeholder={'Написать @' + active.name} onSend={sendMsg} />
        </> : <>
          <header className="chat-head pfr-head">
            <span className="pfr-title">👥 Друзья</span>
            <div className="pfr-tabs">
              <button className={'pfr-tab' + (tab === 'online' ? ' on' : '')} onClick={() => setTab('online')}>В сети</button>
              <button className={'pfr-tab' + (tab === 'all' ? ' on' : '')} onClick={() => setTab('all')}>Все</button>
              <button className={'pfr-tab' + (tab === 'pending' ? ' on' : '')} onClick={() => setTab('pending')}>Ожидание{requests.length > 0 ? ' — ' + requests.length : ''}</button>
            </div>
            <button className={'pfr-addfriend' + (tab === 'add' ? ' on' : '')} onClick={() => setTab('add')}>Добавить в друзья</button>
          </header>
          <div className="pfr-main">
          <div className="pfr-body">
            {tab === 'add' ? <div className="pfr-addbox">
              <div className="pfr-addh">Добавить в друзья</div>
              <div className="pfr-codebox">
                <div className="pfr-codeh">Мой код друга</div>
                <div className="pfr-coderow">
                  <span className="pfr-code">{friendCode(username, meId)}</span>
                  <span className="pfr-codehint">поделись им</span>
                  <button className="pfr-copy" onClick={() => { navigator.clipboard?.writeText(friendCode(username, meId)); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>{copied ? 'Скопировано \u2713' : 'Копировать'}</button>
                </div>
                <div className="pfr-codeh2">Добавить в друзья по коду</div>
                <div className="pfr-addcoderow">
                  <input className="pfr-addin" placeholder="Введи код друга (например, Сергей#4242)" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addByCode() }} />
                  <button className="pfr-addbtn2" onClick={addByCode}>Добавить</button>
                </div>
                {codeMsg && <div className="pfr-codemsg">{codeMsg}</div>}
              </div>
              <div className="pfr-addsub">Найди друзей по имени пользователя.</div>
              <input className="pfr-addin" placeholder="Введи имя пользователя…" value={q} onChange={e => doSearch(e.target.value)} />
              {results.map(p => (
                <div key={p.id} className="pfr-row" onClick={() => add(p)}>
                  <Avatar name={p.username} url={p.avatar_url} size={32} />
                  <span className="pfr-name">{p.username}</span>
                  <span className="pfr-add-btn">＋ Добавить</span>
                </div>
              ))}
            </div>
            : tab === 'pending' ? <>
              <div className="pfr-sec">Ожидание — {requests.length}</div>
              {requests.length === 0 && <div className="pfr-empty">Нет входящих заявок</div>}
              {requests.map(r => (
                <div key={r.id} className="pfr-row">
                  <Avatar name={r.from_name} size={32} />
                  <span className="pfr-name">{r.from_name}</span>
                  <button className="pfr-ok" title="Принять" onClick={() => respondRequest(r.id, true).then(loadRequests)}>✓</button>
                  <button className="pfr-no" title="Отклонить" onClick={() => respondRequest(r.id, false).then(loadRequests)}>✕</button>
                </div>
              ))}
            </>
            : (() => {
                const base = tab === 'online' ? friends.filter(f => statusOf(f.id) !== 'offline') : friends
                const list = ffilter ? base.filter(f => f.name.toLowerCase().includes(ffilter.toLowerCase())) : base
                return <>
                  <div className="pfr-search"><input placeholder="Поиск" value={ffilter} onChange={e => setFfilter(e.target.value)} /></div>
                  <div className="pfr-sec">{tab === 'online' ? 'В сети' : 'Все друзья'} — {list.length}</div>
                  {list.length === 0 && <div className="pfr-empty">{tab === 'online' ? 'Сейчас никого нет в сети' : 'Пока нет друзей. Добавь кого-нибудь во вкладке «Добавить в друзья».'}</div>}
                  {list.map(f => (
                    <div key={f.id} className="pfr-row" onClick={() => openChat(f)}>
                      <AvatarWithStatus name={f.name} size={32} status={statusOf(f.id)} />
                      <span className="pfr-name">{f.name}</span>
                      <span className="pfr-status">{STATUS_LABEL[statusOf(f.id)]}</span>
                      <span className="pfr-msg" title="Написать">💬</span>
                    </div>
                  ))}
                </>
              })()}
          </div>
          <aside className="pfr-right">
            <div className="pfr-right-h">Активные контакты</div>
            {(() => {
              const activeContacts = friends.filter(f => statusOf(f.id) !== 'offline')
              if (activeContacts.length === 0) return <div className="pfr-actempty">Нет активных контактов</div>
              return activeContacts.map(f => (
                <div key={f.id} className="pfr-actcard" onClick={() => openChat(f)} style={{ cursor: 'pointer' }}>
                  <div className="pfr-actnm">{f.name}</div>
                  <div className="pfr-actsub">{STATUS_LABEL[statusOf(f.id)]}</div>
                </div>
              ))
            })()}
          </aside>
          </div>
        </>}
      </main>
    </>
  )
}
