// Chat background photo (Настройки → Внешний вид → «Фон чата»).
// The image blob lives in IndexedDB (survives reload; localStorage is too small),
// tuning prefs (on/blur/tint) in localStorage. Applied globally via CSS variables
// and the body.chatbg-on class, so both server channels and DMs (.chat) get it.
import { idbSet, idbGet, idbDel } from './idb'

const BLOB_KEY = 'chatbg'
const LS_KEY = 'ponoi_chatbg'

export interface ChatBgPrefs {
  on: boolean     // show the background
  blur: number    // px 0..30
  tint: number    // darkening 0..80 (%) for text readability
  has: boolean    // whether a photo is stored
}

export const DEFAULT_CHATBG: ChatBgPrefs = { on: false, blur: 6, tint: 45, has: false }

let objUrl: string | null = null
let prefs: ChatBgPrefs = load()

function load(): ChatBgPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...DEFAULT_CHATBG, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CHATBG }
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify({ on: prefs.on, blur: prefs.blur, tint: prefs.tint, has: prefs.has })) }

function apply() {
  const root = document.documentElement
  root.style.setProperty('--chatbg-url', objUrl ? `url("${objUrl}")` : 'none')
  root.style.setProperty('--chatbg-blur', prefs.blur + 'px')
  root.style.setProperty('--chatbg-tint', String(prefs.tint / 100))
  document.body.classList.toggle('chatbg-on', prefs.on && !!objUrl)
}

/** Call once on startup: restores the stored photo and applies prefs. */
export async function initChatBg() {
  try {
    const blob = await idbGet(BLOB_KEY)
    if (blob) { objUrl = URL.createObjectURL(blob); prefs.has = true }
    else prefs.has = false
  } catch { prefs.has = false }
  apply()
}

export function loadChatBgPrefs(): ChatBgPrefs { return { ...prefs } }
export function getChatBgUrl(): string | null { return objUrl }

export function setChatBgPrefs(patch: Partial<ChatBgPrefs>): ChatBgPrefs {
  prefs = { ...prefs, ...patch }
  save(); apply()
  return { ...prefs }
}

export async function setChatBgPhoto(file: File): Promise<ChatBgPrefs> {
  await idbSet(BLOB_KEY, file)
  if (objUrl) URL.revokeObjectURL(objUrl)
  objUrl = URL.createObjectURL(file)
  return setChatBgPrefs({ on: true, has: true })
}

export async function clearChatBgPhoto(): Promise<ChatBgPrefs> {
  try { await idbDel(BLOB_KEY) } catch {}
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null }
  return setChatBgPrefs({ on: false, has: false })
}
