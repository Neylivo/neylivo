import { useEffect, useRef } from 'react'
import { AVATAR_VIDEO_MAX_SEC } from '../lib/videoAvatar'

// Фон «кубика» (nameplate): фото или видео до 5 сек. Видео крутится в цикле
// только при наведении мыши на строку (экономим ресурсы), иначе стоит первый кадр.
export function PlateBg({ url, kind }: { url: string; kind: string }) {
  const vref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = vref.current
    if (!v) return
    const host = (v.closest('.member, .me, .plate-prev') as HTMLElement) ?? v
    const play = () => { v.play().catch(() => {}) }
    const stop = () => { v.pause(); try { v.currentTime = 0 } catch {} }
    host.addEventListener('mouseenter', play)
    host.addEventListener('mouseleave', stop)
    return () => { host.removeEventListener('mouseenter', play); host.removeEventListener('mouseleave', stop) }
  }, [url])
  if (kind === 'video') return <video ref={vref} className="plate-bg" src={url} muted loop playsInline preload="metadata"
    onTimeUpdate={e => { const el = e.currentTarget; if (el.currentTime >= AVATAR_VIDEO_MAX_SEC) el.currentTime = 0 }} />
  return <img className="plate-bg" src={url} alt="" />
}
