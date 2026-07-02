import { useEffect, useRef, useState } from 'react'
import type { Server } from '../types'
import { uploadTo } from '../lib/storage'
import { updateServer } from '../lib/servers'

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  )
}

export function CreateServerModal({ uid, onClose, onCreate }:
  { uid: string; onClose: () => void; onCreate: (name: string, avatarUrl: string | null) => void }) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const initials = (name.trim() || 'PG').slice(0, 2).toUpperCase()
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !uid) return
    setBusy(true)
    try { setAvatar(await uploadTo('avatars', uid, f)) }
    catch (err: any) { alert(err.message ?? String(err)) }
    finally { setBusy(false) }
  }
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}>✕</button>
      <div className="modal-title">Создать сервер</div>
      <div className="modal-sub">Дай ему имя и аватарку — потом всё можно поменять.</div>
      <div className="modal-avwrap">
        <div className="modal-av" style={{ backgroundImage: avatar ? `url(${avatar})` : undefined }}>
          {!avatar && initials}
        </div>
        <button className="modal-avbtn" onClick={() => fileRef.current?.click()}>{busy ? '…' : '📷 Аватарка'}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>
      <label className="modal-lbl">Название сервера</label>
      <input className="modal-in" autoFocus placeholder="Например, My Server" value={name}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim(), avatar) }} />
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Отмена</button>
        <button className="modal-primary" disabled={!name.trim() || busy} onClick={() => onCreate(name.trim(), avatar)}>Создать</button>
      </div>
    </Overlay>
  )
}

export function FindServerModal({ onClose, onFind }:
  { onClose: () => void; onFind: (q: string) => Promise<Server[]> }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Server[]>([])
  const [searched, setSearched] = useState(false)
  async function run(v: string) {
    setQ(v)
    if (!v.trim()) { setResults([]); setSearched(false); return }
    setResults(await onFind(v.trim())); setSearched(true)
  }
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}>✕</button>
      <div className="modal-title">Найти сервер</div>
      <div className="modal-sub">По ID или названию</div>
      <input className="modal-in" autoFocus placeholder="ID или название сервера" value={q} onChange={e => run(e.target.value)} />
      <div className="modal-results">
        {searched && results.length === 0 && <div className="modal-empty">Ничего не найдено</div>}
        {results.map(s => (
          <div key={s.id} className="modal-result">{s.name}</div>
        ))}
      </div>
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Закрыть</button>
      </div>
    </Overlay>
  )
}

const CTX_ITEMS = [
  { k: 'read', label: 'Прочитать всё', icon: '✔' },
  { k: 'invite', label: 'Пригласить друга', icon: '＋' },
  { k: 'notif', label: 'Настройки уведомлений', icon: '🔔' },
  { k: 'mute', label: 'Заглушить сервер', icon: '🔕' },
  { k: 'tag', label: 'Взять тег сервера', icon: '🏷' },
  { k: 'copyid', label: 'Копировать ID сервера', icon: '🆔' },
  { k: 'settings', label: 'Настройки сервера', icon: '⚙' },
  { k: 'delete', label: 'Удалить сервер', icon: '🗑', danger: true },
] as const

export function ServerCtxMenu({ x, y, isOwner, onClose, onAction }:
  { x: number; y: number; isOwner: boolean; onClose: () => void; onAction: (k: string) => void }) {
  useEffect(() => {
    const h = () => onClose()
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [onClose])
  return (
    <div className="ctxmenu" style={{ left: x, top: y }} onClick={e => e.stopPropagation()}>
      {CTX_ITEMS.filter(i => isOwner || (i.k !== 'delete' && i.k !== 'settings')).map(i => (
        <div key={i.k} className={'ctxmenu-item' + ((i as any).danger ? ' danger' : '')}
          onClick={() => { onAction(i.k); onClose() }}>
          <span className="ctxmenu-ic">{i.icon}</span>{i.label}
        </div>
      ))}
    </div>
  )
}

export function ServerSettingsModal({ server, uid, onClose, onRename, onDelete, onChanged }:
  { server: Server; uid: string; onClose: () => void; onRename: (name: string) => void; onDelete: () => void; onChanged?: () => void }) {
  const [tab, setTab] = useState<'main' | 'roles' | 'channels'>('main')
  const [accent, setAccent] = useState(server.accent || '#5865f2')
  const [avatar, setAvatar] = useState<string | null>(server.avatar_url ?? null)
  const [name, setName] = useState(server.name)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const initials = (server.name || 'S').slice(0, 2).toUpperCase()
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !uid) return
    setBusy(true)
    try {
      const url = await uploadTo('avatars', uid, f)
      setAvatar(url)
      await updateServer(server.id, { avatar_url: url })
      onChanged?.()
    } catch (err: any) { alert(err.message ?? String(err)) }
    finally { setBusy(false) }
  }
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}>✕</button>
      <div className="modal-title">Настройки сервера — {server.name}</div>
      <div className="modal-tabs">
        <button className={'modal-tab' + (tab === 'main' ? ' on' : '')} onClick={() => setTab('main')}>Основное</button>
        <button className={'modal-tab' + (tab === 'roles' ? ' on' : '')} onClick={() => setTab('roles')}>Роли и права</button>
        <button className={'modal-tab' + (tab === 'channels' ? ' on' : '')} onClick={() => setTab('channels')}>Каналы</button>
      </div>

      {tab === 'main' && <>
        <div className="modal-sect">Аватарка сервера</div>
        <div className="modal-avwrap left">
          <div className="modal-av sq" style={{ backgroundImage: avatar ? `url(${avatar})` : undefined }}>{!avatar && initials}</div>
          <button className="modal-avbtn" onClick={() => fileRef.current?.click()}>{busy ? '…' : '🖼 Сменить'}</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        </div>
        <label className="modal-lbl">Название сервера</label>
        <div className="modal-inline">
          <input className="modal-in" value={name} onChange={e => setName(e.target.value)} />
          <button className="modal-primary" disabled={!name.trim() || name === server.name} onClick={() => onRename(name.trim())}>Сохранить</button>
        </div>
        <div className="modal-sect">Тема сервера (акцент)</div>
        <div className="modal-inline">
          <input type="color" className="modal-color" value={accent} onChange={e => setAccent(e.target.value)} />
          <button className="modal-primary" onClick={async () => { await updateServer(server.id, { accent }); onChanged?.() }}>Применить</button>
          <button className="modal-ghost" onClick={async () => { setAccent('#5865f2'); await updateServer(server.id, { accent: null }); onChanged?.() }}>Сбросить</button>
          <span className="modal-hint">акцент применяется, когда открыт этот сервер</span>
        </div>
      </>}

      {tab === 'roles' && <div className="modal-note">Роли и права: скоро. Сейчас владелец сервера управляет всем, участники — обычные.</div>}
      {tab === 'channels' && <div className="modal-note">Каналы создаются и удаляются на боковой панели сервера (＋ канал).</div>}

      <div className="modal-foot">
        <button className="modal-danger" onClick={() => { if (confirm('Удалить сервер? Это необратимо.')) onDelete() }}>Удалить сервер</button>
        <button className="modal-ghost" onClick={onClose}>Закрыть</button>
      </div>
    </Overlay>
  )
}