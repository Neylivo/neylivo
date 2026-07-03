import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server } from '../types'
import { Icon } from './icons'

// Панель быстрого перехода (Ctrl+K), как в Discord: пиши первые буквы —
// прыгай в любой сервер, личку, Друзья или Музыку.

export type QSTarget =
  | { kind: 'home' }
  | { kind: 'music' }
  | { kind: 'server'; server: Server }
  | { kind: 'dm'; friend: { id: string; name: string } }

interface Item { key: string; label: string; sub: string; icon: string; target: QSTarget }

export function QuickSwitcher({ servers, onGo, onClose }:
  { servers: Server[]; onGo: (t: QSTarget) => void; onClose: () => void }) {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [friends, setFriends] = useState<{ id: string; name: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!user) return
    supabase.from('friend_requests').select('*')
      .or('from_user.eq.' + user.id + ',to_user.eq.' + user.id)
      .then(({ data }) => {
        const fr = (data ?? []).filter((r: any) => r.status === 'accepted').map((r: any) =>
          r.from_user === user.id ? { id: r.to_user, name: r.to_name } : { id: r.from_user, name: r.from_name })
        setFriends(fr)
      })
  }, [user])

  const items: Item[] = [
    { key: 'home', label: 'Друзья', sub: 'Личные сообщения', icon: 'home', target: { kind: 'home' } },
    { key: 'music', label: 'Ponoi Music', sub: 'Музыка', icon: 'music', target: { kind: 'music' } },
    ...servers.map(s => ({ key: 's' + s.id, label: s.name, sub: 'Сервер', icon: 'users', target: { kind: 'server', server: s } as QSTarget })),
    ...friends.map(f => ({ key: 'f' + f.id, label: '@' + f.name, sub: 'Личное сообщение', icon: 'message', target: { kind: 'dm', friend: f } as QSTarget })),
  ]
  const needle = q.trim().toLowerCase()
  const shown = (needle
    ? items.filter(i => i.label.toLowerCase().includes(needle))
        .sort((a, b) => Number(b.label.toLowerCase().startsWith(needle)) - Number(a.label.toLowerCase().startsWith(needle)))
    : items
  ).slice(0, 10)
  const sel = Math.min(idx, Math.max(0, shown.length - 1))

  return (
    <div className="qs-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="qs-box">
        <input ref={inputRef} className="qs-input" placeholder="Куда отправимся?" value={q}
          onChange={e => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => (i + 1) % Math.max(1, shown.length)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => (i - 1 + Math.max(1, shown.length)) % Math.max(1, shown.length)) }
            else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); onGo(shown[sel].target) }
          }} />
        <div className="qs-list">
          {shown.length === 0 && <div className="qs-empty">Ничего не найдено</div>}
          {shown.map((it, i) => (
            <div key={it.key} className={'qs-item' + (i === sel ? ' on' : '')}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={e => { e.preventDefault(); onGo(it.target) }}>
              <Icon name={it.icon} size={18} />
              <span className="qs-label">{it.label}</span>
              <span className="qs-sub">{it.sub}</span>
            </div>
          ))}
        </div>
        <div className="qs-hint"><b>↑↓</b> — выбрать • <b>Enter</b> — перейти • <b>Esc</b> — закрыть</div>
      </div>
    </div>
  )
}
