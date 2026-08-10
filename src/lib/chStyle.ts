
// v1.138.0: шрифт и раскраска названий каналов.
// Серверный шрифт для всех каналов: servers.settings.ch_font (CSS font-family, '' = системный).
// Переопределение на канал: channels.settings.name_font ('' = как на сервере).
// Раскраска: channels.settings.name_colors — массив 1–4 hex-цветов (1 — сплошной,
// 2–4 — градиент по буквам, класс ch-grad), name_anim — «переливание» (класс ch-grad-anim).
import type { CSSProperties } from 'react'
import { customNickFamily } from './profilePrefs'
import { FONT_PRESETS, ensureFont } from './fonts'

// Тот же набор пресетов, что у шрифтов ника/сообщений (Settings.tsx).
// v1.530.0: тот же набор, что у ника и сообщений, и он один на всё приложение
// (src/lib/fonts.ts). Два списка системных имён разъезжались бы, а главное —
// системных имён там больше нет: на Android половины из них не существует.
export const CH_FONTS = FONT_PRESETS

// Готовые пресеты раскраски названия канала.
export const CH_COLOR_PRESETS: { name: string; colors: string[]; anim?: boolean }[] = [
  { name: 'Обычный', colors: [] },
  { name: 'Золотой', colors: ['#f5d76b', '#b8860b', '#ffe9a8'], anim: true },
  { name: 'Радуга', colors: ['#ed4245', '#f0b232', '#23a55a', '#5865f2'] },
  { name: 'Огонь', colors: ['#f23f43', '#f0813c'] },
  { name: 'Лёд', colors: ['#9bd8ff', '#0fa4f5'] },
  { name: 'Неон', colors: ['#2ce0bf', '#8547d6'] },
  { name: 'Закат', colors: ['#f23f9a', '#f0813c', '#f2e75c'] },
]

// Итоговый стиль названия канала: шрифт канала (name_font) или серверный (ch_font);
// 1 цвет — color, 2–4 — градиент (ch-grad красит текст по фону-градиенту).
// Для «переливания» первый цвет дублируется в конец — градиент зацикливается бесшовно.
// v1.140.0: свой файл шрифта — channels.settings.name_font_url / servers.settings.ch_font_url
// (URL из Supabase Storage, @font-face создаётся на лету, как у шрифта ника).
export function chFontFamily(url: string): string {
  return `'${customNickFamily(url)}', sans-serif`
}

export function chNameStyle(chSettings: any, srvSettings: any): { style?: CSSProperties; grad: boolean; anim: boolean } {
  // Приоритет: свой файл канала > пресет канала > свой файл сервера > пресет сервера.
  const font = (chSettings?.name_font_url ? chFontFamily(chSettings.name_font_url)
    : chSettings?.name_font ? chSettings.name_font
    : srvSettings?.ch_font_url ? chFontFamily(srvSettings.ch_font_url)
    : (srvSettings?.ch_font || '')) as string
  const colors: string[] = Array.isArray(chSettings?.name_colors) ? chSettings.name_colors.filter(Boolean).slice(0, 4) : []
  const grad = colors.length >= 2
  const anim = grad && !!chSettings?.name_anim
  const st: CSSProperties = {}
  // Названия каналов рисуются чужой настройкой сервера — шрифт для них надо
  // подтянуть здесь же, иначе он покажется обычным.
  if (font) { ensureFont(font); st.fontFamily = font }
  if (colors.length === 1) st.color = colors[0]
  if (grad) st.backgroundImage = 'linear-gradient(90deg, ' + (anim ? [...colors, colors[0]] : colors).join(', ') + ')'
  return { style: Object.keys(st).length ? st : undefined, grad, anim }
}
