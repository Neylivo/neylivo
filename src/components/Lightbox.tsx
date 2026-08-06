import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyMedia, copyMediaLink, saveMedia } from '../lib/copyMedia'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { useClampToViewport } from '../lib/clampPos'
import { openSafely } from '../lib/safeUrl'
import {
  zoomStart, zoomAt, clampPan, clampZoom, pinchZoom, dist, mid, toggleZoomAt, wasDragged,
  ZOOM_MIN, ZOOM_MAX, type ZoomState,
} from '../lib/zoomPan'

import { daysAgo } from '../lib/ui'

export interface LightboxMeta { name: string; avatar?: string | null; at?: string | null }

// «Вчера, в 21:13» — как подписывает время Discord в просмотрщике.
//
// v1.504.0: добавилось «Позавчера», и дни считает общая daysAgo. Своя мерка
// здесь была по МИЛЛИСЕКУНДАМ от полуночи, и на позавчера её пришлось бы
// растить вторым вычитанием суток — а это ровно тот способ, которым такие
// подписи и ошибаются на границе полуночи.
function whenLabel(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const дней = daysAgo(d)
  if (дней <= 0) return 'Сегодня, в ' + hm
  if (дней === 1) return 'Вчера, в ' + hm
  if (дней === 2) return 'Позавчера, в ' + hm
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', в ' + hm
}

