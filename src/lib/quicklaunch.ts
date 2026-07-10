// v1.180.0: «Игровой Экспресс» (QuickLaunch) — рендерер-обвязка вокруг
// electron/quicklaunch.cjs (сканирование/заливка модов идут в main-процессе,
// см. его же комментарии) и таблицы quicklaunch_packs в Supabase.
// Только десктоп — на вебе window.ponoiDesktop нет вообще.
import { supabase } from './supabase'

export interface QlMod { name: string; filename: string; sha1: string; size: number }
export interface QlManifest {
  mcVersion: string
  loader: string          // 'forge' | 'neoforge'
  loaderVersion: string
  mods: QlMod[]
}
export interface QlPack extends QlManifest {
  id: string
  hostId: string
  serverIp: string
  serverPort: number
  createdAt: string
}

function desktop(): any { return (window as any).ponoiDesktop }
export function isQuicklaunchAvailable(): boolean { return !!desktop()?.isDesktop }

// Скан своей сборки — { error } если .minecraft/mods/лоадер не нашлись,
// иначе { mcVersion, loader, loaderVersion, mods }. См. electron/quicklaunch.cjs.
export async function scanLocalPack(): Promise<QlManifest | { error: string }> {
  return desktop().mcScanMods()
}

export async function createPack(hostId: string, manifest: QlManifest, serverIp: string, serverPort: number): Promise<string> {
  const { data, error } = await supabase.from('quicklaunch_packs').insert({
    host_id: hostId, game: 'minecraft',
    mc_version: manifest.mcVersion, loader: manifest.loader, loader_version: manifest.loaderVersion,
    server_ip: serverIp, server_port: serverPort, mods: manifest.mods,
  }).select('id').single()
  if (error) throw error
  return (data as any).id as string
}

export async function fetchPack(id: string): Promise<QlPack | null> {
  const { data, error } = await supabase.from('quicklaunch_packs').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  const r = data as any
  return {
    id: r.id, hostId: r.host_id, mcVersion: r.mc_version, loader: r.loader, loaderVersion: r.loader_version,
    serverIp: r.server_ip, serverPort: r.server_port, mods: r.mods ?? [], createdAt: r.created_at,
  }
}

// Заливает недостающие моды хоста в общий bucket modfiles (main-процесс сам
// пропускает те, что там уже есть — дедуп по sha1 общий на весь Ponoi, не
// только на повторные шары одного и того же человека). onProgress — 0..1.
export async function uploadMissingMods(mods: QlMod[], onProgress?: (p: number) => void): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const { data: s } = await supabase.auth.getSession()
  const accessToken = s.session?.access_token ?? anonKey
  const d = desktop()
  for (let i = 0; i < mods.length; i++) {
    await d.mcUploadMod({ supabaseUrl, anonKey, accessToken, sha1: mods[i].sha1, filename: mods[i].filename })
    onProgress?.((i + 1) / mods.length)
  }
}

// «Поделиться сборкой»: скан -> заливка недостающих модов -> запись пака -> id для карточки в чате.
export async function shareCurrentPack(hostId: string, serverIp: string, serverPort: number, onProgress?: (p: number) => void): Promise<string> {
  const manifest = await scanLocalPack()
  if ('error' in manifest) throw new Error(manifest.error)
  await uploadMissingMods(manifest.mods, onProgress)
  return createPack(hostId, manifest, serverIp, serverPort)
}
