import { useRef } from 'react'
import type { ProfilePrefs, PetFree } from '../lib/profilePrefs'

export type PetCard = 'mini' | 'big'

// Питомец профиля (фото/GIF/видео/3D). v1.54.0:
// - при позициях «Сверху…» питомец стоит на нижней кромке баннера, как в Discord;
// - 3D-модель (.glb/.gltf) можно вращать мышью в любом месте, где виден профиль;
// - режим «Свободно» хранит независимые позиции для мини- и большого профиля,
//   а в настройках питомца можно перетаскивать прямо на превью (onFreeMove).
export function ProfilePet({ p, scale = 1, card = 'mini', bannerH, onFreeMove }: {
  p: ProfilePrefs; scale?: number; card?: PetCard; bannerH?: number
  onFreeMove?: (card: PetCard, pos: PetFree, done: boolean) => void
}) {
  const dragging = useRef(false)
  const lastPos = useRef<PetFree | null>(null)
  if (!p.petOn || !p.petUrl || p.petKind === 'none') return null
  const size = Math.round(p.petSize * scale)

  let pos: React.CSSProperties
  if (p.petPos === 'free') {
    const f = card === 'big' ? p.petFree.big : p.petFree.mini
    pos = { position: 'absolute', left: f.x + '%', top: f.y + '%', transform: 'translate(-50%, -50%)' }
  } else if (p.petPos === 'above') {
    pos = { position: 'absolute', left: '50%', bottom: '100%', transform: 'translateX(-50%)' }
  } else if (p.petPos === 'tr' || p.petPos === 'tl') {
    // «стоит» на баннере: нижний край питомца совпадает с нижней кромкой баннера
    const top = bannerH != null ? Math.max(2, Math.round(bannerH - size)) : 8
    pos = p.petPos === 'tr' ? { position: 'absolute', right: 12, top } : { position: 'absolute', left: 12, top }
  } else {
    pos = p.petPos === 'br' ? { position: 'absolute', right: 8, bottom: 8 } : { position: 'absolute', left: 8, bottom: 8 }
  }

  const style: React.CSSProperties = {
    ...pos, width: size, height: size, borderRadius: 12, overflow: 'hidden',
    pointerEvents: p.petKind === 'model' ? 'auto' : 'none', zIndex: 5,
  }

  let media: JSX.Element
  if (p.petKind === 'video') media = <video style={style} src={p.petUrl} autoPlay loop muted playsInline />
  else if (p.petKind === 'model') {
    media = (
      // @ts-ignore - <model-viewer> is a web component
      <model-viewer style={style as any} src={p.petUrl} auto-rotate camera-controls disable-zoom interaction-prompt="none" />
    )
  }
  else media = <img style={style} src={p.petUrl} alt="pet" />

  const draggable = !!onFreeMove && p.petPos === 'free'
  if (!draggable) return media

  function calc(e: React.PointerEvent): PetFree | null {
    const host = (e.currentTarget as HTMLElement).parentElement
    if (!host) return null
    const r = host.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    }
  }
  return <>
    {media}
    <div style={{ ...pos, width: size, height: size, zIndex: 7, cursor: 'grab', touchAction: 'none' }}
      title="Тащи, чтобы переставить питомца"
      onPointerDown={e => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
      onPointerMove={e => { if (!dragging.current) return; const np = calc(e); if (np) { lastPos.current = np; onFreeMove!(card, np, false) } }}
      onPointerUp={() => { if (!dragging.current) return; dragging.current = false; if (lastPos.current) onFreeMove!(card, lastPos.current, true) }} />
  </>
}
