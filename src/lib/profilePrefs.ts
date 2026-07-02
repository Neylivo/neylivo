// Profile customization (theme colors + "about" + profile pet), stored on the
// shared `profiles` table so it is visible to everyone on any device.
import { supabase } from './supabase'

export type PetKind = 'image' | 'gif' | 'video' | 'model' | 'none'
export type PetPos = 'above' | 'br' | 'bl' | 'tr' | 'tl' | 'free'

export interface ProfilePrefs {
  primary: string          // profile card banner primary color
  accent: string           // profile card accent color
  about: string
  petUrl: string | null    // public URL (Supabase Storage) of the pet media
  petKind: PetKind
  petOn: boolean
  petSize: number          // px
  petPos: PetPos
}

export const DEFAULT_PROFILE: ProfilePrefs = {
  primary: '#5865f2', accent: '#5865f2', about: 'Привет! Я использую Ponoi.',
  petUrl: null, petKind: 'none', petOn: false, petSize: 180, petPos: 'tr',
}

function fromRow(r: any): ProfilePrefs {
  if (!r) return { ...DEFAULT_PROFILE }
  return {
    primary: r.primary_color ?? DEFAULT_PROFILE.primary,
    accent: r.accent_color ?? DEFAULT_PROFILE.accent,
    about: r.about ?? DEFAULT_PROFILE.about,
    petUrl: r.pet_url ?? null,
    petKind: (r.pet_kind as PetKind) ?? 'none',
    petOn: !!r.pet_on,
    petSize: r.pet_size ?? DEFAULT_PROFILE.petSize,
    petPos: (r.pet_pos as PetPos) ?? DEFAULT_PROFILE.petPos,
  }
}

function toRow(p: Partial<ProfilePrefs>): any {
  const r: any = {}
  if (p.primary !== undefined) r.primary_color = p.primary
  if (p.accent !== undefined) r.accent_color = p.accent
  if (p.about !== undefined) r.about = p.about
  if (p.petUrl !== undefined) r.pet_url = p.petUrl
  if (p.petKind !== undefined) r.pet_kind = p.petKind
  if (p.petOn !== undefined) r.pet_on = p.petOn
  if (p.petSize !== undefined) r.pet_size = p.petSize
  if (p.petPos !== undefined) r.pet_pos = p.petPos
  return r
}

// last-known values per user, so partial saves can merge without a re-fetch
const cache: Record<string, ProfilePrefs> = {}

export async function fetchProfile(id: string): Promise<ProfilePrefs> {
  if (!id) return { ...DEFAULT_PROFILE }
  const { data } = await supabase.from('profiles')
    .select('primary_color, accent_color, about, pet_url, pet_kind, pet_on, pet_size, pet_pos')
    .eq('id', id).maybeSingle()
  const p = fromRow(data)
  cache[id] = p
  return p
}

export async function saveProfile(id: string, patch: Partial<ProfilePrefs>): Promise<ProfilePrefs> {
  const next = { ...(cache[id] ?? DEFAULT_PROFILE), ...patch }
  cache[id] = next
  await supabase.from('profiles').update(toRow(patch)).eq('id', id)
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