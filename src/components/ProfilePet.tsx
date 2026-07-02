import type { ProfilePrefs } from '../lib/profilePrefs'

const POS_STYLE: Record<string, React.CSSProperties> = {
  above: { position: 'absolute', left: '50%', bottom: '100%', transform: 'translateX(-50%)' },
  br: { position: 'absolute', right: 8, bottom: 8 },
  bl: { position: 'absolute', left: 8, bottom: 8 },
  tr: { position: 'absolute', right: 8, top: 8 },
  tl: { position: 'absolute', left: 8, top: 8 },
  free: { position: 'absolute', right: 8, bottom: 8 },
}

// Renders the "profile pet" media (image/gif/video/3D model) in a profile card corner.
export function ProfilePet({ p, scale = 1 }: { p: ProfilePrefs; scale?: number }) {
  if (!p.petOn || !p.petUrl || p.petKind === 'none') return null
  const size = Math.round(p.petSize * scale)
  const style: React.CSSProperties = { ...POS_STYLE[p.petPos], width: size, height: size, borderRadius: 12, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }
  if (p.petKind === 'video') return <video style={style} src={p.petUrl} autoPlay loop muted playsInline />
  if (p.petKind === 'model') return (
    // @ts-ignore - <model-viewer> is a web component
    <model-viewer style={style as any} src={p.petUrl} auto-rotate camera-controls disable-zoom />
  )
  return <img style={style} src={p.petUrl} alt="pet" />
}
