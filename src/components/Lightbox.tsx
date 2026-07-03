import { useEffect } from 'react'

// Полноэкранный просмотр изображения: мягкое затемнение фона,
// закрытие кликом в любую точку за пределами картинки или по Escape.
export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={url} alt="" onClick={e => e.stopPropagation()} />
      <a className="lightbox-orig" href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Открыть оригинал</a>
    </div>
  )
}
