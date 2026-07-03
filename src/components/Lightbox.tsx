import { useEffect, useRef, useState } from 'react'
import { toastOk, toastErr } from '../lib/toast'
import { Icon } from './icons'

// Полноэкранный просмотр изображения: затемнение, Escape/клик мимо — закрыть,
// колёсико и двойной клик — зум, кнопки «Скопировать» и «Скачать».
export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  // Новая картинка — зум сбрасывается.
  useEffect(() => { setZoom(1) }, [url])

  function wheel(e: React.WheelEvent) {
    e.stopPropagation()
    setZoom(z => Math.min(4, Math.max(0.25, +(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3))))
  }

  // Копирование картинки в буфер обмена: через canvas в PNG (clipboard принимает только PNG).
  async function copyImage(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const img = imgRef.current
      if (!img || !('ClipboardItem' in window)) throw new Error('Буфер обмена недоступен')
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const cx = cv.getContext('2d')
      if (!cx) throw new Error('Canvas недоступен')
      cx.drawImage(img, 0, 0)
      const blob: Blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Не удалось получить изображение')), 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toastOk('Картинка скопирована')
    } catch (err: any) { toastErr(err?.message ?? 'Не удалось скопировать') }
  }

  // Скачивание: тянем blob и отдаём как файл, чтобы браузер не открывал вкладку.
  async function download(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const r = await fetch(url)
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'image')
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch { toastErr('Не удалось скачать файл') }
  }

  return (
    <div className="lightbox" onClick={onClose} onWheel={wheel}>
      <img ref={imgRef} src={url} alt="" crossOrigin="anonymous"
        style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => { e.stopPropagation(); setZoom(z => z === 1 ? 2 : 1) }} />
      {zoom !== 1 && <span className="lightbox-zoom" onClick={e => { e.stopPropagation(); setZoom(1) }} title="Сбросить масштаб">{Math.round(zoom * 100)}%</span>}
      <div className="lightbox-bar" onClick={e => e.stopPropagation()}>
        <button type="button" title="Скопировать картинку" onClick={copyImage}><Icon name="copy" size={16} /> Скопировать</button>
        <button type="button" title="Скачать файл" onClick={download}><Icon name="paperclip" size={16} /> Скачать</button>
        <a href={url} target="_blank" rel="noreferrer">Открыть оригинал</a>
      </div>
    </div>
  )
}
