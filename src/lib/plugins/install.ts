import { getPlugin, upsertPlugin } from './store'
import { startPlugin } from './host'
import type { PluginManifest } from './types'

// v1.286.0: установка одна на два пути — из файла в настройках и из карточки в чате.
// Держим её здесь, чтобы «поставить из чата» не могло случайно разойтись с
// «поставить из файла» (например, забыть перезапустить плагин или потерять его данные).

export async function installPlugin(manifest: PluginManifest, code: string, sourceUserId: string | null = null): Promise<void> {
  // Данные уже стоявшего плагина того же id переживают обновление — иначе апдейт
  // сбрасывал бы человеку все его настройки.
  const prev = getPlugin(manifest.id)
  upsertPlugin({
    manifest, code, enabled: true,
    installedAt: new Date().toISOString(),
    sourceUserId,
    storage: prev?.storage ?? {},
  })
  await startPlugin(getPlugin(manifest.id)!)
}
