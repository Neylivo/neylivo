// v1.337.0: чистая часть настроек — что именно хранится и как это попадает в
// localStorage и обратно.
//
// Вынесено из settings.tsx, чтобы это можно было по-настоящему проверить без
// браузера (npm run test:settings). Жалобу «настройка не сохраняется» иначе не
// проверить: чтением кода видно, что setItem вызывается, но не видно, вернётся
// ли значение при следующей загрузке.
//
// Тут намеренно НЕТ синхронизации между устройствами (user_prefs): она
// накладывается поверх уже в settings.tsx. Здесь — только этот компьютер.
import { DEFAULT_APP_ICON } from './appIcon'

export interface CustomTheme {
  dark: string; main: string; panel: string; content: string; hover: string; active: string; accent: string
  dim: number
  on: boolean
}

export const DEFAULT_CUSTOM: CustomTheme = {
  dark: '#1e1f22', main: '#23272a', panel: '#2b2d31', content: '#313338', hover: '#383a40', active: '#35373c', accent: '#5865f2', dim: 35, on: false,
}

export const KEY = 'ponoi_settings'

/**
 * Настройки, которые синхронизируются между устройствами через user_prefs.
 * Остальные — про это устройство и живут только здесь.
 */
export const ACCOUNT_KEYS = [
  'notifSystem', 'notifSounds', 'mentionsOnly', 'unreadBadge', 'notifFriendRequests',
  'hideLastSeen', 'defaultServerNotif',
] as const
export type AccountKey = typeof ACCOUNT_KEYS[number]
export const isAccountKey = (k: string): k is AccountKey => (ACCOUNT_KEYS as readonly string[]).includes(k)

export interface Settings {
  theme: string
  accent: string
  custom: CustomTheme
  compact: boolean
  fontPx: number
  zoom: number
  animations: boolean
  autoTheme: boolean
  systemTheme: boolean
  notifSystem: boolean
  notifSounds: boolean
  mentionsOnly: boolean
  unreadBadge: boolean
  notifFriendRequests: boolean
  micVol: number
  spkVol: number
  lang: string
  hideLastSeen: boolean
  e2ee: boolean
  e2eeCalls: boolean
  devmode: boolean
  actOn: boolean
  actText: string
  sbKey: string
  fontFamily: string
  fontFamilyUrl: string
  radius: number
  msgGap: number
  time24: boolean
  showAvatars: boolean
  groupMessages: boolean
  bigEmoji: boolean
  otherFonts: boolean
  sendKey: 'enter' | 'ctrl'
  keyMusic: string
  keyHome: string
  appIcon: string
  pttMode: boolean
  keyPTT: string
  defaultServerNotif: 'all' | 'mentions' | 'mute'
  composerStyle: 'default' | 'outline' | 'glass' | 'neon' | 'compact'
}

export const DEFAULTS: Settings = {
  theme: 'dark', accent: '#5865f2', custom: DEFAULT_CUSTOM, compact: false, fontPx: 16, zoom: 100, animations: true, autoTheme: false, systemTheme: false,
  notifSystem: true, notifSounds: true, mentionsOnly: false, unreadBadge: true, notifFriendRequests: true,
  micVol: 100, spkVol: 100, lang: 'ru', hideLastSeen: false,
  e2ee: true, e2eeCalls: true, devmode: false, actOn: true, actText: '', sbKey: 'Alt+S',
  fontFamily: '', fontFamilyUrl: '', radius: 8, msgGap: 0, time24: true, showAvatars: true, groupMessages: true, bigEmoji: true, otherFonts: true,
  sendKey: 'enter', keyMusic: 'Alt+M', keyHome: 'Alt+H',
  appIcon: DEFAULT_APP_ICON,
  pttMode: false, keyPTT: '',
  defaultServerNotif: 'all',
  composerStyle: 'default',
}

/** Прочитать сохранённое. Битый JSON не должен обезоруживать приложение. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return { ...DEFAULTS, ...p, custom: { ...DEFAULT_CUSTOM, ...(p?.custom ?? {}) } }
    }
  } catch { /* читаем как первый запуск */ }
  const s = { ...DEFAULTS }
  // Первый запуск: языка ещё нигде нет — угадываем по языку системы.
  try {
    const lang = localStorage.getItem('ponoi_lang')
    if (lang) s.lang = lang
    else if (typeof navigator !== 'undefined' && !/^ru/i.test(navigator.language || '')) s.lang = 'en'
    const zoom = localStorage.getItem('ponoi_zoom')
    if (zoom) s.zoom = Number(zoom)
  } catch {}
  return s
}

/** Записать целиком. Возвращает то же значение — удобно в setState. */
export function saveSettings(next: Settings): Settings {
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* переполнено — в памяти всё равно применится */ }
  return next
}
