// v1.333.0: каталоги плагинов и ботов (миграция 89).
//
// Каталог — это витрина: картинка, короткое описание, имя автора. Всё, что
// длиннее, лежит в отдельном поле и показывается только в карточке — иначе
// список превращается в стену текста и по нему нельзя пробежать глазами.
import { supabase } from './supabase'

/** Сколько символов короткого описания влезает в карточку списка. */
export const SUMMARY_MAX = 90
export const DESC_MAX = 2000

export interface CatalogPlugin {
  id: string
  name: string
  version: string
  author_id: string
  author_name: string
  summary: string
  description: string | null
  icon_url: string | null
  banner_url: string | null
  code: string
  permissions: string[]
  installs: number
  updated_at: string
}

export interface CatalogBot {
  app_id: string
  name: string
  author_id: string
  author_name: string
  summary: string
  description: string | null
  icon_url: string | null
  banner_url: string | null
  adds: number
  updated_at: string
}

/** Обрезка для карточки: по словам, чтобы не рвать слово посередине. */
export function shorten(text: string, max = SUMMARY_MAX): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

/**
 * Каталог может быть недоступен: миграция 89 не применена, сети нет, база
 * молчит. Это не ошибка приложения — плагины ставятся файлом и без каталога,
 * поэтому здесь возвращаем причину строкой, а вызывающий показывает её как
 * состояние списка, а не как «что-то сломалось».
 */
export type CatalogResult<T> = { items: T[]; error: null } | { items: []; error: string }

function why(e: any): string {
  const msg = String(e?.message ?? e ?? '')
  if (/relation .* does not exist|schema cache|not find the table/i.test(msg)) {
    return 'Каталог ещё не включён: нужно применить миграцию supabase/89_catalogs.sql.'
  }
  // v1.335.0: фон карточки добавила отдельная миграция — если её не применили,
  // Postgres жалуется именно на эту колонку, и понятнее сказать про неё, чем
  // показать «column banner_url does not exist».
  if (/banner_url/i.test(msg)) {
    return 'Фон карточки появится после миграции supabase/90_catalog_banner.sql.'
  }
  return msg || 'Не удалось загрузить каталог.'
}

export async function fetchPluginCatalog(): Promise<CatalogResult<CatalogPlugin>> {
  const { data, error } = await supabase.from('plugin_catalog')
    .select('*').order('installs', { ascending: false }).limit(200)
  if (error) return { items: [], error: why(error) }
  return { items: (data ?? []) as CatalogPlugin[], error: null }
}

export async function fetchBotCatalog(): Promise<CatalogResult<CatalogBot>> {
  const { data, error } = await supabase.from('bot_catalog')
    .select('*').order('adds', { ascending: false }).limit(200)
  if (error) return { items: [], error: why(error) }
  return { items: (data ?? []) as CatalogBot[], error: null }
}

export interface PublishPlugin {
  id: string; name: string; version: string; summary: string; description: string
  icon_url: string | null; banner_url: string | null; code: string; permissions: string[]
}

/**
 * Выложить или обновить свой плагин. author_id и имя автора проставляет база
 * (триггер catalog_stamp) — клиент их не присылает, иначе плагин можно было бы
 * выложить «от чужого имени».
 */
export async function publishPlugin(p: PublishPlugin, meId: string): Promise<void> {
  const row = {
    id: p.id, name: p.name, version: p.version,
    summary: shorten(p.summary, SUMMARY_MAX),
    description: p.description.slice(0, DESC_MAX) || null,
    icon_url: p.icon_url, banner_url: p.banner_url, code: p.code, permissions: p.permissions,
    author_id: meId, author_name: '',
  }
  const { error } = await supabase.from('plugin_catalog').upsert(row)
  if (error) {
    // Единственный по-настоящему ожидаемый отказ: этот id уже занят другим
    // человеком. Пишем понятно, а не «повторяющееся значение ключа».
    if (/duplicate key|row-level security/i.test(error.message)) {
      throw new Error('Плагин с таким @id уже выложен другим человеком — поменяй @id в шапке файла.')
    }
    throw new Error(why(error))
  }
}

export async function unpublishPlugin(id: string): Promise<void> {
  const { error } = await supabase.from('plugin_catalog').delete().eq('id', id)
  if (error) throw new Error(why(error))
}

export async function countPluginInstall(id: string): Promise<void> {
  try { await supabase.rpc('plugin_installed', { p_id: id }) } catch { /* счётчик не стоит показа ошибки */ }
}

export async function publishBot(b: {
  app_id: string; name: string; summary: string; description: string
  icon_url: string | null; banner_url: string | null
}, meId: string): Promise<void> {
  const { error } = await supabase.from('bot_catalog').upsert({
    app_id: b.app_id, name: b.name,
    summary: shorten(b.summary, SUMMARY_MAX),
    description: b.description.slice(0, DESC_MAX) || null,
    icon_url: b.icon_url, banner_url: b.banner_url, author_id: meId, author_name: '',
  })
  if (error) {
    if (/row-level security/i.test(error.message)) {
      throw new Error('Выложить можно только своего бота — этот принадлежит другому человеку.')
    }
    throw new Error(why(error))
  }
}

export async function unpublishBot(appId: string): Promise<void> {
  const { error } = await supabase.from('bot_catalog').delete().eq('app_id', appId)
  if (error) throw new Error(why(error))
}

export async function countBotAdd(appId: string): Promise<void> {
  try { await supabase.rpc('bot_added', { p_app: appId }) } catch {}
}
