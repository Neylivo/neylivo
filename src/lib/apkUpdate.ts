import { Capacitor } from '@capacitor/core'
// v1.213.0: автопроверка обновлений для APK — у десктопа авто-обновление уже
// есть через electron-updater (см. App.tsx, UpdateBanner), у PWA/веба своего
// кэша нет — каждое открытие само тянет последнюю версию. Только у APK не было
// вообще ничего: обновлялся исключительно вручную. Полностью тихая установка
// на Android без Play Маркета невозможна (систему всё равно попросит
// подтвердить установку поверх старой версии) — но саму проверку "есть ли
// новее релиз" и ссылку на .apk можно и нужно сделать автоматической.
const REPO = 'Neylivo/neylivo'
const DISMISS_KEY = 'ponoi_apk_update_dismissed'

function verParts(v: string): number[] { return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0) }

/** a > b ? (по major.minor.patch, как в scripts/gen-changelog.mjs) */
function isNewer(a: string, b: string): boolean {
  const pa = verParts(a), pb = verParts(b)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) }
  return false
}

export type ApkUpdate = { version: string; url: string }

/** Сверяется с последним GitHub Release; null — если апдейта нет или что-то пошло не так (тихо, без ошибок в UI). */
export async function checkApkUpdate(currentVersion: string): Promise<ApkUpdate | null> {
  try {
    const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest')
    if (!res.ok) return null
    const data = await res.json()
    const tag = String(data?.tag_name || '').trim()
    if (!tag || !isNewer(tag, currentVersion)) return null
    const asset = ((data?.assets ?? []) as any[]).find(a => /\.apk$/i.test(a?.name || ''))
    if (!asset?.browser_download_url) return null
    return { version: tag.replace(/^v/, ''), url: asset.browser_download_url }
  } catch { return null }
}

/** Версию, которую пользователь уже закрыл крестиком — не показываем баннер повторно (до следующей версии). */
export function getDismissedApkVersion(): string | null {
  try { return localStorage.getItem(DISMISS_KEY) } catch { return null }
}
export function dismissApkVersion(version: string) {
  try { localStorage.setItem(DISMISS_KEY, version) } catch {}
}

// ---- v1.308.0: установка обновления без ухода в браузер ----
//
// Раньше кнопка «Скачать» открывала ссылку на .apk: человек уходил в браузер,
// потом искал файл в загрузках и ставил вручную. Теперь файл скачивается внутри
// приложения с показом процента, и сразу открывается системный установщик.
//
// Что при этом НЕ обходится и не должно: Android спросит подтверждение установки
// поверх старой версии и потребует разовое разрешение «ставить из этого
// источника». Приложение, умеющее молча подменять само себя, было бы дырой
// опаснее всех, что мы закрывали.
import { registerPlugin } from '@capacitor/core'

interface ApkInstallerPlugin {
  canInstall(): Promise<{ value: boolean }>
  openInstallSettings(): Promise<void>
  downloadAndInstall(o: { url: string; version?: string }): Promise<void>
  // v1.443.0: скачивание и установка разделены — файл приезжает заранее и сам,
  // а согласие системы спрашивается только когда человек нажал «Установить».
  download(o: { url: string; version?: string }): Promise<{ bytes: number }>
  install(): Promise<void>
  readyVersion(): Promise<{ value: string | null }>
  netInfo(): Promise<{ metered: boolean; online: boolean }>
  addListener(e: 'progress', cb: (d: { percent: number }) => void): Promise<{ remove: () => Promise<void> }>
}
const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller')

/** Какая версия уже скачана. null — ничего готового нет (в том числе если
 *  систе́ма почистила кэш: плагин сверяет отметку с самим файлом). */
export async function readyApkVersion(): Promise<string | null> {
  try { return (await ApkInstaller.readyVersion()).value ?? null } catch { return null }
}

/** Тип сети. При любом сбое считаем сеть тарифицируемой — тогда фоновое
 *  скачивание просто не начнётся, и это безопаснее обратной ошибки. */
export async function apkNetInfo(): Promise<{ metered: boolean; online: boolean }> {
  try { return await ApkInstaller.netInfo() } catch { return { metered: true, online: true } }
}

/** Скачать заранее, установщик не открывать. */
export async function downloadApk(url: string, version: string, onProgress?: (p: number) => void): Promise<void> {
  const sub = onProgress ? await ApkInstaller.addListener('progress', d => onProgress(d.percent)) : null
  try { await ApkInstaller.download({ url, version }) }
  finally { await sub?.remove() }
}

/** Открыть установщик для уже скачанного файла. */
export async function installReadyApk(): Promise<void> {
  const { value } = await ApkInstaller.canInstall()
  if (!value) {
    await ApkInstaller.openInstallSettings()
    throw new Error('Разреши установку из этого приложения и нажми «Установить» ещё раз')
  }
  await ApkInstaller.install()
}

/**
 * Скачать и открыть установщик. onProgress получает проценты.
 * Бросает — вызывающая сторона в этом случае откатывается на обычную ссылку,
 * то есть на прежнее поведение: хуже, чем было, не станет ни при каком сбое.
 */
export async function installApkInApp(url: string, onProgress?: (p: number) => void, version?: string): Promise<void> {
  const sub = onProgress ? await ApkInstaller.addListener('progress', d => onProgress(d.percent)) : null
  try {
    const { value } = await ApkInstaller.canInstall()
    if (!value) {
      // Разрешения нет — ведём человека прямо в нужный системный экран, а не
      // оставляем гадать, почему ничего не произошло.
      await ApkInstaller.openInstallSettings()
      throw new Error('Разреши установку из этого приложения и нажми «Обновить» ещё раз')
    }
    await ApkInstaller.downloadAndInstall({ url, version })
  } finally {
    await sub?.remove()
  }
}
