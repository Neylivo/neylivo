import { colorFor, initial } from '../lib/ui'

export function Avatar({ name, url, size = 40, cls = '' }: { name: string; url?: string | null; size?: number; cls?: string }) {
  const style: React.CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700,
    fontSize: size * 0.4, overflow: 'hidden' }
  if (url) return <span className={cls} style={{ ...style, background: '#000' }}><img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>
  return <span className={cls} style={{ ...style, background: colorFor(name) }}>{initial(name)}</span>
}
