// Dominant-color extraction from track artwork: the whole Ponoi Music theme
// (accent, buttons, background, glow behind the cover) recolors per track.
export interface Rgb { r: number; g: number; b: number }

const KEY = 'ponoi_mus_artcolor_v1'
function loadCache(): Record<string, Rgb> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const cache = loadCache()
function save() { try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch {} }

/** Average of the saturated pixels of a downscaled artwork; null if CORS blocks canvas. */
export async function artColor(url: string): Promise<Rgb | null> {
  if (cache[url]) return cache[url]
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = url })
    const N = 24
    const c = document.createElement('canvas')
    c.width = N; c.height = N
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, N, N)
    const d = ctx.getImageData(0, 0, N, N).data // throws if the image tainted the canvas
    let r = 0, g = 0, b = 0, n = 0, r2 = 0, g2 = 0, b2 = 0, n2 = 0
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2]
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B)
      r2 += R; g2 += G; b2 += B; n2++
      if (mx > 60 && mx - mn > 24) { r += R; g += G; b += B; n++ }   // saturated & not too dark
    }
    const pick: Rgb = n >= 20
      ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
      : { r: Math.round(r2 / n2), g: Math.round(g2 / n2), b: Math.round(b2 / n2) }
    cache[url] = pick; save()
    return pick
  } catch { return null }
}

export const rgb = (c: Rgb, a?: number) =>
  a === undefined ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${a})`

/** Brighten dark colors so the accent stays visible on the dark UI. */
export function boost(c: Rgb, min = 96): Rgb {
  const mx = Math.max(c.r, c.g, c.b)
  if (mx >= min) return c
  const k = min / Math.max(mx, 1)
  return { r: Math.min(255, Math.round(c.r * k)), g: Math.min(255, Math.round(c.g * k)), b: Math.min(255, Math.round(c.b * k)) }
}

/** Mix towards white (k=0..1). */
export function lighten(c: Rgb, k = 0.35): Rgb {
  return { r: Math.round(c.r + (255 - c.r) * k), g: Math.round(c.g + (255 - c.g) * k), b: Math.round(c.b + (255 - c.b) * k) }
}

/** Scale towards black (k=0..1 keeps k of the brightness) — for tinted backgrounds. */
export function scale(c: Rgb, k: number): Rgb {
  return { r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k) }
}
