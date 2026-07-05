import { supabase } from './supabase'

// Обложки игр — общий кэш на всех в таблице game_covers (миграция 13).
// Схема как в Discord: игра определилась -> статус сразу уходит с cover: null
// (у друзей шиммер-заглушка), параллельно ищем обложку и делаем hot swap.
// Если игра не нашлась — ставим not_found на несколько часов, чтобы не мучить API.
// v1.84.0: обложки ищутся и в браузере (iTunes Search через JSONP — CORS не
// мешает), а не только в десктопе. Поэтому «вечных заглушек» у веб-пользователей
// больше нет: кто угодно находит обложку и кэширует её в базе для всех.

const NOT_FOUND_TTL = 6 * 60 * 60 * 1000   // 6 часов: источники пополняются — пробуем снова
const SOURCES_UPGRADED_AT = Date.parse('2026-07-05T00:00:00Z')   // v1.84.0: точный матчинг Steam + поиск в браузере

// iTunes Search в браузере: обычный fetch блокируется CORS, но у API есть
// JSONP-режим (callback=...), который работает из любого окна.
function itunesJsonp(term: string): Promise<string | null> {
  return new Promise(resolve => {
    const cb = '__ponoiCover' + Math.floor(Math.random() * 1e9)
    const s = document.createElement('script')
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      try { delete (window as any)[cb] } catch {}
      s.remove(); window.clearTimeout(to)
      resolve(v)
    }
    const to = window.setTimeout(() => finish(null), 8000)
    ;(window as any)[cb] = (data: any) => {
      const w = term.split(/\s+/)[0].toLowerCase()
      const app = (data?.results ?? []).find((a: any) => String(a.trackName || '').toLowerCase().includes(w))
      finish(app ? (app.artworkUrl512 || app.artworkUrl100 || null) : null)
    }
    s.src = 'https://itunes.apple.com/search?media=software&limit=5&term=' + encodeURIComponent(term) + '&callback=' + cb
    s.onerror = () => finish(null)
    document.head.appendChild(s)
  })
}

export async function resolveCover(name: string): Promise<string | null> {
  if (!name) return null
  // 1) Общий кэш в базе: одна игра ищется один раз на всех.
  try {
    const { data } = await supabase.from('game_covers')
      .select('cover_url,status,checked_at').eq('name', name).maybeSingle()
    if (data) {
      if (data.status === 'ok' && data.cover_url) return data.cover_url
      if (data.status === 'not_found') {
        const checked = new Date(data.checked_at).getTime()
        // Записи «не нашлось» до апгрейда источников не считаются — ищем заново.
        if (checked > SOURCES_UPGRADED_AT && Date.now() - checked < NOT_FOUND_TTL) return null
      }
    }
  } catch {}
  const term = name.replace(/\(.*?\)/g, '').trim()
  // 2) Фоновый поиск: десктоп — Steam + iTunes (main-процесс, без CORS);
  //    браузер — iTunes через JSONP.
  let url: string | null = null
  try {
    const d = (window as any).ponoiDesktop
    url = d?.findCover ? await d.findCover(name) : await itunesJsonp(term)
  } catch { return null }
  // 3) Кэшируем результат (включая not_found) для всех.
  try {
    await supabase.from('game_covers').upsert({
      name, cover_url: url, status: url ? 'ok' : 'not_found', checked_at: new Date().toISOString(),
    })
  } catch {}
  return url
}
