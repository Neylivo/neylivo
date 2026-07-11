// v1.223.0: «Добавить участника» из панели участников групповой беседы —
// список друзей, которых там ещё нет, мульти-выбор, добавляет по одному через RPC.
import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { addGroupMember } from '../lib/groupDm'
import { toastErr } from '../lib/toast'

interface Friend { id: string; name: string }

const MAX_MEMBERS = 10   // включая всех текущих участников — как в Discord

export function AddGroupMemberModal({ threadId, friends, excludeIds, onClose }:
  { threadId: string; friends: Friend[]; excludeIds: Set<string>; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const pool = useMemo(() => friends.filter(f => !excludeIds.has(f.id)), [friends, excludeIds])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? pool.filter(f => f.name.toLowerCase().includes(t)) : pool
  }, [pool, q])
  // v1.233.0: excludeIds — это уже существующие участники (включая себя), так что
  // сколько ещё можно выбрать разом — это лимит минус текущий состав. Раньше выбор
  // не ограничивался вовсе, и последующие добавления в цикле молча проваливались,
  // как только сервер отвечал group_dm_full.
  const roomLeft = Math.max(0, MAX_MEMBERS - excludeIds.size)

  function toggle(id: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else if (n.size < roomLeft) n.add(id)
      return n
    })
  }

  async function submit() {
    if (selected.size === 0 || busy) return
    setBusy(true)
    try {
      for (const id of selected) await addGroupMember(threadId, id)
      onClose()
    } catch (e: any) {
      toastErr(e?.message === 'group_dm_full' ? 'В беседе уже максимум участников'
        : e?.message === 'blocked_member' ? 'Не удалось добавить — с кем-то из беседы есть взаимная блокировка'
        : e?.message === 'not_friends' ? 'Добавить можно только друзей'
        : 'Не удалось добавить участника')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fwd-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Добавить участника</div>
        <div className="modal-sub">{roomLeft - selected.size > 0 ? `Можно добавить ещё ${roomLeft - selected.size}.` : 'Достигнут максимум участников.'}</div>
        <input className="modal-in" placeholder="Найти друзей" value={q} autoFocus onChange={e => setQ(e.target.value)} style={{ marginTop: 12 }} />
        <div className="fwd-list">
          {filtered.length === 0 && <div className="modal-empty">{pool.length === 0 ? 'Все друзья уже в беседе' : 'Никого не найдено'}</div>}
          {filtered.map(f => {
            const on = selected.has(f.id)
            const disabled = !on && selected.size >= roomLeft
            return (
              <div key={f.id} className={'fwd-row' + (on ? ' on' : '') + (disabled ? ' disabled' : '')}
                onClick={() => !disabled && toggle(f.id)}>
                <Avatar name={f.name} userId={f.id} size={28} />
                <span className="fwd-row-nm">{f.name}</span>
                <span className="fwd-check">{on && <Icon name="check" size={13} />}</span>
              </div>
            )
          })}
        </div>
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Отмена</button>
          <button className="modal-primary" disabled={selected.size === 0 || busy} onClick={submit}>{busy ? '…' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  )
}
