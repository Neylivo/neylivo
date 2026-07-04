
import { supabase } from './supabase'

// Обложки игр — общий кэш на всех в таблице game_covers (миграция 13).
// Схема как в Discord: игра определилась -> статус сразу уходит с cover: null
// (у друзей серая заглушка-геймпад), параллельно ищем обложку и делаем hot swap.
// Если игра не нашлась — ставим not_found на пару дней, чтобы не мучить API.

const NOT_FOUND_TTL = 2 * 24 * 60 * 60 * 1000   // 2 дня

export async function resolveCover(name: string): Promise<string | null> {
  if (!name) return null
  // 1) Общий кэш в базе: одна игра ищется один раз на всех.
  try {
    const { data } = await supabase.from('game_covers')
      .select('cover_url,status,checked_at').eq('name', name).maybeSingle()
    if (data) {
      if (data.status === 'ok' && data.cover_url) return data.cover_url
      if (data.status === 'not_found' && Date.now() - new Date(data.checked_at).getTime() < NOT_FOUND_TTL) return null
    }
  } catch {}
  // 2) Фоновый поиск через магазин Steam — только в десктопе (main-процесс, без CORS).
  let url: string | null = null
  try {
    const d = (window as any).ponoiDesktop
    if (!d?.findCover) return null   // браузер не ищет — возьмёт из кэша, когда найдёт кто-то с десктопом
    url = await d.findCover(name)
  } catch { return null }
  // 3) Кэшируем результат (включая not_found) для всех.
  try {
    await supabase.from('game_covers').upsert({
      name, cover_url: url, status: url ? 'ok' : 'not_found', checked_at: new Date().toISOString(),
    })
  } catch {}
  return url
}
