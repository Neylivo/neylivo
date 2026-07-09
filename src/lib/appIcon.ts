// Система смены логотипа приложения (v1.158.0) — 4 варианта, лежат в public/logos/
// (и продублированы в electron/logos/ для сплэш-экрана — он грузится напрямую из
// electron/, минуя dist/, см. комментарий в electron/main.cjs createSplash()).
export interface AppIconDef { id: string; name: string; file: string }
export const APP_ICONS: AppIconDef[] = [
  { id: 'classic', name: 'Классика', file: '/logos/logo-classic.svg' },
  { id: 'dark', name: 'Тёмная', file: '/logos/logo-dark.svg' },
  { id: 'neon', name: 'Неон', file: '/logos/logo-neon.svg' },
  { id: 'cyberpunk', name: 'Киберпанк', file: '/logos/logo-cyberpunk.svg' },
]
export const DEFAULT_APP_ICON = 'classic'

export function iconUrlOf(id: string | undefined | null): string {
  return (APP_ICONS.find(i => i.id === id) ?? APP_ICONS[0]).file
}

// Растеризация SVG в PNG data URL через canvas — нужна для Electron: nativeImage
// (win.setIcon/tray.setImage) не понимает SVG напрямую, только растровые форматы.
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
export async function applyAppIcon(id: string): Promise<void> {
  const url = iconUrlOf(id)
  try {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) link.href = url
  } catch {}
  const d = (window as any).ponoiDesktop
  if (d?.setAppIcon) {
    try {
      const dataUrl = await rasterize(url, 256)
      await d.setAppIcon(dataUrl, id)
    } catch {}
  }
}
