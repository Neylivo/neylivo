// v1.115.0: проверяем, какие символы реально есть в файле шрифта (таблица cmap).
// Нужно, чтобы честно предупреждать: многие декоративные шрифты содержат только
// латиницу — русский текст тогда молча рендерится запасным системным шрифтом,
// и кажется, что «шрифт не работает». WOFF/WOFF2 сжаты — их не разбираем (null).

export interface FontCoverage { latin: boolean; cyrillic: boolean }

function parseSfnt(v: DataView): ((cp: number) => boolean) | null {
  const tag = v.getUint32(0)
  // 0x00010000 = TrueType, 'OTTO' = CFF OpenType, 'true' = старый Mac TrueType
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null
  const num = v.getUint16(4)
  let cmapOff = -1
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16
    const t = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    if (t === 'cmap') { cmapOff = v.getUint32(o + 8); break }
  }
  if (cmapOff < 0) return null
  const n = v.getUint16(cmapOff + 2)
  const ranges: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const so = cmapOff + v.getUint32(cmapOff + 4 + i * 8 + 4)
    const fmt = v.getUint16(so)
    if (fmt === 4) {
      const segX2 = v.getUint16(so + 6)
      const endO = so + 14, startO = so + 16 + segX2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(endO + s * 2), start = v.getUint16(startO + s * 2)
        if (start !== 0xffff) ranges.push([start, end])
      }
    } else if (fmt === 12) {
      const groups = v.getUint32(so + 12)
      for (let g = 0; g < groups; g++) {
        const go = so + 16 + g * 12
        ranges.push([v.getUint32(go), v.getUint32(go + 4)])
      }
    }
  }
  if (!ranges.length) return null
  return cp => ranges.some(([a, b]) => cp >= a && cp <= b)
}

function covOf(has: (cp: number) => boolean): FontCoverage {
  const all = (a: number, b: number) => { for (let c = a; c <= b; c++) if (!has(c)) return false; return true }
  return { latin: all(0x41, 0x5a) && all(0x61, 0x7a), cyrillic: all(0x410, 0x44f) }
}

export async function fileFontCoverage(f: File): Promise<FontCoverage | null> {
  try {
    const has = parseSfnt(new DataView(await f.arrayBuffer()))
    return has ? covOf(has) : null
  } catch { return null }
}

const urlCache = new Map<string, FontCoverage | null>()
export async function urlFontCoverage(url: string): Promise<FontCoverage | null> {
  if (urlCache.has(url)) return urlCache.get(url) ?? null
  let cov: FontCoverage | null = null
  try {
    const buf = await (await fetch(url)).arrayBuffer()
    const has = parseSfnt(new DataView(buf))
    cov = has ? covOf(has) : null
  } catch {}
  urlCache.set(url, cov)
  return cov
}
