// v1.460.0: живой фон плеера — рисует узор из liveBg.ts и плавно его двигает.
//
// Почему обычными элементами и CSS, а не холстом. Холст рисуется постоянно и
// греет процессор, даже когда плеер свёрнут; движение из CSS считает браузер и
// умеет останавливать его сам, когда окно не видно.
//
// Уважение к настройке «без анимаций»: при ней узор просто стоит. Человек
// выключил движение не для того, чтобы у него шевелился фон.
import { useMemo } from 'react'
import { blobsFor, paletteOf } from './liveBg'
import { useSettings } from '../lib/settings'

export function LiveBg({ trackKey, accent }: { trackKey: string; accent?: string | null }) {
  const { settings } = useSettings()
  const анимации = settings.animations !== false
  const пятна = useMemo(() => blobsFor(trackKey, анимации ? 1 : 0), [trackKey, анимации])
  const цвета = useMemo(() => paletteOf(accent), [accent])

  return (
    <div className="mus-livebg" aria-hidden>
      {пятна.map((b, i) => (
        <span key={i} className={'mus-blob' + (анимации ? ' on' : '')} style={{
          left: (b.x * 100) + '%',
          top: (b.y * 100) + '%',
          width: (b.r * 100) + '%',
          paddingBottom: (b.r * 100) + '%',
          background: цвета[i % цвета.length],
          opacity: b.alpha,
          // Своя длительность и свой сдвиг у каждого пятна: иначе они ходят
          // строем, и это сразу видно как «анимация», а не как живой фон.
          animationDuration: b.dur ? b.dur + 's' : undefined,
          animationDelay: b.dur ? b.delay + 's' : undefined,
          ['--amp' as any]: (b.amp * 100) + '%',
        }} />
      ))}
    </div>
  )
}
