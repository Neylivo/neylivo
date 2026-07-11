// v1.223.0: «Новая беседа» — открывается с «+» у «Личные сообщения». Выбор одного
// друга просто открывает обычную ЛС; выбор нескольких (до 9, т.к. с собой — максимум
// 10 человек, как в Discord) создаёт групповую беседу (см. src/lib/groupDm.ts).
import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { createGroupDm } from '../lib/groupDm'
import { toastErr } from '../lib/toast'

interface Friend { id: string; name: string }

const MAX_MEMBERS = 10   // включая себя — как в Discord

export function NewConversationModal({ friends, onClose, onOpenFriend, onGroupCreated }:
  { friends: Friend[]; onClose: () => void; onOpenFriend: (f: Friend) => void; onGroupCreated: (threadId: string, memberIds: string[]) => void }) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? friends.filter(f => f.name.toLowerCase().includes(t)) : friends
  }, [friends, q])

  function toggle(id: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else if (n.size < MAX_MEMBERS - 1) n.add(id)
      return n
    })
  }

  async function submit() {
    if (selected.size === 0 || busy) return
    setBusy(true)
    try {
      if (selected.size === 1) {
        const f = friends.find(x => x.id === [...selected][0])
        if (f) onOpenFriend(f)
        onClose()
        return
      }
      const threadId = await createGroupDm([...selected])
      onGroupCreated(threadId, [...selected])
      onClose()
    } catch (e: any) {
      toastErr(e?.message === 'group_dm_too_many_members' ? 'Слишком много участников'
        : e?.message === 'blocked_member' ? 'Среди выбранных есть заблокировавшие друг друга — беседу с ними не создать'
        : e?.message === 'not_friends' ? 'Добавить в беседу можно только друзей'
        : 'Не удалось создать беседу')
    } finally {
      setBusy(false)
    }
  }

  const left = MAX_MEMBERS - 1 - selected.size

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fwd-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Новая беседа</div>
        <div className="modal-sub">{left > 0 ? `Вы можете добавить ещё ${left} ${ruFriends(left)}.` : 'Достигнут максимум участников.'}</div>
        <input className="modal-in" placeholder="Найти друзей" value={q} autoFocus onChange={e => setQ(e.target.value)} style={{ marginTop: 12 }} />
        <div className="fwd-list">
          {filtered.length === 0 && <div className="modal-empty">Никого не найдено</div>}
          {filtered.map(f => {
            const on = selected.has(f.id)
            const disabled = !on && selected.size >= MAX_MEMBERS - 1
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
          <button className="modal-primary" disabled={selected.size === 0 || busy} onClick={submit}>{busy ? '…' : 'Создать беседу'}</button>
        </div>
      </div>
    </div>
  )
}

// «добавить ещё N друзей» — «друг» тут одушевлённое прямое дополнение (винительный
// падеж = родительный для одушевлённых), в отличие от именительного «2 друга» —
// в этой позиции даже для 2-4 правильно «друзей», не «друга» (искл. только N=1).
function ruFriends(n: number): string {
  return n === 1 ? 'друга' : 'друзей'
}
