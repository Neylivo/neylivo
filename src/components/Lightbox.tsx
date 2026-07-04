import { useEffect, useRef, useState } from 'react'
import { toastOk, toastErr } from '../lib/toast'
import { Avatar } from './Avatar'
import { Icon } from './icons'

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
export function Lightbox({ url, meta, onClose }: { url: string; meta?: LightboxMeta; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [more, setMore] = useState(false)
  // Размер «на весь экран»: любая картинка (даже крошечная гифка) растягивается
  // до ~92vw x 86vh с сохранением пропорций — 1-в-1 как просмотрщик Discord.
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

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
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  // Новая картинка — зум и размер сбрасываются.
  useEffect(() => { setZoom(1); setMore(false); setFit(null) }, [url])

  function wheel(e: React.WheelEvent) {
    e.stopPropagation()
    setZoom(z => Math.min(4, Math.max(0.25, +(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3))))
  }

  // Копирование картинки в буфер обмена: через canvas в PNG (clipboard принимает только PNG).
  async function copyImage() {
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

  async function copyLink() {
    try { await navigator.clipboard.writeText(url); toastOk('Ссылка скопирована') }
    catch { toastErr('Не удалось скопировать ссылку') }
  }

  // Скачивание: тянем blob и отдаём как файл, чтобы браузер не открывал вкладку.
  async function download() {
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
      {meta && <div className="lb-author" onClick={e => e.stopPropagation()}>
        <Avatar name={meta.name} url={meta.avatar} size={40} />
        <div className="lb-author-t">
          <div className="lb-author-nm">{meta.name}</div>
          {meta.at && <div className="lb-author-at">{whenLabel(meta.at)}</div>}
        </div>
      </div>}
      <div className="lb-tools" onClick={e => e.stopPropagation()}>
        <button title="Приблизить" onClick={() => setZoom(z => Math.min(4, +(z * 1.5).toFixed(3)))}><Icon name="zoom-in" size={18} /></button>
        <button title="Скачать" onClick={download}><Icon name="download" size={18} /></button>
        <button title="Открыть в браузере" onClick={() => window.open(url, '_blank')}><Icon name="external" size={18} /></button>
        <div className="lb-more-wrap">
          <button title="Ещё" onClick={() => setMore(v => !v)}><Icon name="dots" size={18} /></button>
          {more && <div className="lb-more">
            <button onClick={() => { setMore(false); copyImage() }}>Скопировать картинку</button>
            <button onClick={() => { setMore(false); copyLink() }}>Скопировать ссылку</button>
            <button onClick={() => { setMore(false); setZoom(1) }}>Сбросить масштаб</button>
          </div>}
        </div>
        <span className="lb-tools-sep" />
        <button title="Закрыть (Esc)" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <img ref={imgRef} src={url} alt="" crossOrigin="anonymous"
        className={fit ? 'lb-fit' : undefined}
        style={{ width: fit?.w, height: fit?.h, transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
        onLoad={computeFit}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => { e.stopPropagation(); setZoom(z => z === 1 ? 2 : 1) }} />
      {zoom !== 1 && <span className="lightbox-zoom" onClick={e => { e.stopPropagation(); setZoom(1) }} title="Сбросить масштаб">{Math.round(zoom * 100)}%</span>}
    </div>
  )
}
