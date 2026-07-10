import { useState } from 'react'
import { Icon } from './icons'

const GAME_LABEL: Record<string, string> = { roblox: 'Roblox', cs2: 'Counter-Strike 2', terraria: 'Terraria' }
const DEFAULT_PORT: Record<string, string> = { cs2: '27015', terraria: '7777' }

// v1.184.0: «Поделиться игрой» для Roblox — всё уже известно из детекта игры
// (placeId/jobId читаются из лога Roblox в main-процессе, см. robloxCurrentSession()
// в electron/main.cjs), просто подтверждение. v1.192.0: CS2/Terraria — хостовский
// сервер автоматически не определить (ни GSI, ни файлы Terraria этого не отдают),
// поэтому для них добавлены поля IP/порт, как в ShareBuildModal.tsx (Minecraft).
export function ShareGameLinkModal({ game, label, onClose, onShared }: {
  game: 'roblox' | 'cs2' | 'terraria'
  label: string | null
  onClose: () => void
  onShared: (ip: string, port: number) => void
}) {
  const needsAddr = game !== 'roblox'
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT[game] ?? '')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Поделиться игрой</div>
        <div className="modal-sub">Друг сможет присоединиться прямо к твоей игре одной кнопкой.</div>
        <div className="sset-info" style={{ marginTop: 16 }}>
          <Icon name="gamepad" size={16} />
          <span>{GAME_LABEL[game]}{label ? ' · ' + label : ''}</span>
        </div>
        {needsAddr && <>
          <label className="modal-lbl">Адрес сервера</label>
          <div className="modal-inline">
            <input className="modal-in" placeholder="IP или домен" value={ip} onChange={e => setIp(e.target.value)} style={{ flex: 2 }} />
            <input className="modal-in" placeholder="Порт" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} style={{ flex: 1, maxWidth: 90 }} />
          </div>
        </>}
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Отмена</button>
          <button className="modal-primary" disabled={needsAddr && !ip.trim()} onClick={() => onShared(ip.trim(), parseInt(port, 10) || 0)}>Поделиться в чате</button>
        </div>
      </div>
    </div>
  )
}
