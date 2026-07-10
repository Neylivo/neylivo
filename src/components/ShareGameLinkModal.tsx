import { Icon } from './icons'

// v1.184.0: «Поделиться игрой» для Roblox — в отличие от ShareBuildModal
// (Minecraft: скан модов + заливка + IP сервера), тут всё уже известно из
// детекта игры (placeId/jobId читаются из лога Roblox в main-процессе,
// см. robloxCurrentSession() в electron/main.cjs) — просто подтверждение.
export function ShareGameLinkModal({ label, onClose, onShared }: {
  label: string | null
  onClose: () => void
  onShared: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Поделиться игрой</div>
        <div className="modal-sub">Друг сможет присоединиться прямо к твоей игре одной кнопкой.</div>
        <div className="sset-info" style={{ marginTop: 16 }}>
          <Icon name="gamepad" size={16} />
          <span>Roblox{label ? ' · ' + label : ''}</span>
        </div>
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Отмена</button>
          <button className="modal-primary" onClick={onShared}>Поделиться в чате</button>
        </div>
      </div>
    </div>
  )
}
