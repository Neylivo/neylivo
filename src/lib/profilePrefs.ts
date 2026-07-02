// Client-side profile customization (profile theme colors + profile pet).
// The `profiles` table has no columns for these and Ponoi is personal, so they
// live in localStorage keyed by user id.
export type PetKind = 'image' | 'gif' | 'video' | 'model' | 'none'
export type PetPos = 'above' | 'br' | 'bl' | 'tr' | 'tl' | 'free'

export interface ProfilePrefs {
  primary: string          // profile card banner primary color
  accent: string           // profile card accent color
  about: string
  petUrl: string | null    // data URL / remote URL of the pet media
  petKind: PetKind
  petOn: boolean
  petSize: number          // px
  petPos: PetPos
}

export const DEFAULT_PROFILE: ProfilePrefs = {
  primary: '#5865f2', accent: '#5865f2', about: 'Привет! Я использую Ponoi.',
  petUrl: null, petKind: 'none', petOn: false, petSize: 180, petPos: 'tr',
}

function key(id: string) { return 'ponoi_profile_' + id }

export function getProfile(id: string): ProfilePrefs {
  try { return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(key(id)) || '{}') } }
  catch { return { ...DEFAULT_PROFILE } }
}
export function setProfile(id: string, patch: Partial<ProfilePrefs>) {
  const next = { ...getProfile(id), ...patch }
  localStorage.setItem(key(id), JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('ponoi-profile', { detail: { id } }))
  return next
}

export function petKindOf(file: File): PetKind {
  const t = file.type
  if (t.startsWith('video')) return 'video'
  if (t === 'image/gif') return 'gif'
  if (t.startsWith('image')) return 'image'
  if (/\.(glb|gltf)$/i.test(file.name)) return 'model'
  return 'image'
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
