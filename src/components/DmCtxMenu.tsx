import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { copyText } from '../lib/copyMedia'
import { confirmUi } from '../lib/confirm'
import { toastOk, toastErr } from '../lib/toast'
import {
  isDmPinned, toggleDmPinned, isDmMuted, setDmMuted, isDmIgnored, toggleDmIgnored,
  getUserPrefs, patchUserPrefs, friendNickOf, setFriendNick, setDmRead, closeDm,
} from '../lib/userPrefs'
import { clearBadgeKey } from '../lib/badge'
import { blockUser } from '../lib/block'
import { createInvite } from '../lib/servers'
import { openThread } from '../lib/friends'
import { sysInvite } from '../lib/sysmsg'
import { supabase } from '../lib/supabase'
import type { Server } from '../types'
import { useClampToViewport, useFlipSubmenu } from '../lib/clampPos'

interface Friend { id: string; name: string }

// v1.187.0: правый клик по другу в списке ЛС — меню 1 в 1 как в Discord. Паттерн
// ctx-overlay/ctx-menu/ctx-item/ctx-sep — тот же, что везде в приложении (см.
// PartCtxMenu в CallRoom.tsx, chCtx-меню в ServerView.tsx). «Приложения» не
// добавлены — в Ponoi нет платформы ботов/приложений, нерабочую кнопку не кладём.
export function DmCtxMenu({ friend, x, y, threadId, servers, meId, username, onClose, onChanged,
  onProfile, onStartCall, onCloseDm, onRemoveFriend, onBlocked }: {
  friend: Friend; x: number; y: number; threadId: string | null; servers: Server[]
  meId: string; username: string
  onClose: () => void
  onChanged: () => void   // что-то в user_prefs поменялось — родителю пересчитать список/сортировку
  onProfile: () => void
  onStartCall: () => void
  onCloseDm: () => void
  onRemoveFriend: () => void
  onBlocked: () => void
}) {
  const [sub, setSub] = useState<'invite' | 'mute' | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [nickOpen, setNickOpen] = useState(false)
  const [noteVal, setNoteVal] = useState(() => getUserPrefs().notes[friend.id] ?? '')
  const [nickVal, setNickVal] = useState(() => friendNickOf(friend.id) ?? '')
  // v1.226.0: «Пригласить на сервер» показывало ВСЕ мои серверы, включая те, где
  // этот друг уже состоит — приглашение туда просто дублировало карточку без
  // всякого смысла. Подтягиваем его членство в моих серверах и такие прячем.
  const [friendServerIds, setFriendServerIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (servers.length === 0) return
    supabase.from('server_members').select('server_id').eq('user_id', friend.id).in('server_id', servers.map(s => s.id))
      .then(({ data }) => setFriendServerIds(new Set(((data ?? []) as any[]).map(r => r.server_id))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend.id, servers.map(s => s.id).join(',')])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function saveNote() {
    const notes = { ...getUserPrefs().notes }
    if (noteVal.trim()) notes[friend.id] = noteVal.trim(); else delete notes[friend.id]
    patchUserPrefs({ notes })
    setNoteOpen(false); onChanged()
  }
  function saveNick() {
    setFriendNick(friend.id, nickVal.trim() || null)
    setNickOpen(false); onChanged()
  }
  function markRead() {
    if (threadId) { setDmRead(threadId, Date.now()); clearBadgeKey('dm:' + threadId) }
    onClose()
  }
  function pin() { toggleDmPinned(friend.id); onChanged(); onClose() }
  async function resolveThreadId(): Promise<string | null> {
    if (threadId) return threadId
    const t = await openThread(meId, friend.id)
    return t?.id ?? null
  }
  async function inviteToServer(serverId: string, serverName: string) {
    if (friendServerIds.has(serverId)) return
    const r = await createInvite(serverId, meId)
    if ('error' in r || !r.code) { toastErr('Не удалось создать приглашение'); return }
    const tid = await resolveThreadId()
    if (!tid) { toastErr('Не удалось открыть ЛС'); return }
    await supabase.from('dm_messages').insert({ thread_id: tid, author: meId, author_name: username, content: sysInvite(r.code, serverName) })
    toastOk('Приглашение отправлено')
    onClose()
  }
  function ignore() { toggleDmIgnored(friend.id); onChanged(); onClose() }
  async function block() {
    if (!await confirmUi('Заблокировать ' + friend.name + '? Дружба будет разорвана, переписка станет недоступна для обоих.', { okText: 'Заблокировать', danger: true })) return
    const ok = await blockUser(meId, friend.id)
    if (!ok) { toastErr('Не удалось заблокировать — попробуй ещё раз'); return }
    onBlocked(); onClose()
  }
  function mute(ms: number | null) { setDmMuted(friend.id, ms); onChanged(); onClose() }
  function copyUserId() { copyText(friend.id, 'ID пользователя скопирован'); onClose() }
  async function copyThreadId() {
    const tid = await resolveThreadId()
    if (tid) copyText(tid, 'ID канала скопирован')
    onClose()
  }

  const pinned = isDmPinned(friend.id)
  const muted = isDmMuted(friend.id)
  const ignored = isDmIgnored(friend.id)
  const clamp = useClampToViewport(x, y)
  const inviteSub = useFlipSubmenu()
  const muteSub = useFlipSubmenu()

  return (
    <>
      <div className="ctx-overlay" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div className="ctx-menu" ref={clamp.ref} style={clamp.style}>
        <div className="ctx-item" onClick={markRead}><span>Пометить как прочитанное</span><Icon name="check" size={14} /></div>
        <div className="ctx-sep" />
        <div className="ctx-item" onClick={pin}><span>{pinned ? 'Открепить' : 'Закрепить'}</span><Icon name="pin" size={14} /></div>
        <div className="ctx-sep" />
        <div className="ctx-item" onClick={() => { onProfile(); onClose() }}><span>Профиль</span><Icon name="user" size={14} /></div>
        <div className="ctx-item" onClick={() => { onStartCall(); onClose() }}><span>Начать звонок</span><Icon name="phone" size={14} /></div>
        <div className="ctx-item" onClick={() => setNoteOpen(v => !v)}>
          <span className="ctx-item-stack">Добавить заметку<small>Видна только вам</small></span><Icon name="edit" size={14} />
        </div>
        {noteOpen && <div className="ctx-inline" onClick={e => e.stopPropagation()}>
          <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)} placeholder="Заметка" maxLength={300} />
          <button onClick={saveNote}>Сохранить</button>
        </div>}
        <div className="ctx-item" onClick={() => setNickOpen(v => !v)}><span>Добавить никнейм друга</span><Icon name="tag" size={14} /></div>
        {nickOpen && <div className="ctx-inline" onClick={e => e.stopPropagation()}>
          <input value={nickVal} onChange={e => setNickVal(e.target.value)} placeholder={friend.name} maxLength={32} />
          <button onClick={saveNick}>Сохранить</button>
        </div>}
        <div className="ctx-item" onClick={() => { onCloseDm(); onClose() }}><span>Закрыть ЛС</span><Icon name="close" size={14} /></div>
        <div className="ctx-sep" />
        <div className="ctx-item has-sub" onClick={() => setSub(s => s === 'invite' ? null : 'invite')}>
          <span>Пригласить на сервер</span><Icon name="chevron-right" size={14} />
          {sub === 'invite' && <div className="ctx-menu ctx-submenu" ref={inviteSub.ref} style={inviteSub.style} onClick={e => e.stopPropagation()}>
            {servers.length === 0 && <div className="ctx-item ctx-item-empty">Нет серверов</div>}
            {servers.map(s => friendServerIds.has(s.id)
              ? <div key={s.id} className="ctx-item ctx-item-empty"><span>{s.name} — уже там</span></div>
              : <div key={s.id} className="ctx-item" onClick={() => inviteToServer(s.id, s.name)}><span>{s.name}</span></div>)}
          </div>}
        </div>
        <div className="ctx-item" onClick={() => { onRemoveFriend(); onClose() }}><span>Удалить из друзей</span><Icon name="trash" size={14} /></div>
        <div className="ctx-item" onClick={ignore}><span>{ignored ? 'Снять игнор' : 'Игнорировать'}</span><Icon name="flag" size={14} /></div>
        <div className="ctx-item danger" onClick={block}><span>Заблокировать</span><Icon name="shield" size={14} /></div>
        <div className="ctx-sep" />
        {!muted ? (
          <div className="ctx-item has-sub" onClick={() => setSub(s => s === 'mute' ? null : 'mute')}>
            <span>Заглушить @{friend.name}</span><Icon name="chevron-right" size={14} />
            {sub === 'mute' && <div className="ctx-menu ctx-submenu" ref={muteSub.ref} style={muteSub.style} onClick={e => e.stopPropagation()}>
              <div className="ctx-item" onClick={() => mute(Date.now() + 15 * 60000)}><span>15 минут</span></div>
              <div className="ctx-item" onClick={() => mute(Date.now() + 3600000)}><span>1 час</span></div>
              <div className="ctx-item" onClick={() => mute(Date.now() + 8 * 3600000)}><span>8 часов</span></div>
              <div className="ctx-item" onClick={() => mute(Date.now() + 24 * 3600000)}><span>24 часа</span></div>
              <div className="ctx-item" onClick={() => mute(0)}><span>Пока не включу снова</span></div>
            </div>}
          </div>
        ) : (
          <div className="ctx-item" onClick={() => mute(null)}><span>Включить уведомления</span><Icon name="bell" size={14} /></div>
        )}
        <div className="ctx-sep" />
        <div className="ctx-item" onClick={copyUserId}><span>Копировать ID пользователя</span><span className="ctx-idbadge">ID</span></div>
        <div className="ctx-item" onClick={copyThreadId}><span>Копировать ID канала</span><span className="ctx-idbadge">ID</span></div>
      </div>
    </>
  )
}