// Полноэкранный просмотрщик изображений в стиле Discord (v1.16.0):
// картинка крупно по центру поверх затемнённого приложения, слева сверху —
// автор и время сообщения, справа сверху — панель инструментов
// (зум, скачать, открыть в браузере, «…», закрыть). Esc/клик мимо — закрыть.
// v1.82.0: правый клик по картинке — контекстное меню 1-в-1 как в Discord
// («Копировать изображение», «Сохранить изображение», «Копировать ссылку на
// медиа», «Открыть ссылку на медиафайл»).
export function Lightbox({ url, meta, onClose }: { url: string; meta?: LightboxMeta; onClose: () => void }) {
  /**
   * v1.431.0: приближение стало нормальным.
   *
   * Было: колесо меняло масштаб от центра картинки, и сдвинуть её было нельзя
   * вообще — приблизил, а нужный угол уехал за экран и достать его нечем. На
   * телефоне не было и этого: щипок двумя пальцами просмотрщик не понимал.
   *
   * Стало: приближение К ТОЧКЕ (под курсором, между пальцами, по двойному
   * щелчку), перетаскивание пальцем и мышью, щипок, границы — картинку нельзя
   * выбросить за экран. Вся арифметика в lib/zoomPan.ts и проверяется отдельно:
   * промах в знаке там уводит картинку в сторону, а глазами это не поймать.
   */
  const [view, setView] = useState<ZoomState>(zoomStart)
  const zoom = view.zoom
  const [more, setMore] = useState(false)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  // Размер «на весь экран»: любая картинка (даже крошечная гифка) растягивается
  // до ~92vw x 86vh с сохранением пропорций — 1-в-1 как просмотрщик Discord.
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const ctxClamp = useClampToViewport(ctx?.x ?? 0, ctx?.y ?? 0)

  function computeFit() {
    const img = imgRef.current
    if (!img || !img.naturalWidth || !img.naturalHeight) return
    const vw = window.innerWidth * 0.92
    const vh = window.innerHeight * 0.86
    const s = Math.min(vw / img.naturalWidth, vh / img.naturalHeight)
    setFit({ w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) })
  }

  // Окно растянули/сжали — пересчитываем размер картинки.
  useEffect(() => {
    window.addEventListener('resize', computeFit)
    return () => window.removeEventListener('resize', computeFit)
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ctx ? setCtx(null) : onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose, ctx])

  // Новая картинка — зум, размер и меню сбрасываются.
  useEffect(() => { setView(zoomStart); setMore(false); setFit(null); setCtx(null) }, [url])

  /** Точка события относительно центра картинки — в этой системе живёт сдвиг. */
  function atCenter(clientX: number, clientY: number) {
    const box = wrapRef.current?.getBoundingClientRect()
    const cx = box ? box.left + box.width / 2 : window.innerWidth / 2
    const cy = box ? box.top + box.height / 2 : window.innerHeight / 2
    return { px: clientX - cx, py: clientY - cy }
  }

  /**
   * Свести масштаб и сдвиг в границы: делается после каждого изменения.
   *
   * Размер картинки берём с самого элемента (offsetWidth), а не из состояния
   * fit: пока оно не посчитано, там ноль — и тогда границы обнуляли ЛЮБОЙ сдвиг,
   * то есть приближение к точке и перетаскивание молча не работали. Это видно
   * только по числам, и нашлось именно так: в стенде трансформ оставался без
   * сдвига при любом жесте.
   */
  const fix = (st: ZoomState): ZoomState => {
    const el = imgRef.current
    const w = el?.offsetWidth || fit?.w || 0
    const h = el?.offsetHeight || fit?.h || 0
    return clampPan(st, window.innerWidth, window.innerHeight, w, h)
  }

  function wheel(e: React.WheelEvent) {
    e.stopPropagation()
    e.preventDefault()
    const { px, py } = atCenter(e.clientX, e.clientY)
    // Шаг мягче прежнего: колесом обычно доводят, а не прыгают.
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setView(v => fix(zoomAt(v, factor, px, py)))
  }

  // ── Пальцы и мышь ───────────────────────────────────────────────────────
  // Держим все нажатые указатели: один — перетаскивание, два — щипок. Так же
  // это устроено в фотопросмотрщиках телефона, и другого способа отличить
  // щипок от перетаскивания нет.
  const ptsRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const dragRef = useRef<{ x: number; y: number; from: ZoomState; moved: number } | null>(null)
  const pinchRef = useRef<{ d: number; zoom: number } | null>(null)
  const movedRef = useRef(false)

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    ptsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    movedRef.current = false
    if (ptsRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY, from: view, moved: 0 }
      pinchRef.current = null
    } else if (ptsRef.current.size === 2) {
      const [a, b] = [...ptsRef.current.values()]
      pinchRef.current = { d: dist(a.x, a.y, b.x, b.y), zoom: view.zoom }
      dragRef.current = null
    }
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* не поддерживается */ }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!ptsRef.current.has(e.pointerId)) return
    ptsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (ptsRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...ptsRef.current.values()]
      const now = dist(a.x, a.y, b.x, b.y)
      const z = pinchZoom(pinchRef.current.zoom, pinchRef.current.d, now)
      const m = mid(a.x, a.y, b.x, b.y)
      const { px, py } = atCenter(m.x, m.y)
      movedRef.current = true
      setView(v => fix(zoomAt({ ...v, zoom: v.zoom }, z / v.zoom, px, py)))
      return
    }

    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!movedRef.current && wasDragged(dx, dy)) movedRef.current = true
    if (!movedRef.current) return
    // Двигаем только приближённую картинку: иначе случайное движение мышью по
    // вписанной картинке сдвигало бы её без причины.
    if (d.from.zoom <= 1.01) return
    setView(fix({ zoom: d.from.zoom, x: d.from.x + dx, y: d.from.y + dy }))
  }

  function onPointerUp(e: React.PointerEvent) {
    ptsRef.current.delete(e.pointerId)
    if (ptsRef.current.size < 2) pinchRef.current = null
    if (ptsRef.current.size === 0) dragRef.current = null
  }

  // Правый клик по картинке — меню как в Discord.
  function onImgCtx(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    setMore(false)
    setCtx({ x: e.clientX, y: e.clientY })
  }

  // Портал в document.body: просмотрщик всегда поверх всего приложения,
  // никакие transform/animation у родителей не ломают fixed-подложку.
  return createPortal(
    // Перетаскивание из просмотрщика запрещено: случайный drag гифки раньше
    // «ронял» её в чат как новое вложение через зону дропа файлов.
    <div className="lightbox" onClick={() => { if (!movedRef.current) onClose() }} onWheel={wheel}
      onDragStart={e => e.preventDefault()}
      onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
      onDrop={e => { e.preventDefault(); e.stopPropagation() }}>
      {meta && <div className="lb-author" onClick={e => e.stopPropagation()}>
        <Avatar name={meta.name} url={meta.avatar} size={40} />
        <div className="lb-author-t">
          <div className="lb-author-nm">{meta.name}</div>
          {meta.at && <div className="lb-author-at">{whenLabel(meta.at)}</div>}
        </div>
      </div>}
      <div className="lb-tools" onClick={e => e.stopPropagation()}>
        <button title="Приблизить" disabled={zoom >= ZOOM_MAX}
          onClick={() => setView(v => fix(zoomAt(v, 1.5, 0, 0)))}><Icon name="zoom-in" size={18} /></button>
        <button title="Отдалить" disabled={zoom <= ZOOM_MIN}
          onClick={() => setView(v => fix(zoomAt(v, 1 / 1.5, 0, 0)))}><Icon name="zoom-out" size={18} /></button>
        <button title="Скачать" onClick={() => saveMedia(url)}><Icon name="download" size={18} /></button>
        <button title="Открыть в браузере" onClick={() => openSafely(url)}><Icon name="external" size={18} /></button>
        <div className="lb-more-wrap">
          <button title="Ещё" onClick={() => setMore(v => !v)}><Icon name="dots" size={18} /></button>
          {more && <div className="lb-more">
            <button onClick={() => { setMore(false); copyMedia(url) }}>Скопировать картинку</button>
            <button onClick={() => { setMore(false); copyMediaLink(url) }}>Скопировать ссылку</button>
            <button onClick={() => { setMore(false); setView(zoomStart) }}>Сбросить масштаб</button>
          </div>}
        </div>
        <span className="lb-tools-sep" />
        <button title="Закрыть (Esc)" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      {/* Обёртка нужна для двух вещей: от неё считается центр (в нём живёт сдвиг)
          и она перехватывает жесты — на самой картинке браузер норовит начать
          своё выделение или своё «умное» приближение. */}
      <div className="lb-stage" ref={wrapRef} onClick={e => e.stopPropagation()}>
        <img ref={imgRef} src={url} alt="" crossOrigin="anonymous"
          draggable={false}
          onDragStart={e => e.preventDefault()}
          className={'lb-img' + (fit ? ' lb-fit' : '') + (zoom > 1.01 ? ' zoomed' : '')}
          style={{
            width: fit?.w, height: fit?.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
          onLoad={computeFit}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={onImgCtx}
          onDoubleClick={e => {
            e.stopPropagation()
            const { px, py } = atCenter(e.clientX, e.clientY)
            setView(v => fix(toggleZoomAt(v, px, py)))
          }} />
      </div>
      {zoom > 1.01 && <span className="lightbox-zoom" onClick={e => { e.stopPropagation(); setView(zoomStart) }}
        title="Сбросить масштаб (двойной щелчок по картинке)">{Math.round(zoom * 100)}%</span>}
      {ctx && <>
        <div className="lb-ctx-ov" onClick={e => { e.stopPropagation(); setCtx(null) }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx(null) }} />
        <div className="lb-ctx" ref={ctxClamp.ref} style={ctxClamp.style} onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}>
          <button onClick={() => { setCtx(null); copyMedia(url) }}>Копировать изображение</button>
          <button onClick={() => { setCtx(null); saveMedia(url) }}>Сохранить изображение</button>
          <div className="lb-ctx-sep" />
          <button onClick={() => { setCtx(null); copyMediaLink(url) }}>Копировать ссылку на медиа</button>
          <button onClick={() => { setCtx(null); openSafely(url.replace('#spoiler', '')) }}>Открыть ссылку на медиафайл</button>
        </div>
      </>}
    </div>,
    document.body,
  )
}
