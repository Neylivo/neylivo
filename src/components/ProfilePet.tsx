import { useRef, useState } from 'react'
import type { ProfilePrefs, PetFree } from '../lib/profilePrefs'

export type PetCard = 'mini' | 'big'

const BURST_EMOJI = ['✨', '💖', '⭐', '💫']
const BURST_DELAY_MS = 60     // ступень задержки между частицами — держать в паре с --pb-i в styles.css
const BURST_ANIM_MS = 650     // должно совпадать с длительностью @keyframes pet-burst в styles.css
const BURST_TOTAL_MS = (BURST_EMOJI.length - 1) * BURST_DELAY_MS + BURST_ANIM_MS

// Питомец профиля (фото/GIF/видео/3D). v1.54.0:
// - при позициях «Сверху…» питомец стоит на нижней кромке баннера, как в Discord;
// - 3D-модель (.glb/.gltf) можно вращать мышью в любом месте, где виден профиль;
// - режим «Свободно» (v1.57.0) хранит ОДНУ позицию в % от карточки: куда поставил,
//   там питомец и стоит ВО ВСЕХ местах показа профиля — независимо от размера и
//   положения карточки. В настройках можно перетаскивать прямо на превью (onFreeMove).
// - v1.247.0: клик по питомцу (вне режима перетаскивания в настройках) запускает
//   короткую реакцию — прыжок/кручение/пульс/эмодзи-всплеск (petReaction, 'none' —
//   не реагирует). Чисто декоративно, ничего никуда не сохраняет.
// - v1.256.0: «Свободно» раньше считало x%/y% от ВСЕЙ карточки профиля — а высота
//   карточки (MiniProfile.tsx/ProfileCard.tsx) меняется в зависимости от того,
//   показана ли сейчас активность (игра/музыка/свой статус): эти блоки — обычные
//   элементы в потоке, они РАСТЯГИВАЮТ карточку, а не лежат поверх неё. Тот же %
//   от разной высоты — разное место на экране: то же самое место дрожало/съезжало,
//   стоило появиться или исчезнуть строке активности. Теперь «Свободно» считается
//   от ФИКСИРОВАННОЙ зоны шапки (баннер + немного под аватар, freeZoneH ниже) —
//   она не зависит от того, что показано в карточке дальше вниз.
export function ProfilePet({ p, scale = 1, card = 'mini', bannerH, onFreeMove }: {
  p: ProfilePrefs; scale?: number; card?: PetCard; bannerH?: number
  onFreeMove?: (card: PetCard, pos: PetFree, done: boolean) => void
}) {
  const dragging = useRef(false)
  const lastPos = useRef<PetFree | null>(null)
  const [reacting, setReacting] = useState(false)
  if (!p.petOn || !p.petUrl || p.petKind === 'none') return null
  const size = Math.round(p.petSize * scale)

  let pos: React.CSSProperties
  if (p.petPos === 'free') {
    const f = p.petFree
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

  const draggable = !!onFreeMove && p.petPos === 'free'
  const reaction = p.petReaction ?? 'bounce'
  const clickable = !draggable && reaction !== 'none'
  const animClass = reacting && reaction !== 'burst' ? ' pet-react-' + reaction : ''
  // v1.256.0: высота зоны, от которой считаются проценты «Свободно» — банер плюс
  // немного места под аватар (не вся карточка, см. комментарий выше). bannerH
  // может не прийти (старые вызовы) — тогда разумная по умолчанию высота.
  const freeZoneH = (bannerH ?? 100) + Math.round(size * 0.6)

  // v1.247.0: позиционирование (pos, включая translate(-50%,-50%) для «Свободно») —
  // на ВНЕШНЕЙ обёртке; сама реакция (scale/rotate и т.п.) — на ВНУТРЕННЕМ элементе.
  // Раньше оба transform'а сидели на одном узле — анимация реакции перезаписывала
  // бы transform позиционирования, и питомец на секунду прыгал бы не в тот угол.
  const style: React.CSSProperties = { ...pos, width: size, height: size, zIndex: 5 }
  const mediaStyle: React.CSSProperties = {
    width: '100%', height: '100%', display: 'block', borderRadius: 12, overflow: 'hidden',
    pointerEvents: (p.petKind === 'model' || clickable) ? 'auto' : 'none',
    cursor: clickable ? 'pointer' : undefined,
  }
  // Всплеск — 4 частицы со своей задержкой (BURST_DELAY_MS ниже), их общая
  // длительность известна заранее, поэтому чистим таймером, а не onAnimationEnd:
  // это событие всплывает от КАЖДОЙ частицы по очереди, и первое (самой ранней,
  // не самой поздней) убрало бы контейнер, оборвав анимацию остальных на середине.
  const onReactClick = clickable ? (e: React.SyntheticEvent) => {
    e.stopPropagation(); setReacting(true)
    if (reaction === 'burst') window.setTimeout(() => setReacting(false), BURST_TOTAL_MS)
  } : undefined
  const onReactEnd = () => setReacting(false)

  let mediaInner: JSX.Element
  if (p.petKind === 'video') mediaInner = <video className={animClass} style={mediaStyle} src={p.petUrl} autoPlay loop muted playsInline onClick={onReactClick} onAnimationEnd={onReactEnd} />
  else if (p.petKind === 'model') {
    mediaInner = (
      // @ts-ignore - <model-viewer> is a web component
      <model-viewer className={animClass} style={mediaStyle as any} src={p.petUrl} auto-rotate camera-controls disable-zoom
        interaction-prompt="none" onClick={onReactClick} onAnimationEnd={onReactEnd} />
    )
  }
  else mediaInner = <img className={animClass} style={mediaStyle} src={p.petUrl} alt="pet" onClick={onReactClick} onAnimationEnd={onReactEnd} />
  const media = <div style={style}>{mediaInner}</div>

  // v1.247.0: эмодзи-всплеск — отдельные летящие частицы поверх питомца (сам питомец
  // при этом не анимируется — animClass выше нарочно не включает 'burst' в media).
  // Снятие reacting — таймером в onReactClick (BURST_TOTAL_MS), не onAnimationEnd.
  const burst = reacting && reaction === 'burst' && (
    <div style={{ ...pos, width: size, height: size, zIndex: 6, pointerEvents: 'none' }}>
      {BURST_EMOJI.map((em, i) => (
        <span key={i} className="pet-burst-emoji" style={{ ['--pb-i' as any]: i, animationDelay: (i * BURST_DELAY_MS) + 'ms' }}>{em}</span>
      ))}
    </div>
  )

  const draggableLayer = draggable && (() => {
    function calc(e: React.PointerEvent): PetFree | null {
      const host = (e.currentTarget as HTMLElement).parentElement
      if (!host) return null
      const r = host.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
        y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
      }
    }
    return (
      <div style={{ ...pos, width: size, height: size, zIndex: 7, cursor: 'grab', touchAction: 'none', pointerEvents: 'auto' }}
        title="Тащи, чтобы переставить питомца"
        onPointerDown={e => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (!dragging.current) return; const np = calc(e); if (np) { lastPos.current = np; onFreeMove!(card, np, false) } }}
        onPointerUp={() => { if (!dragging.current) return; dragging.current = false; if (lastPos.current) onFreeMove!(card, lastPos.current, true) }} />
    )
  })()

  // v1.256.0: только «Свободно» заворачивается в свою зону стабильного размера —
  // остальные позиции (углы/«сверху») как и раньше считаются от родителя, который
  // даёт вызывающий компонент, их это не касается и ничего в их поведении не меняется.
  if (p.petPos === 'free') {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: freeZoneH, pointerEvents: 'none' }}>
        {media}{burst}{draggableLayer}
      </div>
    )
  }
  return <>{media}{burst}{draggableLayer}</>
}
