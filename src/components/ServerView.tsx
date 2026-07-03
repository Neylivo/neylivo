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
import { notifModeOf } from '../lib/srvNotify'
import { mentionsUser } from '../lib/md'
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
import { SearchPanel } from './SearchPanel'
import { useTyping } from '../lib/typing'
import { TypingIndicator } from './TypingIndicator'

export function ServerView({ server, username, avatarUrl, onAvatar, onLeft }:
  { server: Server; username: string; avatarUrl?: string | null; onAvatar?: (u: string) => void; onLeft: () => void }) {
  const { user } = useAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const [curChannel, setCurChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<any[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgsBoxRef = useRef<HTMLDivElement>(null)
  const prevLen = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [call, setCall] = useState<Room | null>(null)
  const isOwner = server.owner === user?.id
  const { statusOf } = usePresence()
  const [mini, setMini] = useState<MiniProfileData | null>(null)
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [showPins, setShowPins] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showMembers, setShowMembers] = useState(() => localStorage.getItem('ponoi_members_open') !== '0')
  const [catOpen, setCatOpen] = useState(() => localStorage.getItem('ponoi_cat_text_open') !== '0')
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string } | null>(null)
  const [newDividerId, setNewDividerId] = useState<string | null>(null)
  // Подсветка каналов с непрочитанными сообщениями (как в Discord).
  const [unreadCh, setUnreadCh] = useState<Record<string, boolean>>({})
  const curChannelRef = useRef<Channel | null>(null)
  // Память прокрутки по каналам + подгрузка старых сообщений при скролле вверх.
  const scrollMem = useRef<Record<string, number>>({})
  const pendingScroll = useRef<number | 'bottom' | null>(null)
  const loadingOlder = useRef(false)
  const hasMore = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const prevTop = useRef(0)
  const msgsRef = useRef<Message[]>([])
  const { typers, notifyTyping } = useTyping(curChannel?.id ?? null, username)

  useEffect(() => { loadChannels(); loadMembers() /* eslint-disable-next-line */ }, [server.id])

  async function loadMembers() { setMembers(await listMembers(server.id)) }

  async function loadChannels() {
    const { data } = await supabase.from('channels').select('*').eq('server_id', server.id).order('name')
    const list = data ?? []
    setChannels(list)
    if (list.length) selectChannel(list[0]); else { setCurChannel(null); setMessages([]) }
    refreshUnread(list)
  }

  // Начальное вычисление непрочитанных: берём последнее сообщение каждого канала.
  async function refreshUnread(list: Channel[]) {
    if (!list.length) return
    const { data } = await supabase.from('messages').select('channel_id, author, created_at')
      .in('channel_id', list.map(c => c.id)).order('created_at', { ascending: false }).limit(200)
    const seen = new Set<string>()
    const un: Record<string, boolean> = {}
    for (const m of (data ?? []) as any[]) {
      if (seen.has(m.channel_id)) continue
      seen.add(m.channel_id)
      const lastRead = Number(localStorage.getItem('ponoi_lastread_' + m.channel_id) ?? 0)
      if (m.author !== user?.id && new Date(m.created_at).getTime() > lastRead) un[m.channel_id] = true
    }
    setUnreadCh(un)
  }

  async function selectChannel(c: Channel) {
    setCurChannel(c)
    // Сброс случайного выделения текста при переключении канала.
    window.getSelection()?.removeAllRanges()
    setUnreadCh(u => { if (!u[c.id]) return u; const n = { ...u }; delete n[c.id]; return n })
    // Загружаем последние 100 сообщений (раньше в длинных каналах грузились самые старые 100).
    const { data } = await supabase.from('messages').select('*')
      .eq('channel_id', c.id).order('created_at', { ascending: false }).limit(100)
    const list = (data ?? []).reverse()
    hasMore.current = (data ?? []).length === 100
    pendingScroll.current = scrollMem.current[c.id] ?? 'bottom'
    setMessages(list)
    // Разделитель «НОВОЕ»: первое чужое сообщение после последнего визита в канал.
    const lastRead = Number(localStorage.getItem('ponoi_lastread_' + c.id) ?? 0)
    const firstNew = lastRead ? list.find(m => m.author !== user?.id && new Date(m.created_at).getTime() > lastRead) : undefined
    setNewDividerId(firstNew?.id ?? null)
    localStorage.setItem('ponoi_lastread_' + c.id, String(Date.now()))
    loadRx(list.map(m => m.id))
  }

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('messages:' + curChannel.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => {
          const msg = p.new as Message
          setMessages(m => [...m, msg])
          localStorage.setItem('ponoi_lastread_' + curChannel.id, String(Date.now()))
          if (msg.author !== user?.id) {
            const mode = notifModeOf(server.id)
            const mentioned = !!msg.content && mentionsUser(msg.content, username)
            if (mode === 'all' || (mode === 'mentions' && mentioned))
              notifyMessage(msg.author_name + ' \u2014 #' + curChannel.name, msg.content ?? '')
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => { const msg = p.new as Message; setMessages(m => m.map(x => x.id === msg.id ? msg : x)) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  useEffect(() => {
    const el = msgsBoxRef.current
    if (el && prevHeight.current !== null) {
      // Подгрузили старые сообщения — сохраняем видимую позицию без прыжка.
      el.scrollTop = prevTop.current + (el.scrollHeight - prevHeight.current)
      prevHeight.current = null
    } else if (el && pendingScroll.current !== null) {
      // Восстановление сохранённой позиции прокрутки при входе в канал.
      el.scrollTop = pendingScroll.current === 'bottom' ? el.scrollHeight : pendingScroll.current
      pendingScroll.current = null
      setUnseen(0); setAtBottom(nearBottom())
    } else if (nearBottom()) { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setUnseen(0) }
    else setUnseen(u => u + Math.max(0, messages.length - prevLen.current))
    prevLen.current = messages.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // «К последним ↓»: автоскролл только если пользователь у низа; иначе копим счётчик.
  function nearBottom(): boolean {
    const el = msgsBoxRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  function onMsgsScroll() {
    const el = msgsBoxRef.current
    if (el && curChannel) scrollMem.current[curChannel.id] = el.scrollTop
    if (el && el.scrollTop < 60) loadOlder()
    const nb = nearBottom()
    setAtBottom(nb)
    if (nb) setUnseen(0)
  }

  // Динамическая подгрузка старых сообщений небольшими порциями при прокрутке вверх.
  async function loadOlder() {
    const el = msgsBoxRef.current
    if (!curChannel || !el || loadingOlder.current || !hasMore.current || msgsRef.current.length === 0) return
    loadingOlder.current = true
    try {
      const oldest = msgsRef.current[0].created_at
      const { data } = await supabase.from('messages').select('*')
        .eq('channel_id', curChannel.id).lt('created_at', oldest)
        .order('created_at', { ascending: false }).limit(50)
      const older = ((data ?? []) as Message[]).reverse()
      hasMore.current = older.length === 50
      if (older.length) {
        prevHeight.current = el.scrollHeight
        prevTop.current = el.scrollTop
        setMessages(m => [...older, ...m])
        loadRx([...older.map(o => o.id), ...msgsRef.current.map(m => m.id)])
      }
    } finally { loadingOlder.current = false }
  }
  function jumpDown() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setUnseen(0); setAtBottom(true)
  }

  useEffect(() => { msgsRef.current = messages }, [messages])
  useEffect(() => { curChannelRef.current = curChannel }, [curChannel])

  // Реалтайм: новое сообщение в другом канале этого сервера зажигает подсветку.
  useEffect(() => {
    if (!channels.length) return
    const ids = new Set(channels.map(c => c.id))
    const ch = supabase.channel('srv-unread:' + server.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        p => {
          const msg = p.new as Message
          if (!ids.has(msg.channel_id) || msg.author === user?.id) return
          if (curChannelRef.current?.id === msg.channel_id) return
          setUnreadCh(u => u[msg.channel_id] ? u : { ...u, [msg.channel_id]: true })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels])

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
          <div className="ch-sec clickable" title={catOpen ? 'Свернуть категорию' : 'Развернуть категорию'}
            onClick={() => setCatOpen(v => { localStorage.setItem('ponoi_cat_text_open', v ? '0' : '1'); return !v })}>
            <span className={'ch-caret' + (catOpen ? ' open' : '')}>▶</span>Текстовые каналы</div>
          {channels.filter(c => catOpen || curChannel?.id === c.id).map(c => (
            <div key={c.id} className={'ch' + (curChannel?.id === c.id ? ' on' : '') + (unreadCh[c.id] ? ' unread' : '')}
              onClick={() => selectChannel(c)}># {c.name}</div>
          ))}
          <div className="ch add" onClick={createChannel}><Icon name="plus" size={14} /> канал</div>
          {!isOwner && <div className="ch add" style={{ color: '#ed4245' }} onClick={leave}><Icon name="signout" size={14} /> покинуть сервер</div>}
        </div>
        <MeBar username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} />
      </aside>
      <main className="chat">
        <header className="chat-head"># {curChannel?.name ?? '—'}
          <button className={'pin-btn' + (showSearch ? ' on' : '')} title="Поиск сообщений" onClick={() => setShowSearch(s => !s)}><Icon name="search" size={18} /></button>
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
        {showSearch && <SearchPanel onClose={() => setShowSearch(false)} scope={{
          table: 'messages', channelIds: channels.map(c => c.id),
          channelName: id => channels.find(c => c.id === id)?.name ?? '?',
        }} />}
        {call && <CallRoom room={call} meId={user!.id} meName={username} onLeave={() => setCall(null)} />}
        <div className="msgs" ref={msgsBoxRef} onScroll={onMsgsScroll}>
          <MessageList messages={messages as any} reactions={reactions} currentUser={user?.id} currentUserName={username} newDividerId={newDividerId}
            canPin={m => isOwner || m.author === user?.id} onReact={react} onPin={pin} onDelete={removeMsg}
            onReply={m => setReplyTarget({ id: m.id, author: m.author_name, preview: (m.content || 'вложение').slice(0, 120) })} onEdit={editMsg}
            onProfile={(m, x, y) => { const mm = members.find(z => z.user_id === m.author)
              setMini({ userId: m.author, name: m.author_name, avatarUrl: mm?.avatar_url ?? null, status: statusOf(m.author), role: mm?.role, x, y }) }} />
          {!atBottom && <button className="jump-down" onClick={jumpDown}>
            {unseen > 0 ? `Новых сообщений: ${unseen}` : 'К последним'} <Icon name="chevron-down" size={14} />
          </button>}
          <div ref={bottomRef} />
        </div>
        <TypingIndicator typers={typers} />
        {curChannel && <Composer placeholder={'Написать в #' + curChannel.name} onSend={sendMsg} draftKey={curChannel.id}
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
