// v1.180.0: «Игровой Экспресс» (QuickLaunch) — рендерер-обвязка вокруг
// electron/quicklaunch.cjs (сканирование/заливка модов идут в main-процессе,
// см. его же комментарии) и таблицы quicklaunch_packs в Supabase.
// Только десктоп — на вебе window.ponoiDesktop нет вообще.
import { supabase } from './supabase'

export interface QlMod { name: string; filename: string; sha1: string; size: number }
export interface QlManifest {
  mcVersion: string
  loader: string          // 'forge' | 'neoforge' | 'fabric'
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
// v1.285.0: undefined — обычный .minecraft; { prismInstance: <имя> } — конкретный
// инстанс Prism Launcher (см. listPrismInstances() в electron/quicklaunch.cjs).
export interface QlSource { id: string; label: string; prismInstance?: string; mcVersion: string; loader: string | null; loaderVersion: string | null }

function desktop(): any { return (window as any).ponoiDesktop }
export function isQuicklaunchAvailable(): boolean { return !!desktop()?.isDesktop }

// Список источников сборки для пикера («обычный лаунчер» + все инстансы Prism Launcher).
export async function listSources(): Promise<QlSource[]> {
  return desktop()?.mcListSources ? desktop().mcListSources() : []
}

// Скан своей сборки — { error } если .minecraft/mods/лоадер не нашлись,
// иначе { mcVersion, loader, loaderVersion, mods }. См. electron/quicklaunch.cjs.
// source — см. QlSource; opts.fast=true — «поделиться версией» без скана/докачки модов.
export async function scanLocalPack(source?: { prismInstance: string }, opts?: { fast?: boolean }): Promise<QlManifest | { error: string }> {
  return desktop().mcScanMods(source, opts)
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
export async function uploadMissingMods(mods: QlMod[], onProgress?: (p: number) => void, source?: { prismInstance: string }): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const { data: s } = await supabase.auth.getSession()
  const accessToken = s.session?.access_token ?? anonKey
  const d = desktop()
  for (let i = 0; i < mods.length; i++) {
    await d.mcUploadMod({ supabaseUrl, anonKey, accessToken, sha1: mods[i].sha1, filename: mods[i].filename, source })
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

// Прогресс шлют и prepareInstance (докачка модов — done/total/filename), и launch
// (installer/libraries/assets/launch — см. electron/quicklaunch.cjs). Поля опциональны
// в зависимости от того, какой этап их прислал.
export interface QlProgress { stage?: 'installer' | 'libraries' | 'assets' | 'launch'; done?: number; total?: number; filename?: string }
// Подписка на прогресс (main шлёт push-события во время prepareInstance/launch).
export function onMcProgress(cb: (p: QlProgress) => void): void { desktop()?.onMcProgress(cb) }

// У друга: докачивает недостающие моды пака (что уже есть — берёт готовым, не
// перекачивает) в отдельную песочницу %APPDATA%\.minecraft\ponoi_instances\<packId>\.
export async function prepareInstance(pack: QlPack): Promise<{ instanceDir: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return desktop().mcPrepareInstance(pack, supabaseUrl)
}

// Резолвит библиотеки/ассеты/лоадер (ставит Forge/NeoForge при необходимости) и
// запускает игру уже в песочнице instanceDir, с авто-входом на pack.serverIp:serverPort.
export async function launchPack(pack: QlPack, instanceDir: string, username: string): Promise<{ pid: number }> {
  return desktop().mcLaunch(pack, instanceDir, username)
}
