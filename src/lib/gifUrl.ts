// v1.89.0: ссылка на гифку из любого места (Discord, Tenor, Giphy) — в чате
// показывается сама гифка, а не ссылка. «Копировать ссылку» в Discord даёт
// страницу tenor.com/view/… — её (и страницы Giphy) резолвим в прямой URL
// картинки; результат кэшируется на время работы приложения.

const DIRECT_RE = /https?:\/\/[^\s<>]+\.(?:gif|png|jpe?g|webp)(?:\?[^\s<>]*)?/i
const TENOR_PAGE_RE = /https?:\/\/(?:www\.)?tenor\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?view\/[\w-]+(?:\?[^\s<>]*)?/i
const GIPHY_PAGE_RE = /https?:\/\/(?:www\.)?giphy\.com\/(?:gifs|clips|stickers)\/[\w-]+(?:\?[^\s<>]*)?/i

/** Первая ссылка на гифку/картинку в тексте: прямая или страница Tenor/Giphy. */
export function findGifLink(text?: string | null): string | null {
  if (!text) return null
  const m = text.match(DIRECT_RE) ?? text.match(TENOR_PAGE_RE) ?? text.match(GIPHY_PAGE_RE)
  return m ? m[0] : null
}

const cache = new Map<string, string | null>()

/** Синхронно: уже отрезолвленный прямой URL (или null, если резолв не удался). */
export function cachedGif(url: string): string | null | undefined { return cache.get(url) }

/** Резолв ссылки в прямой URL гифки: прямые — как есть, страницы Tenor/Giphy — через их API. */
export async function resolveGif(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url) ?? null
  let out: string | null = null
  if (DIRECT_RE.test(url)) {
    out = url
  } else if (TENOR_PAGE_RE.test(url)) {
    // ID тенора — цифры в конце пути страницы.
    const id = (url.split(/[?#]/)[0].match(/(\d+)$/) ?? [])[1]
    if (id) {
      try {
        const r = await fetch('https://g.tenor.com/v1/gifs?ids=' + id + '&key=LIVDSRZULELA&media_filter=minimal')
        const j = await r.json()
        const m = (j?.results?.[0]?.media?.[0]) as any
        out = m?.gif?.url ?? m?.tinygif?.url ?? null
      } catch { out = null }
    }
  } else if (GIPHY_PAGE_RE.test(url)) {
    // ID гифи — последний токен слага; прямой URL строится без ключа.
    const id = url.split(/[?#]/)[0].split('/').pop()?.split('-').pop()
    if (id) out = 'https://media.giphy.com/media/' + id + '/giphy.gif'
  }
  cache.set(url, out)
  return out
}
