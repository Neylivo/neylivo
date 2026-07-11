// v1.213.0: автопроверка обновлений для APK — у десктопа авто-обновление уже
// есть через electron-updater (см. App.tsx, UpdateBanner), у PWA/веба своего
// кэша нет — каждое открытие само тянет последнюю версию. Только у APK не было
// вообще ничего: обновлялся исключительно вручную. Полностью тихая установка
// на Android без Play Маркета невозможна (систему всё равно попросит
// подтвердить установку поверх старой версии) — но саму проверку "есть ли
// новее релиз" и ссылку на .apk можно и нужно сделать автоматической.
const REPO = 'ponoiai/ponoi'
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
