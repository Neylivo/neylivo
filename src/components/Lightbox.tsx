import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyMedia, copyMediaLink, saveMedia } from '../lib/copyMedia'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { useClampToViewport } from '../lib/clampPos'

export interface LightboxMeta { name: string; avatar?: string | null; at?: string | null }

// «Вчера, в 21:13» — как подписывает время Discord в просмотрщике.
function whenLabel(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (t >= midnight) return 'Сегодня, в ' + hm
  if (t >= midnight - 86400000) return 'Вчера, в ' + hm
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
  const [zoom, setZoom] = useState(1)
  const [more, setMore] = useState(false)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  // Размер «на весь экран»: любая картинка (даже крошечная гифка) растягивается
  // до ~92vw x 86vh с сохранением пропорций — 1-в-1 как просмотрщик Discord.
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
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
  useEffect(() => { setZoom(1); setMore(false); setFit(null); setCtx(null) }, [url])

  function wheel(e: React.WheelEvent) {
    e.stopPropagation()
    setZoom(z => Math.min(4, Math.max(0.25, +(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3))))
  }

  // Правый клик по картинке — меню как в Discord.
  function onImgCtx(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    setMore(false)
    setCtx({ x: Math.min(e.clientX, window.innerWidth - 246), y: Math.min(e.clientY, window.innerHeight - 172) })
  }

  // Портал в document.body: просмотрщик всегда поверх всего приложения,
  // никакие transform/animation у родителей не ломают fixed-подложку.
  return createPortal(
    // Перетаскивание из просмотрщика запрещено: случайный drag гифки раньше
    // «ронял» её в чат как новое вложение через зону дропа файлов.
    <div className="lightbox" onClick={onClose} onWheel={wheel}
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
        <button title="Приблизить" onClick={() => setZoom(z => Math.min(4, +(z * 1.5).toFixed(3)))}><Icon name="zoom-in" size={18} /></button>
        <button title="Скачать" onClick={() => saveMedia(url)}><Icon name="download" size={18} /></button>
        <button title="Открыть в браузере" onClick={() => window.open(url, '_blank')}><Icon name="external" size={18} /></button>
        <div className="lb-more-wrap">
          <button title="Ещё" onClick={() => setMore(v => !v)}><Icon name="dots" size={18} /></button>
          {more && <div className="lb-more">
            <button onClick={() => { setMore(false); copyMedia(url) }}>Скопировать картинку</button>
            <button onClick={() => { setMore(false); copyMediaLink(url) }}>Скопировать ссылку</button>
            <button onClick={() => { setMore(false); setZoom(1) }}>Сбросить масштаб</button>
          </div>}
        </div>
        <span className="lb-tools-sep" />
        <button title="Закрыть (Esc)" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <img ref={imgRef} src={url} alt="" crossOrigin="anonymous"
        draggable={false}
        onDragStart={e => e.preventDefault()}
        className={fit ? 'lb-fit' : undefined}
        style={{ width: fit?.w, height: fit?.h, transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
        onLoad={computeFit}
        onClick={e => e.stopPropagation()}
        onContextMenu={onImgCtx}
        onDoubleClick={e => { e.stopPropagation(); setZoom(z => z === 1 ? 2 : 1) }} />
      {zoom !== 1 && <span className="lightbox-zoom" onClick={e => { e.stopPropagation(); setZoom(1) }} title="Сбросить масштаб">{Math.round(zoom * 100)}%</span>}
      {ctx && <>
        <div className="lb-ctx-ov" onClick={e => { e.stopPropagation(); setCtx(null) }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx(null) }} />
        <div className="lb-ctx" ref={ctxClamp.ref} style={ctxClamp.style} onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}>
          <button onClick={() => { setCtx(null); copyMedia(url) }}>Копировать изображение</button>
          <button onClick={() => { setCtx(null); saveMedia(url) }}>Сохранить изображение</button>
          <div className="lb-ctx-sep" />
          <button onClick={() => { setCtx(null); copyMediaLink(url) }}>Копировать ссылку на медиа</button>
          <button onClick={() => { setCtx(null); window.open(url.replace('#spoiler', ''), '_blank') }}>Открыть ссылку на медиафайл</button>
        </div>
      </>}
    </div>,
    document.body,
  )
}
