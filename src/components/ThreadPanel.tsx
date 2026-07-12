// v1.268.0: сама ветка — открытая лента её сообщений + композер. Пока «Ветки»
// (thr-panel в ServerView.tsx) был заглушкой, этого компонента не существовало.
// Сообщения ветки — обычные строки messages (thread_id вместо null), поэтому
// закреп/реакции/правка/вложения работают через те же функции reactions.ts,
// что и у обычного канала — ничего не дублируем.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import type { Server, Channel, Message } from '../types'
import type { Thread } from '../lib/threads'
import { loadReactions, toggleReaction, groupReactions, setPin, deleteMessage, editMessage, updateAttachment, type RxSummary } from '../lib/reactions'
import { uploadWithProgress } from '../lib/storage'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { Icon } from './icons'

export function ThreadPanel({ server, channel, thread, user, username, onClose, canManageMessages, canAttachFiles, automodCheck }: {
  server: Server; channel: Channel; thread: Thread
  user: { id: string }; username: string
  onClose: () => void
  canManageMessages: boolean
  canAttachFiles?: boolean
  automodCheck?: (text: string) => string | null
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string; avatarUrl?: string | null } | null>(null)
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null)
  const msgsRef = useRef<Message[]>([])
  useEffect(() => { msgsRef.current = messages }, [messages])
  const boxRef = useRef<HTMLDivElement>(null)

  async function loadRx(ids: string[]) {
    const rows = await loadReactions('reactions', ids)
    setReactions(groupReactions(rows))
  }

  useEffect(() => {
    let ok = true
    supabase.from('messages').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true }).limit(300)
      .then(({ data }) => {
        if (!ok) return
        const list = (data ?? []) as Message[]
        setMessages(list)
        loadRx(list.map(m => m.id))
        requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })
      })
    const ch = supabase.channel('thread:' + thread.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'thread_id=eq.' + thread.id },
        p => {
          const msg = p.new as Message
          setMessages(m => {
            if (m.some(x => x.id === msg.id)) return m
            if (msg.author === user.id) {
              const ti = m.findIndex(x => (x as any)._tmp && x.content === msg.content)
              if (ti >= 0) { const c = m.slice(); c[ti] = { ...msg, _localId: (m[ti] as any)._localId ?? m[ti].id } as any; return c }
            }
            return [...m, msg]
          })
          const el = boxRef.current
          if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'thread_id=eq.' + thread.id },
        p => { const msg = p.new as Message; setMessages(m => m.map(x => x.id === msg.id ? { ...msg, _localId: (x as any)._localId } as any : x)) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' },
        () => loadRx(msgsRef.current.map(m => m.id)))
      .subscribe()
    return () => { ok = false; supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id])

  async function sendMsg(t: string, attach?: { url: string; type: string }, files?: File[]) {
    const tmpId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    const row = {
      channel_id: channel.id, thread_id: thread.id, author: user.id, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
      reply_to: replyTarget?.id ?? null, reply_author: replyTarget?.author ?? null, reply_preview: replyTarget?.preview ?? null,
    }
    const uploading = !!files?.length
    setMessages(m => [...m, { ...row, id: tmpId, created_at: new Date().toISOString(), _tmp: true,
      ...(uploading ? { _uploading: true, _uploadNames: files!.map(f => f.name) } : {}) } as any])
    setReplyTarget(null)
    requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })

    function finalize(finalRow: typeof row) {
      supabase.from('messages').insert(finalRow).select().single().then(({ data, error }) => {
        if (error || !data) { setMessages(m => m.filter(x => x.id !== tmpId)); toastErr(error?.message ?? 'Не удалось отправить сообщение'); return }
        const real = data as Message
        setMessages(m => m.some(x => x.id === real.id) ? m.filter(x => x.id !== tmpId) : m.map(x => x.id === tmpId ? { ...real, _localId: tmpId } as any : x))
      })
    }
    if (!uploading) { finalize(row); return }
    try {
      const spoilerFlags = attach!.url.split('\n').map(u => u.includes('#spoiler'))
      const realUrls: string[] = []
      for (let i = 0; i < files!.length; i++) {
        let url = await uploadWithProgress('attachments', user.id, files![i], p => {
          setMessages(m => m.map(x => x.id === tmpId ? { ...x, _upProgress: (i + p) / files!.length } as any : x))
        })
        if (spoilerFlags[i]) url += '#spoiler'
        realUrls.push(url)
      }
      attach!.url.split('\n').forEach(u => { const b = u.replace('#spoiler', ''); if (b.startsWith('blob:')) URL.revokeObjectURL(b) })
      finalize({ ...row, attach_url: realUrls.join('\n') })
    } catch (err: any) {
      setMessages(m => m.filter(x => x.id !== tmpId))
      toastErr(err.message ?? 'Не удалось загрузить файл')
    }
  }

  async function react(id: string, emoji: string) { await toggleReaction('reactions', id, user.id, emoji); loadRx(msgsRef.current.map(m => m.id)) }
  async function pin(id: string, pinned: boolean) {
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, pinned } as any) : m)))
    const ok = await setPin('messages', id, pinned)
    if (!ok) { setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, pinned: !pinned } as any) : m))); toastErr('Не удалось изменить закреп') }
  }
  async function removeMsg(id: string) {
    if (!await confirmUi('Удалить сообщение?', { okText: 'Удалить' })) return
    setMessages(ms => ms.filter(m => m.id !== id))
    deleteMessage('messages', id)
  }
  async function editMsg(id: string, content: string) {
    const prev = msgsRef.current.find(m => m.id === id)
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, content, edited: true } as any) : m)))
    const ok = await editMessage('messages', id, content)
    if (!ok) { if (prev) setMessages(ms => ms.map(m => (m.id === id ? prev : m))); toastErr('Не удалось сохранить правку') }
  }
  async function saveEditedMsg(text: string) {
    if (!editingMsg) return
    const id = editingMsg.id; const t = text.trim()
    setEditingMsg(null)
    if (t) await editMsg(id, t); else await removeMsg(id)
  }
  async function editAttachment(messageId: string, index: number, patch: { spoiler?: boolean; name?: string; desc?: string }) {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    try {
      const res = await updateAttachment('messages', msg as any, index, patch)
      if (res) setMessages(ms => ms.map(m => (m.id === messageId ? ({ ...m, attach_url: res.attach_url, attach_meta: res.attach_meta } as any) : m)))
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  return (
    <div className="thread-view">
      <div className="thread-view-head">
        <div className="thread-view-t"><Icon name="threads" size={16} /> {thread.name}</div>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="thread-view-sub">Начал(а): {thread.created_by_name}</div>
      <div className="thread-view-msgs" ref={boxRef}>
        <MessageList messages={messages} reactions={reactions} currentUser={user.id} currentUserName={username}
          canDelete={m => canManageMessages || m.author === user.id} canPin={() => canManageMessages}
          onReact={react} onPin={pin} onDelete={removeMsg}
          onReply={m => { setReplyTarget({ id: m.id, author: m.author_name, preview: (m.content || 'вложение').slice(0, 120), avatarUrl: m.author_avatar }); setEditingMsg(null) }}
          onStartEdit={m => { setEditingMsg({ id: m.id, content: m.content ?? '' }); setReplyTarget(null) }} editingId={editingMsg?.id ?? null}
          onEditAttachment={editAttachment} />
      </div>
      <Composer placeholder={'Написать в ветке'} onSend={sendMsg} draftKey={'thread_' + thread.id}
        serverId={server.id} channelId={channel.id} canAttachFiles={canAttachFiles} automodCheck={automodCheck}
        replyingTo={replyTarget ? { author: replyTarget.author, preview: replyTarget.preview, avatarUrl: replyTarget.avatarUrl } : null}
        onCancelReply={() => setReplyTarget(null)}
        editingTarget={editingMsg} onSaveEdit={saveEditedMsg} onCancelEdit={() => setEditingMsg(null)} />
    </div>
  )
}
