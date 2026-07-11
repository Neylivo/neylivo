// v1.223.0: панель справа в групповой беседе — аналог DmProfilePanel для 1-в-1,
// только тут список участников (с короной у владельца, крестиком-удалить у
// владельца рядом с чужими), «Добавить участника» и «Покинуть беседу».
import { useState } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { confirmUi, promptUi } from '../lib/confirm'
import { toastErr } from '../lib/toast'
import type { Profile } from '../types'
import type { GroupThread } from '../lib/groupDm'
import { removeGroupMember, renameGroupDm, groupDisplayName } from '../lib/groupDm'
import { AddGroupMemberModal } from './AddGroupMemberModal'

export function GroupMembersPanel({ group, members, meId, allFriends, onLeft }:
  { group: GroupThread; members: Profile[]; meId: string; allFriends: { id: string; name: string }[]; onLeft: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const isOwner = group.ownerId === meId
  const label = group.name || groupDisplayName(members.filter(m => m.id !== meId).map(m => m.display_name || m.username))

  async function rename() {
    const v = await promptUi('Название беседы', { initial: group.name ?? '', placeholder: label })
    if (v === null) return
    try { await renameGroupDm(group.id, v) } catch { toastErr('Не удалось переименовать беседу') }
  }

  async function kick(userId: string) {
    setBusyId(userId)
    try { await removeGroupMember(group.id, userId) } catch { toastErr('Не удалось убрать участника') }
    finally { setBusyId(null) }
  }

  async function leave() {
    if (!await confirmUi('Покинуть беседу «' + label + '»?', { okText: 'Покинуть' })) return
    setBusyId(meId)
    try { await removeGroupMember(group.id, meId); onLeft() } catch { toastErr('Не удалось покинуть беседу') }
    finally { setBusyId(null) }
  }

  return (
    <aside className="dmp gmp">
      <div className="gmp-head">
        <span className="gmp-ic"><Icon name="users" size={22} /></span>
        <div className="gmp-nm">{label}</div>
        <button className="gmp-edit" title="Переименовать" onClick={rename}><Icon name="edit" size={14} /></button>
      </div>
      <div className="gmp-sec">Участники — {members.length}</div>
      <div className="gmp-list">
        {members.map(m => (
          <div key={m.id} className="gmp-row">
            <Avatar name={m.display_name || m.username} url={m.avatar_url} userId={m.id} size={32} />
            <span className="gmp-row-nm">{m.display_name || m.username}{m.id === meId ? ' (вы)' : ''}</span>
            {group.ownerId === m.id && <span title="Владелец беседы"><Icon name="crown" size={14} /></span>}
            {isOwner && m.id !== meId && (
              <button className="gmp-kick" title="Убрать из беседы" disabled={busyId === m.id} onClick={() => kick(m.id)}>
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {members.length < 10 && <button className="gmp-add" onClick={() => setAddOpen(true)}><Icon name="user-plus" size={15} /> Добавить участника</button>}
      <button className="gmp-leave" disabled={busyId === meId} onClick={leave}><Icon name="signout" size={15} /> Покинуть беседу</button>
      {addOpen && <AddGroupMemberModal threadId={group.id} friends={allFriends} excludeIds={new Set(members.map(m => m.id))}
        onClose={() => setAddOpen(false)} />}
    </aside>
  )
}
