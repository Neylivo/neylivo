import { toastOk, toastErr } from './toast'

// v1.82.0: универсальное копирование медиа — кнопка «Копировать» копирует что
// угодно. PNG кладём в буфер как есть; JPEG/WebP/GIF и прочие форматы
// конвертируем в PNG через canvas (буфер обмена браузера принимает только
// PNG); если даже это не удалось (экзотический формат, CORS, видео) —
// копируем ссылку на файл, чтобы кнопка НИКОГДА не оставалась без результата.
export async function copyMedia(url: string): Promise<void> {
  const clean = url.replace('#spoiler', '')
  try {
    if (!('ClipboardItem' in window)) throw new Error('no-clipboard')
    const r = await fetch(clean)
    const blob = await r.blob()
    if (blob.type === 'image/png') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toastOk('Изображение скопировано')
      return
    }
    const png = await toPng(blob)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    toastOk('Изображение скопировано')
  } catch {
    try {
      await navigator.clipboard.writeText(clean)
      toastOk('Формат не кладётся в буфер — скопирована ссылка')
    } catch { toastErr('Не удалось скопировать') }
  }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const cv = document.createElement('canvas')
  cv.width = bmp.width; cv.height = bmp.height
  cv.getContext('2d')!.drawImage(bmp, 0, 0)
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('fail')), 'image/png'))
}

// Копирование ссылки на медиафайл.
export async function copyMediaLink(url: string): Promise<void> {
  try { await navigator.clipboard.writeText(url.replace('#spoiler', '')); toastOk('Ссылка скопирована') }
  catch { toastErr('Не удалось скопировать ссылку') }
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
