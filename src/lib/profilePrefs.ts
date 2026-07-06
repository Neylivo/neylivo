// Profile customization (theme colors + "about" + profile pet), stored on the
// shared `profiles` table so it is visible to everyone on any device.
import { supabase } from './supabase'

export type PetKind = 'image' | 'gif' | 'video' | 'model' | 'none'
export type PetPos = 'above' | 'br' | 'bl' | 'tr' | 'tl' | 'free'

export interface PetFree { x: number; y: number } // позиция в % от карточки (центр питомца)

export interface ProfilePrefs {
  primary: string          // profile card banner primary color
  accent: string           // profile card accent color
  about: string
  petUrl: string | null    // public URL (Supabase Storage) of the pet media
  petKind: PetKind
  petOn: boolean
  petSize: number          // px
  petPos: PetPos
  petFree: PetFree // «Свободно»: одна позиция (в % карточки) — питомец в том же месте во всех местах показа профиля
  pronouns: string         // местоимения (карточка профиля)
  integrations: Integration[]
  createdAt: string | null // profiles.created_at («В числе участников с»)
  // v1.95.0: «кубик» (nameplate) — фон (фото/видео <=5 сек) и обводка панельки с ником
  plateUrl: string | null
  plateKind: 'image' | 'video' | 'none'
  plateOutline: string | null
  // v1.110.0: шрифт ника — пресет (CSS font-family) и/или свой загруженный файл шрифта
  nickFont: string
  nickFontUrl: string | null
  // v1.112.0: шрифт сообщений — каким шрифтом пишутся твои сообщения в чате (видно всем)
  msgFont: string
  msgFontUrl: string | null
}

export interface Integration { label: string; url: string }

export const DEFAULT_PROFILE: ProfilePrefs = {
  primary: '#5865f2', accent: '#5865f2', about: 'Привет! Я использую Ponoi.',
  petUrl: null, petKind: 'none', petOn: false, petSize: 180, petPos: 'tr',
  petFree: { x: 80, y: 22 },
  pronouns: '', integrations: [], createdAt: null,
  plateUrl: null, plateKind: 'none', plateOutline: null,
  nickFont: '', nickFontUrl: null,
  msgFont: '', msgFontUrl: null,
}


// pet_pos в БД — text: либо пресет ('tr', 'br', …), либо «free|x,y» — проценты
// центра питомца, единые для всех мест показа профиля (v1.57.0). Старый формат
// «free|mx,my|bx,by» (раздельные позиции) читаем, беря позицию мини. Миграция не нужна.
function parsePetPos(v: any): { petPos: PetPos; petFree: PetFree } {
  const def = DEFAULT_PROFILE.petFree
  if (typeof v !== 'string' || !v) return { petPos: DEFAULT_PROFILE.petPos, petFree: def }
  if (v.startsWith('free')) {
    const m = (v.split('|')[1] ?? '').split(',')
    const x = parseFloat(m[0]), y = parseFloat(m[1])
    return { petPos: 'free', petFree: isFinite(x) && isFinite(y) ? { x, y } : def }
  }
  return { petPos: v as PetPos, petFree: def }
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
    ...parsePetPos(r.pet_pos),
    pronouns: r.pronouns ?? '',
    integrations: Array.isArray(r.integrations) ? r.integrations : [],
    createdAt: r.created_at ?? null,
    plateUrl: r.nameplate_url ?? null,
    plateKind: (r.nameplate_kind as any) ?? 'none',
    plateOutline: r.nameplate_outline ?? null,
    nickFont: r.nick_font ?? '',
    nickFontUrl: r.nick_font_url ?? null,
    msgFont: r.msg_font ?? '',
    msgFontUrl: r.msg_font_url ?? null,
  }
}

function toRow(p: Partial<ProfilePrefs>, full: ProfilePrefs): any {
  const r: any = {}
  if (p.primary !== undefined) r.primary_color = p.primary
  if (p.accent !== undefined) r.accent_color = p.accent
  if (p.about !== undefined) r.about = p.about
  if (p.petUrl !== undefined) r.pet_url = p.petUrl
  if (p.petKind !== undefined) r.pet_kind = p.petKind
  if (p.petOn !== undefined) r.pet_on = p.petOn
  if (p.petSize !== undefined) r.pet_size = p.petSize
  if (p.petPos !== undefined || p.petFree !== undefined)
    r.pet_pos = full.petPos === 'free'
      ? `free|${full.petFree.x.toFixed(1)},${full.petFree.y.toFixed(1)}`
      : full.petPos
  if (p.pronouns !== undefined) r.pronouns = p.pronouns
  if (p.integrations !== undefined) r.integrations = p.integrations
  if (p.plateUrl !== undefined) r.nameplate_url = p.plateUrl
  if (p.plateKind !== undefined) r.nameplate_kind = p.plateKind
  if (p.plateOutline !== undefined) r.nameplate_outline = p.plateOutline
  if (p.nickFont !== undefined) r.nick_font = p.nickFont || null
  if (p.nickFontUrl !== undefined) r.nick_font_url = p.nickFontUrl
  if (p.msgFont !== undefined) r.msg_font = p.msgFont || null
  if (p.msgFontUrl !== undefined) r.msg_font_url = p.msgFontUrl
  return r
}

