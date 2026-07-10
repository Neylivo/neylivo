import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { saveProfile } from '../lib/profilePrefs'
import { invalidateUserTag } from '../lib/userTag'
import { toastOk } from '../lib/toast'
import { Icon } from './icons'
import { TagChip } from './TagEmoji'
import type { Server } from '../types'

// v1.178.0: «Использовать тег этого сервера» — 1-в-1 как в Discord: открывается
// правым кликом по серверу («Взять тег сервера»), даёт включить/убрать тег этого
// сервера у себя рядом с ником одним кликом, без похода в настройки профиля.
export function ServerTagModal({ server, myTagServerId, onClose, onEditProfile }:
  { server: Server; myTagServerId: string | null; onClose: () => void; onEditProfile: () => void }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const tag = (server as any).settings?.tag ?? {}
  const isActive = myTagServerId === server.id
  const hasTag = !!tag.name

  async function toggle() {
    if (!user || busy) return
    setBusy(true)
    try {
      await saveProfile(user.id, { tagServerId: isActive ? null : server.id })
      invalidateUserTag(user.id)
      toastOk(isActive ? 'Тег сервера убран' : 'Тег сервера установлен — виден рядом с твоим ником')
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal srvtag" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="srvtag-h">Использовать тег этого сервера</div>
        <div className="srvtag-sub">Представляйте свой любимый сервер в Ponoi.</div>
        <div className="srvtag-row">
          <span className="srvtag-av" style={server.avatar_url ? { backgroundImage: `url(${server.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
            {!server.avatar_url && server.name.slice(0, 2).toUpperCase()}
          </span>
          <b className="srvtag-nm">{server.name}</b>
          {hasTag && <TagChip tag={tag} />}
        </div>
        {hasTag
          ? <>
              <button className="modal-primary srvtag-btn" disabled={busy} onClick={toggle}>{isActive ? 'Убрать тег' : 'Использовать тег'}</button>
              <button className="srvtag-btn srvtag-ghost" onClick={() => { onClose(); onEditProfile() }}>Редактировать профиль</button>
            </>
          : <div className="cset-hint" style={{ textAlign: 'center', margin: '12px 0 4px' }}>У этого сервера ещё нет тега{server.owner === user?.id ? ' — задай его в настройках сервера.' : '.'}</div>}
      </div>
    </div>
  )
}
