
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status } from '../lib/presence'

export function AvatarWithStatus({ name, url, size = 32, status }:
  { name: string; url?: string | null; size?: number; status?: Status }) {
  return (
    <span className="av-wrap" style={{ width: size, height: size }}>
      <Avatar name={name} url={url} size={size} />
      {status && <span className="av-status"><StatusDot status={status} size={Math.max(10, size * 0.32)} title /></span>}
    </span>
  )
}