// last-known values per user, so partial saves can merge without a re-fetch.
// v1.142.0: зеркалим последние настройки в localStorage, чтобы украшения профиля
// (цвета баннера, питомец, «кубик», шрифт ника) показывались сразу при открытии
// аккаунта/мини-профиля — без мелькания стандартного оформления перед загрузкой.
const cache: Record<string, ProfilePrefs> = {}
const ppLsKey = (id: string) => 'ponoi_pp_' + id
function persistProfile(id: string, p: ProfilePrefs) {
  try { localStorage.setItem(ppLsKey(id), JSON.stringify(p)) } catch {}
}
// Синхронный доступ к последним известным настройкам профиля (память -> localStorage
// -> null). Для мгновенной инициализации карточек профиля без ожидания сети.
export function cachedProfile(id?: string | null): ProfilePrefs | null {
  if (!id) return null
  if (cache[id]) return cache[id]
  try {
    const raw = localStorage.getItem(ppLsKey(id))
    if (raw) { const p = { ...DEFAULT_PROFILE, ...JSON.parse(raw) } as ProfilePrefs; cache[id] = p; return p }
  } catch {}
  return null
}

const COLS_BASE = 'primary_color, accent_color, about, pet_url, pet_kind, pet_on, pet_size, pet_pos'
const COLS_EXT = COLS_BASE + ', pronouns, integrations, created_at'
const COLS_PLATE = COLS_EXT + ', nameplate_url, nameplate_kind, nameplate_outline'
const COLS_FONT = COLS_PLATE + ', nick_font, nick_font_url'
const COLS_MSG = COLS_FONT + ', msg_font, msg_font_url'

export async function fetchProfile(id: string): Promise<ProfilePrefs> {
  if (!id) return { ...DEFAULT_PROFILE }
  // Расширенные колонки появляются после миграции 15; до неё откатываемся на базовый набор.
  // Колонки «кубика» появляются после миграции 24, расширенные — после 15; откатываемся ступенчато.
  let { data, error } = await supabase.from('profiles').select(COLS_MSG).eq('id', id).maybeSingle()
  if (error) ({ data, error } = await supabase.from('profiles').select(COLS_FONT).eq('id', id).maybeSingle())
  if (error) ({ data, error } = await supabase.from('profiles').select(COLS_PLATE).eq('id', id).maybeSingle())
  if (error) ({ data, error } = await supabase.from('profiles').select(COLS_EXT).eq('id', id).maybeSingle())
  if (error) ({ data } = await supabase.from('profiles').select(COLS_BASE).eq('id', id).maybeSingle())
  const p = fromRow(data)
  cache[id] = p
  persistProfile(id, p)
  return p
}

export async function saveProfile(id: string, patch: Partial<ProfilePrefs>): Promise<ProfilePrefs> {
  const next = { ...(cache[id] ?? DEFAULT_PROFILE), ...patch }
  cache[id] = next
  persistProfile(id, next)
  await supabase.from('profiles').update(toRow(patch, next)).eq('id', id)
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
// v1.110.0: шрифт ника. Пресет хранится как CSS font-family; свой файл шрифта —
// как URL (Supabase Storage), под него на лету создаётся @font-face.
const fontFaces = new Map<string, string>()
export function customNickFamily(url: string): string {
  let fam = fontFaces.get(url)
  if (fam) return fam
  let h = 0
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0
  fam = 'ponoi-nick-' + Math.abs(h).toString(36)
  const st = document.createElement('style')
  st.textContent = `@font-face{font-family:'${fam}';src:url('${url.replace(/'/g, '%27')}');font-display:swap;}`
  document.head.appendChild(st)
  fontFaces.set(url, fam)
  return fam
}
export function nickFontOf(p: Pick<ProfilePrefs, 'nickFont' | 'nickFontUrl'>): string | undefined {
  if (p.nickFontUrl) return `'${customNickFamily(p.nickFontUrl)}', sans-serif`
  return p.nickFont || undefined
}
// v1.112.0: шрифт сообщений — тот же принцип, что и шрифт ника.
export function msgFontOf(p: Pick<ProfilePrefs, 'msgFont' | 'msgFontUrl'>): string | undefined {
  if (p.msgFontUrl) return `'${customNickFamily(p.msgFontUrl)}', sans-serif`
  return p.msgFont || undefined
}
