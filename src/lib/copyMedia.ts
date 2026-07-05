import { toastOk, toastErr } from './toast'

// v1.91.0: копирование стало надёжным на всех платформах.
// - В десктоп-приложении текст и картинки кладутся в СИСТЕМНЫЙ буфер через
//   нативный мост Electron (ponoiDesktop.copyText/copyImage) — браузерный API
//   в Electron мог молча отказывать («document is not focused», file://).
// - В Safari/iOS (PWA) в ClipboardItem передаётся ПРОМИС блоба: запись
//   стартует в тот же клик, иначе Safari считает жест «протухшим» и молча
//   ничего не копирует.
// - Везде есть запасной путь: скрытая textarea + execCommand('copy').

type DesktopBridge = {
  copyText?: (t: string) => Promise<boolean>
  copyImage?: (dataUrl: string) => Promise<boolean>
}
const desktop = (): DesktopBridge | null => (window as any).ponoiDesktop ?? null

// Универсальное копирование текста с фолбэками. Тосты показывает сам.
export async function copyText(text: string, okMsg = 'Скопировано'): Promise<boolean> {
  const d = desktop()
  if (d?.copyText) {
    try { if (await d.copyText(text)) { toastOk(okMsg); return true } } catch {}
  }
  try { await navigator.clipboard.writeText(text); toastOk(okMsg); return true } catch {}
  if (legacyCopy(text)) { toastOk(okMsg); return true }
  toastErr('Не удалось скопировать')
  return false
}

// Старый добрый execCommand — работает даже там, где Clipboard API недоступен.
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px'
    ta.setAttribute('readonly', '')
    document.body.appendChild(ta)
    ta.select(); ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

// Универсальное копирование медиа — кнопка «Копировать» копирует что угодно.
// PNG кладём как есть; JPEG/WebP/GIF конвертируем в PNG (буфер обмена
// принимает только PNG); если не вышло — копируем ссылку, чтобы кнопка
// НИКОГДА не оставалась без результата.
export async function copyMedia(url: string): Promise<void> {
  const clean = url.replace('#spoiler', '')
  const d = desktop()
  if (d?.copyImage) {
    // Десктоп: конвертируем и отдаём в main-процесс — системный буфер, без капризов.
    try {
      const blob = await (await fetch(clean)).blob()
      const png = blob.type === 'image/png' ? blob : await toPng(blob)
      const dataUrl = await blobToDataUrl(png)
      if (await d.copyImage(dataUrl)) { toastOk('Изображение скопировано'); return }
    } catch {}
  } else if ('ClipboardItem' in window && navigator.clipboard?.write) {
    // Веб/PWA: ClipboardItem получает промис — Safari требует, чтобы запись
    // начиналась в том же жесте пользователя, без await до вызова write().
    try {
      const pngPromise: Promise<Blob> = fetch(clean)
        .then(r => r.blob())
        .then(b => (b.type === 'image/png' ? b : toPng(b)))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })])
      toastOk('Изображение скопировано')
      return
    } catch {}
  }
  // Картинку положить не удалось (экзотический формат, CORS, видео) — копируем ссылку.
  await copyText(clean, 'Формат не кладётся в буфер — скопирована ссылка')
}

async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const cv = document.createElement('canvas')
  cv.width = bmp.width; cv.height = bmp.height
  cv.getContext('2d')!.drawImage(bmp, 0, 0)
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('fail')), 'image/png'))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error('fail'))
    fr.readAsDataURL(blob)
  })
}

// Копирование ссылки на медиафайл.
export async function copyMediaLink(url: string): Promise<void> {
  await copyText(url.replace('#spoiler', ''), 'Ссылка скопирована')
}

// Сохранение медиа как файла (blob, чтобы браузер не открывал вкладку).
export async function saveMedia(url: string): Promise<void> {
  const clean = url.replace('#spoiler', '')
  try {
    const r = await fetch(clean)
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = decodeURIComponent(clean.split('/').pop()?.split('?')[0] ?? 'image')
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  } catch { toastErr('Не удалось сохранить файл') }
}
