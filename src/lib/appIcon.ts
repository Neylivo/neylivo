// Свой логотип приложения (v1.160.0) — только загрузка своего файла, без
// пресетов. Хранится как data URL прямо в настройках (ponoi_settings,
// localStorage) — так же локально, как и все остальные настройки внешнего
// вида, без обращения к Supabase Storage (это личная настройка устройства).
export const DEFAULT_APP_ICON = ''   // пусто = свой логотип не задан, используем стандартную иконку
export const DEFAULT_ICON_URL = '/icon.png'   // тот же файл, что и favicon по умолчанию
export const MAX_ICON_BYTES = 2 * 1024 * 1024   // 2 МБ на исходный файл

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
}

// Растеризация в PNG data URL через canvas — нужна для Electron: nativeImage
// (win.setIcon/tray.setImage) не понимает SVG напрямую, только растровые форматы.
// Для уже растровых файлов (png/jpg) это заодно приводит их к одному размеру.
function rasterize(url: string, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const g = c.getContext('2d')
      if (!g) { reject(new Error('no canvas 2d context')); return }
      g.drawImage(img, 0, 0, size, size)
      try { resolve(c.toDataURL('image/png')) } catch (e) { reject(e) }
    }
    img.onerror = () => reject(new Error('Не удалось загрузить логотип'))
    img.src = url
  })
}

// Применить логотип везде: favicon вкладки (веб/PWA) + иконка окна и трея (Electron).
// url — data URL своего логотипа, или '' чтобы вернуть стандартную иконку.
export async function applyAppIcon(url: string): Promise<void> {
  try {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) link.href = url || DEFAULT_ICON_URL
  } catch {}
  const d = (window as any).ponoiDesktop
  if (!d?.setAppIcon) return
  if (!url) { try { await d.setAppIcon(null) } catch {} ; return }
  try {
    const dataUrl = await rasterize(url, 256)
    await d.setAppIcon(dataUrl)
  } catch {}
}
