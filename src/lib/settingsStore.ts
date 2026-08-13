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
  // v1.477.0: отметка «просмотрено» — про человека, а не про устройство.
  'readReceipts',
] as const
export type AccountKey = typeof ACCOUNT_KEYS[number]
export const isAccountKey = (k: string): k is AccountKey => (ACCOUNT_KEYS as readonly string[]).includes(k)

// v1.453.0: на телефоне свайпы включены сразу, на компьютере — нет.
const IS_MOBILE_DEFAULT = (() => {
  try { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') } catch { return false }
})()

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
  /** Показывать собеседнику, что я прочитал. Выключено — своя отметка не
   *  пишется и чужая не показывается: в обе стороны или никак (v1.477.0). */
  readReceipts: boolean
  micVol: number
  spkVol: number
  /** ИИ-шумоподавление (Krisp) в звонке. v1.409.0 */
  krisp: boolean
  lang: string
  hideLastSeen: boolean
  e2ee: boolean
  e2eeCalls: boolean
  /**
   * Шифровать ли вложения в личке (v1.385.0).
   *
   * По умолчанию выключено. Текст шифруется по-прежнему — с ним всё в порядке.
   * А вот вложения на деле оказались недоступны: файл уезжает шифротекстом с
   * типом application/octet-stream, и если расшифровать его не удалось, человек
   * видит не картинку, а «это не картинка». Неоткрывающееся фото — это не
   * приватность, это потерянное фото.
   *
   * Настройку оставляем: кому шифрование вложений важнее удобства, включит.
   * Уже отправленные зашифрованными вложения расшифровываются как и раньше —
   * выключение касается только новых.
   */
  e2eeFiles: boolean
  /** Рисовать эмодзи картинками Twemoji (с чужого сервера) или системными. */
  emojiImages: boolean
  /** Откуда логотип приложения: из сборки (обновляется сам) или свой файл. */
  appIconSource?: 'official' | 'own'
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

  /** v1.453.0: свайпы от края экрана (шторки на телефоне). */
  swipes: boolean
  /**
   * v1.511.0: беречь ресурсы, пока идёт игра, а окно приложения позади.
   *
   * Включено сразу: это не ухудшение, а отказ от работы, которой в этот миг
   * никто не видит. Кому нужно, чтобы приложение всегда работало в полную силу
   * (например, спектр смотрят на втором экране), — выключает.
   */
  saveWhileGaming: boolean
  /**
   * v1.513.0: подсветка рамкой вокруг строки ввода, пока в ней пишут.
   *
   * ВЫКЛЮЧЕНА изначально — по прямому указанию владельца. Она обводила синим
   * всю строку целиком, вместе с плюсом и микрофоном, и он попросил убрать её,
   * а не прятать в настройках включённой.
   */
  focusRing: boolean
  /** v1.538.0: держать последние секунды экрана (как в Medal). */
  clipsOn: boolean
  /** Сколько секунд держать: от 5 до 180. */
  clipSeconds: number
  /** Качество записи: экономно, обычное, чётко. */
  clipQuality: string
}

export const DEFAULTS: Settings = {
  theme: 'dark', accent: '#5865f2', custom: DEFAULT_CUSTOM, compact: false, fontPx: 16, zoom: 100, animations: true, autoTheme: false, systemTheme: false,
  notifSystem: true, notifSounds: true, mentionsOnly: false, unreadBadge: true, notifFriendRequests: true,
  readReceipts: true,
  micVol: 100, spkVol: 100, krisp: true, lang: 'ru', hideLastSeen: false,
  // v1.453.0: свайпы от края открывают шторки на телефоне. По умолчанию
  // включены только там: на компьютере жест от края мешал бы выделению.
  swipes: IS_MOBILE_DEFAULT,
  saveWhileGaming: true,
  focusRing: false,
  clipsOn: false, clipSeconds: 30, clipQuality: 'mid',
  // v1.387.0: всё шифрование выключено по умолчанию — решение владельца.
  //
  // Что это значит по-честному: содержимое личной переписки, вложений и звонков
  // становится доступно серверу. Скрывать его от сервера перестаём — это не
  // «стало хуже работать», это другой выбор, и человек может вернуть прежнее
  // тремя переключателями в «Приватности».
  //
  // Ключи устройства при этом никуда не деваются: уже зашифрованная переписка
  // читается как и раньше, а включив настройку обратно, человек сразу продолжит
  // шифровать — заново ничего заводить не придётся.
  e2ee: false, e2eeCalls: false, e2eeFiles: false, emojiImages: true, devmode: false, actOn: true, actText: '', sbKey: 'Alt+S',
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
