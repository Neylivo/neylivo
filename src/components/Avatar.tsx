
import { useEffect, useRef } from 'react'
import { colorFor, initial } from '../lib/ui'
import { isVideoUrl, AVATAR_VIDEO_MAX_SEC } from '../lib/videoAvatar'
import { useAvatarOf } from '../lib/avatars'

// Куда наводить мышь, чтобы видео-аватар ожил: ближайшая «карточка» пользователя
// (строка участника/ЛС, сообщение, попап профиля, панель пользователя, превью в настройках).
const HOVER_HOSTS = '.member, .dm-item, .msg, .mini, .me, .plate-prev, .pqs-acc-row, .fp-friend, .an-card, .pfr-row'

export function Avatar({ name, url, size = 40, cls = '', userId }:
  { name: string; url?: string | null; size?: number; cls?: string; userId?: string | null }) {
  // v1.102.0: единый источник аватарок. Если передан userId, актуальная аватарка из живого
  // кэша профилей имеет приоритет над «замороженной» копией url (например, в старых сообщениях) —
  // так аватарки для всех и везде отображаются одинаково и обновляются сразу при смене.
  const live = useAvatarOf(userId)
  const src = live !== undefined ? live : (url ?? null)
  const style: React.CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700,
    fontSize: size * 0.4, overflow: 'hidden' }
  const vref = useRef<HTMLVideoElement>(null)
  const vid = isVideoUrl(src)
  // v1.95.0: видео-аватар (<=5 сек) проигрывается в цикле только при наведении — чтобы не нагружать.
  useEffect(() => {
    const v = vref.current
    if (!v || !vid) return
    const host = (v.closest(HOVER_HOSTS) as HTMLElement) ?? v
    const play = () => { v.play().catch(() => {}) }
    const stop = () => { v.pause(); try { v.currentTime = 0 } catch {} }
    host.addEventListener('mouseenter', play)
    host.addEventListener('mouseleave', stop)
    return () => { host.removeEventListener('mouseenter', play); host.removeEventListener('mouseleave', stop) }
  }, [vid, src])
  if (src && vid) return <span className={cls} style={{ ...style, background: '#000' }}>
    <video ref={vref} src={src} muted loop playsInline preload="metadata"
      onTimeUpdate={e => { const el = e.currentTarget; if (el.currentTime >= AVATAR_VIDEO_MAX_SEC) el.currentTime = 0 }}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  </span>
  if (src) return <span className={cls} style={{ ...style, background: '#000' }}><img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>
  return <span className={cls} style={{ ...style, background: colorFor(name) }}>{initial(name)}</span>
}
