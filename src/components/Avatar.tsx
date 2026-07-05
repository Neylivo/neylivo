import { useEffect, useRef } from 'react'
import { colorFor, initial } from '../lib/ui'
import { isVideoUrl, AVATAR_VIDEO_MAX_SEC } from '../lib/videoAvatar'

// Куда наводить мышь, чтобы видео-аватар ожил: ближайшая «карточка» пользователя
// (строка участника/ЛС, сообщение, попап профиля, панель пользователя, превью в настройках).
const HOVER_HOSTS = '.member, .dm-item, .msg, .mini, .me, .plate-prev, .pqs-acc-row, .fp-friend'

export function Avatar({ name, url, size = 40, cls = '' }: { name: string; url?: string | null; size?: number; cls?: string }) {
  const style: React.CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700,
    fontSize: size * 0.4, overflow: 'hidden' }
  const vref = useRef<HTMLVideoElement>(null)
  const vid = isVideoUrl(url)
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
  }, [vid, url])
  if (url && vid) return <span className={cls} style={{ ...style, background: '#000' }}>
    <video ref={vref} src={url} muted loop playsInline preload="metadata"
      onTimeUpdate={e => { const el = e.currentTarget; if (el.currentTime >= AVATAR_VIDEO_MAX_SEC) el.currentTime = 0 }}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  </span>
  if (url) return <span className={cls} style={{ ...style, background: '#000' }}><img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>
  return <span className={cls} style={{ ...style, background: colorFor(name) }}>{initial(name)}</span>
}
