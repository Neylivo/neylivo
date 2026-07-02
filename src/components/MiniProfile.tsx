
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status, STATUS_LABEL } from '../lib/presence'

export interface MiniProfileData {
  userId: string
  name: string
  avatarUrl?: string | null
  status: Status
  role?: string
  x: number
  y: number
}

export function MiniProfile({ data, onClose, onMessage }:
  { data: MiniProfileData; onClose: () => void; onMessage?: () => void }) {
  return (
    <>
      <div className="mini-overlay" onClick={onClose} />
      <div className="mini" style={{ left: data.x, top: data.y }} onClick={e => e.stopPropagation()}>
        <div className="mini-banner" />
        <div className="mini-av">
          <Avatar name={data.name} url={data.avatarUrl} size={72} />
          <span className="mini-av-status"><StatusDot status={data.status} size={18} /></span>
        </div>
        <div className="mini-body">
          <div className="mini-name">{data.name}</div>
          <div className="mini-status"><StatusDot status={data.status} size={10} /> {STATUS_LABEL[data.status]}</div>
          {data.role === 'owner' && <div className="mini-role">👑 Владелец</div>}
          {onMessage && <button className="mini-msg" onClick={onMessage}>Написать</button>}
        </div>
      </div>
    </>
  )
}
