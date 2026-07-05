
import { Avatar } from './Avatar'
import { StatusDot } from './StatusDot'
import { Status } from '../lib/presence'

// v1.34.0: если пользователь сидит с телефона (mobile=true) и он не офлайн,
// вместо статусной точки показывается зелёный значок телефона — как в Discord.
// v1.102.0: userId прокидывается в Avatar — аватарка берётся из единого живого кэша профилей.
export function AvatarWithStatus({ name, url, size = 32, status, mobile, userId }:
  { name: string; url?: string | null; size?: number; status?: Status; mobile?: boolean; userId?: string | null }) {
  const ph = Math.max(12, Math.round(size * 0.44))
  return (
    <span className="av-wrap" style={{ width: size, height: size }}>
      <Avatar name={name} url={url} size={size} userId={userId} />
      {status && <span className="av-status">
        {mobile && status !== 'offline'
          ? <svg className="av-phone" width={ph} height={ph} viewBox="0 0 24 24" aria-label="С телефона"><rect x="6.5" y="1.5" width="11" height="21" rx="3" fill="#3ba55d" /><rect x="8.5" y="4.5" width="7" height="13" rx="1" fill="var(--bg2, #2b2d31)" /><circle cx="12" cy="19.6" r="1.2" fill="var(--bg2, #2b2d31)" /></svg>
          : <StatusDot status={status} size={Math.max(10, size * 0.32)} title />}
      </span>}
    </span>
  )
}
