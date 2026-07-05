import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openThread } from '../lib/friends'
import { createInvite } from '../lib/servers'
import { sysInvite } from '../lib/sysmsg'
import { sendPush } from '../lib/push'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { toastErr } from '../lib/toast'
import type { Server, Channel } from '../types'

// Веб-адрес приложения — из него собирается ссылка-приглашение.
const WEB_BASE = 'https://ponoiai.github.io/ponoi/'

interface FriendRow { id: string; name: string; handle?: string | null; avatar?: string | null }

// v1.68.0: модалка «Пригласить друзей в [сервер]» — 1-в-1 как в Discord: поиск по
// друзьям, «Пригласить» шлёт карточку-приглашение в ЛС (кнопка становится
// «Отправлено»), внизу — ссылка-приглашение с кнопкой «Копировать».
export function InviteModal({ server, channelName, meId, meName, onClose }:
  { server: Server; channelName?: string | null; meId: string; meName: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [code, setCode] = useState<string | null>(null)
  const [chName, setChName] = useState<string | null>(channelName ?? null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  useEffect(() => { (async () => {
    // Одна ссылка на всё время открытой панели.
    const res = await createInvite(server.id, meId)
    if (res.code) setCode(res.code)
    else if (res.error) toastErr(res.error.message)
    // «Участники окажутся в …»: текущий канал, иначе первый текстовый.
    if (!channelName) {
      const { data } = await supabase.from('channels').select('*').eq('server_id', server.id)
      const first = ((data ?? []) as Channel[]).find(c => (c.kind ?? 'text') === 'text')
      if (first) setChName(first.name)
    }
    // Друзья: принятые заявки в обе стороны + имена/аватарки из профилей.
    const { data: fr } = await supabase.from('friend_requests').select('*')
      .eq('status', 'accepted').or('from_user.eq.' + meId + ',to_user.eq.' + meId)
    const seen = new Set<string>()
    const fs: FriendRow[] = []
    for (const r of (fr ?? []) as any[]) {
      const f = r.from_user === meId ? { id: r.to_user, name: r.to_name } : { id: r.from_user, name: r.from_name }
      if (!seen.has(f.id)) { seen.add(f.id); fs.push(f) }
    }
    if (fs.length) {
      const { data: ps } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', fs.map(f => f.id))
      const byId: Record<string, any> = {}
      for (const p of (ps ?? []) as any[]) byId[p.id] = p
      for (const f of fs) {
        const p = byId[f.id]
        if (p) { f.name = p.display_name || f.name; f.handle = p.username; f.avatar = p.avatar_url }
      }
    }
    setFriends(fs)
    // eslint-disable-next-line
  })() }, [server.id, meId])

  const term = q.trim().toLowerCase()
  const list = useMemo(() => friends.filter(f =>
    !term || f.name.toLowerCase().includes(term) || (f.handle ?? '').toLowerCase().includes(term)), [friends, term])

  const link = code ? WEB_BASE + 'invite/' + code : ''

  async function inviteFriend(f: FriendRow) {
    if (!code || sent[f.id] || busy[f.id]) return
    setBusy(b => ({ ...b, [f.id]: true }))
    try {
      const th = await openThread(meId, f.id)
      if (!th) throw new Error('Не удалось открыть диалог')
      const { error } = await supabase.from('dm_messages').insert({
        thread_id: th.id, author: meId, author_name: meName, content: sysInvite(code, server.name),
      })
      if (error) throw error
      setSent(s => ({ ...s, [f.id]: true }))
      sendPush([f.id], meName, 'Приглашение на сервер «' + server.name + '»', '/')
    } catch (e: any) { toastErr(e?.message ?? 'Не удалось отправить приглашение') }
    finally { setBusy(b => ({ ...b, [f.id]: false })) }
  }

  async function copy() {
    if (!link) return
    try { await navigator.clipboard.writeText(link) } catch {}
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal inv-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="modal-title inv-title">Пригласить друзей в {server.name}</div>
        {chName && <div className="inv-sub"><Icon name="hash" size={14} /> Участники окажутся в <b>{chName}</b></div>}
        <div className="inv-search">
          <input placeholder="Найти друзей" value={q} autoFocus onChange={e => setQ(e.target.value)} />
          <span className="inv-sic"><Icon name="search" size={16} /></span>
        </div>
        <div className="inv-list">
          {list.map(f => (
            <div key={f.id} className="inv-row">
              <Avatar name={f.name} url={f.avatar ?? null} size={32} />
              <div className="inv-names">
                <span className="inv-nm">{f.name}</span>
                {f.handle && <span className="inv-hd">{f.handle}</span>}
              </div>
              <button className={'inv-btn' + (sent[f.id] ? ' sent' : '')} disabled={!!sent[f.id] || !!busy[f.id]} onClick={() => inviteFriend(f)}>
                {sent[f.id] ? 'Отправлено' : busy[f.id] ? '…' : 'Пригласить'}
              </button>
            </div>
          ))}
          {friends.length > 0 && list.length === 0 && <div className="modal-empty">Никого не нашлось</div>}
          {friends.length === 0 && <div className="modal-empty">У вас пока нет друзей — отправьте ссылку ниже</div>}
        </div>
        <div className="inv-foot">
          <div className="inv-foot-lb">Или отправьте другу ссылку-приглашение на сервер</div>
          <div className="inv-linkrow">
            <input readOnly value={link} onFocus={e => e.currentTarget.select()} />
            <button className={'inv-copy' + (copied ? ' ok' : '')} onClick={copy}>{copied ? 'Скопировано!' : 'Копировать'}</button>
          </div>
          <div className="inv-note">Ссылка-приглашение бессрочна. Её можно вставить в «Присоединиться к серверу».</div>
        </div>
      </div>
    </div>
  )
}
