import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openThread } from '../lib/friends'
import { myServers } from '../lib/servers'
import { fwdMark, parseFwd } from '../lib/fwd'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import type { Server, Channel } from '../types'

// Источник пересылки — совместим с UiMessage из MessageList.
export interface FwdSource {
  content?: string | null
  attach_url?: string | null
  attach_type?: string | null
  author_name: string
  created_at: string
}

type Target =
  | { key: string; kind: 'dm'; id: string; name: string }
  | { key: string; kind: 'ch'; id: string; name: string; server: string }

// Модалка «Переслать сообщение» (как в Discord): поиск, мульти-выбор среди
// ЛС и каналов серверов, необязательный комментарий отдельным сообщением.
export function ForwardModal({ src, meId, meName, onClose }:
  { src: FwdSource; meId: string; meName: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [friends, setFriends] = useState<{ id: string; name: string }[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [sel, setSel] = useState<Record<string, Target>>({})
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  useEffect(() => { (async () => {
    // Друзья: принятые заявки в обе стороны (как в DMHome).
    const { data } = await supabase.from('friend_requests').select('*')
      .eq('status', 'accepted').or('from_user.eq.' + meId + ',to_user.eq.' + meId)
    const seen = new Set<string>()
    const fs: { id: string; name: string }[] = []
    for (const r of (data ?? []) as any[]) {
      const f = r.from_user === meId ? { id: r.to_user, name: r.to_name } : { id: r.from_user, name: r.from_name }
      if (!seen.has(f.id)) { seen.add(f.id); fs.push(f) }
    }
    setFriends(fs)
    const srv = await myServers()
    setServers(srv)
    if (srv.length) {
      const { data: chs } = await supabase.from('channels').select('*').in('server_id', srv.map(s => s.id))
      setChannels((chs ?? []) as Channel[])
    }
  })() }, [meId])

  const term = q.trim().toLowerCase()
  const fFriends = useMemo(() => friends.filter(f => !term || f.name.toLowerCase().includes(term)), [friends, term])
  const fChannels = useMemo(() => channels.filter(c => {
    if (!term) return true
    const s = servers.find(x => x.id === c.server_id)
    return c.name.toLowerCase().includes(term) || (s?.name.toLowerCase().includes(term) ?? false)
  }), [channels, servers, term])

  function toggle(t: Target) {
    setSel(s => { const n = { ...s }; if (n[t.key]) delete n[t.key]; else n[t.key] = t; return n })
  }

  const count = Object.keys(sel).length
  // Пересылаем всегда оригинал: если сообщение само было пересылкой — берём исходник.
  const inner = parseFwd(src.content)
  const prevText = (inner ? inner.text : src.content) || (src.attach_url ? 'Вложение' : '')
  const origAuthor = inner ? inner.author : src.author_name

  async function send() {
    if (!count || busy) return
    setBusy(true)
    const text = fwdMark(inner ? inner.author : src.author_name,
      inner ? inner.at : src.created_at, inner ? inner.text : (src.content ?? ''))
    const c = comment.trim()
    try {
      for (const t of Object.values(sel)) {
        if (t.kind === 'dm') {
          const th = await openThread(meId, t.id)
          if (!th) throw new Error('Не удалось открыть диалог')
          const base = { thread_id: th.id, author: meId, author_name: meName }
          const { error } = await supabase.from('dm_messages').insert({ ...base, content: text, attach_url: src.attach_url ?? null, attach_type: src.attach_type ?? null })
          if (error) throw error
          if (c) await supabase.from('dm_messages').insert({ ...base, content: c })
        } else {
          const base = { channel_id: t.id, author: meId, author_name: meName }
          const { error } = await supabase.from('messages').insert({ ...base, content: text, attach_url: src.attach_url ?? null, attach_type: src.attach_type ?? null })
          if (error) throw error
          if (c) await supabase.from('messages').insert({ ...base, content: c })
        }
      }
      toastOk(count === 1 ? 'Переслано' : 'Переслано (' + count + ')')
      onClose()
    } catch (e: any) { toastErr(e?.message ?? 'Не удалось переслать') }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fwd-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="modal-title">Переслать сообщение</div>
        <div className="fwd-prev"><b>{origAuthor}:</b> {prevText.length > 120 ? prevText.slice(0, 120) + '…' : prevText}</div>
        <input className="modal-in" placeholder="Поиск: друг, канал или сервер" value={q} autoFocus onChange={e => setQ(e.target.value)} />
        <div className="fwd-list">
          {fFriends.length > 0 && <div className="fwd-sect">Личные сообщения</div>}
          {fFriends.map(f => {
            const t: Target = { key: 'dm:' + f.id, kind: 'dm', id: f.id, name: f.name }
            const on = !!sel[t.key]
            return <div key={t.key} className={'fwd-row' + (on ? ' on' : '')} onClick={() => toggle(t)}>
              <Avatar name={f.name} url={null} size={28} />
              <span className="fwd-row-nm">{f.name}</span>
              <span className="fwd-check">{on && <Icon name="check" size={13} />}</span>
            </div>
          })}
          {servers.map(s => {
            const chs = fChannels.filter(c => c.server_id === s.id)
            if (chs.length === 0) return null
            return <Fragment key={s.id}>
              <div className="fwd-sect">{s.name}</div>
              {chs.map(c => {
                const t: Target = { key: 'ch:' + c.id, kind: 'ch', id: c.id, name: c.name, server: s.name }
                const on = !!sel[t.key]
                return <div key={t.key} className={'fwd-row' + (on ? ' on' : '')} onClick={() => toggle(t)}>
                  <span className="fwd-hash"><Icon name="hash" size={18} /></span>
                  <span className="fwd-row-nm">{c.name}<span className="fwd-srv">{s.name}</span></span>
                  <span className="fwd-check">{on && <Icon name="check" size={13} />}</span>
                </div>
              })}
            </Fragment>
          })}
          {fFriends.length === 0 && fChannels.length === 0 && <div className="modal-empty">Ничего не найдено</div>}
        </div>
        <input className="modal-in fwd-comment" placeholder="Добавить комментарий (необязательно)" value={comment}
          onChange={e => setComment(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }} />
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Отмена</button>
          <button className="modal-primary" disabled={!count || busy} onClick={send}>
            {busy ? '…' : count > 1 ? 'Переслать (' + count + ')' : 'Переслать'}
          </button>
        </div>
      </div>
    </div>
  )
}
