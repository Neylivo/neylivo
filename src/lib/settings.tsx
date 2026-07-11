import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { setTime24 } from './ui'
import { applyLang } from './i18n'
import { applyAppIcon, DEFAULT_APP_ICON } from './appIcon'
import { getUserPrefs, patchUserPrefs } from './userPrefs'
import { customNickFamily } from './profilePrefs'

// Account-level переключатели (уведомления, кто может писать в ЛС, сбор данных) —
// синхронизируются через user_prefs (миграция 39), а не только на этом устройстве.
// Остальные поля Settings (тема, зум, шрифт, хоткеи, громкость...) — про это устройство,
// остаются в localStorage.
const ACCOUNT_KEYS = ['notifSystem', 'notifSounds', 'mentionsOnly', 'unreadBadge', 'dataCollect'] as const
type AccountKey = typeof ACCOUNT_KEYS[number]
function isAccountKey(k: string): k is AccountKey { return (ACCOUNT_KEYS as readonly string[]).includes(k) }
function withAccount(s: Settings): Settings {
  const acc = getUserPrefs().account
  const next = { ...s }
  for (const k of ACCOUNT_KEYS) if (acc[k] !== undefined) (next as any)[k] = acc[k]
  return next
}

export interface CustomTheme {
  dark: string; main: string; panel: string; content: string; hover: string; active: string; accent: string
  dim: number       // texture dim 0..100 (reserved for texture backgrounds)
  on: boolean       // whether custom theme overrides the preset
}

export interface Settings {
  theme: string       // preset key (see THEMES)
  accent: string
  custom: CustomTheme
  compact: boolean
  fontPx: number      // 12 .. 20 (px)
  zoom: number        // 70 .. 130 (%)
  animations: boolean
  autoTheme: boolean   // автосмена темы по времени суток (по умолчанию выключена)
  notifSystem: boolean
  notifSounds: boolean
  mentionsOnly: boolean
  unreadBadge: boolean
  micVol: number
  spkVol: number
  lang: string
  // v1.230.0: dmAll/dmMembers жили тут, но никогда никак не проверялись — чисто
  // декоративные тумблеры. Настоящая приватность ЛС/звонков переехала в
  // ProfilePrefs (dmMessagePrivacy/dmCallPrivacy, публичные profiles.*), т.к.
  // проверять её нужно и другим людям (RLS/Edge Function), не только владельцу.
  dataCollect: boolean
  devmode: boolean
  actOn: boolean
  actText: string
  sbKey: string   // in-call: save last 15s of the conversation
  fontFamily: string   // '' = system
  fontFamilyUrl: string   // v1.166.0: свой файл шрифта интерфейса (.ttf/.otf/.woff/.woff2), '' = использовать fontFamily
  radius: number       // UI corner radius px
  msgGap: number       // extra gap between messages px
  time24: boolean      // 24h vs 12h clock
  showAvatars: boolean
  groupMessages: boolean
  bigEmoji: boolean    // render emoji-only messages large
  otherFonts: boolean  // v1.112.0: показывать шрифты ника/сообщений других пользователей в чате
  sendKey: 'enter' | 'ctrl'
  keyMusic: string
  keyHome: string
  appIcon: string   // v1.160.0: свой логотип приложения — data URL загруженного файла, '' = стандартный
}

// 10 named theme presets. Each overrides the core design tokens; the app aliases
// (--bg/--bg2/--bg3/--brand) derive from these automatically.
export interface ThemeDef { key: string; name: string; dark: string; main: string; panel: string; content: string; hover: string; active: string; accent: string; tx: string; mut: string }
export const THEMES: ThemeDef[] = [
  { key:'dark',     name:'Discord',  dark:'#1e1f22', main:'#23272a', panel:'#2b2d31', content:'#313338', hover:'#383a40', active:'#35373c', accent:'#5865f2', tx:'#dbdee1', mut:'#949ba4' },
  { key:'light',    name:'Светлая',  dark:'#e3e5e8', main:'#ebedef', panel:'#f2f3f5', content:'#ffffff', hover:'#e8eaed', active:'#e0e2e6', accent:'#5865f2', tx:'#313338', mut:'#5c5e66' },
  { key:'midnight', name:'Полночь',  dark:'#000000', main:'#050506', panel:'#111318', content:'#0b0b0e', hover:'#1a1c22', active:'#16181d', accent:'#4752c4', tx:'#dbdee1', mut:'#8a8f98' },
  { key:'forest',   name:'Лес',      dark:'#12211a', main:'#16281f', panel:'#1b3327', content:'#1f3b2d', hover:'#274b39', active:'#22422f', accent:'#3ba55d', tx:'#dbe5df', mut:'#8fa89a' },
  { key:'rose',     name:'Роза',     dark:'#25131d', main:'#2c1723', panel:'#361c2b', content:'#3d2031', hover:'#4d2a3e', active:'#442436', accent:'#eb459e', tx:'#e8dae2', mut:'#b08fa1' },
  { key:'sunset',   name:'Закат',    dark:'#241812', main:'#2b1d15', panel:'#35241a', content:'#3d291d', hover:'#4d3526', active:'#442f21', accent:'#faa61a', tx:'#e8ddd3', mut:'#b0a08f' },
  { key:'amethyst', name:'Аметист',  dark:'#1d1329', main:'#231731', panel:'#2c1c3d', content:'#321f45', hover:'#3f2a55', active:'#38244c', accent:'#9b59b6', tx:'#e0dae8', mut:'#a08fb0' },
  { key:'ocean',    name:'Океан',    dark:'#0f2027', main:'#12262f', panel:'#173039', content:'#1a3742', hover:'#234652', active:'#1f3e49', accent:'#1abc9c', tx:'#d3e5e8', mut:'#8fa5ab' },
  { key:'crimson',  name:'Багровый', dark:'#261213', main:'#2d1617', panel:'#381b1c', content:'#401f20', hover:'#502829', active:'#472324', accent:'#ed4245', tx:'#e8d8d8', mut:'#b08f8f' },
  { key:'graphite', name:'Графит',   dark:'#1a1a1c', main:'#202022', panel:'#2a2a2d', content:'#303033', hover:'#3a3a3e', active:'#333336', accent:'#80848e', tx:'#dbdee1', mut:'#949ba4' },
  { key:'cosmos',   name:'Космос',   dark:'#0d0f1e', main:'#111427', panel:'#181c33', content:'#1c213d', hover:'#262c4d', active:'#212642', accent:'#5865f2', tx:'#dbdee8', mut:'#8f93b0' },
]

export const DEFAULT_CUSTOM: CustomTheme = {
  dark:'#1e1f22', main:'#23272a', panel:'#2b2d31', content:'#313338', hover:'#383a40', active:'#35373c', accent:'#5865f2', dim:35, on:false,
}

export const DEFAULTS: Settings = {
  theme: 'dark', accent: '#5865f2', custom: DEFAULT_CUSTOM, compact: false, fontPx: 16, zoom: 100, animations: true, autoTheme: false,
  notifSystem: true, notifSounds: true, mentionsOnly: false, unreadBadge: true,
  micVol: 100, spkVol: 100, lang: 'ru', dataCollect: true,
  devmode: false, actOn: true, actText: '', sbKey: 'Alt+S',
  fontFamily: '', fontFamilyUrl: '', radius: 8, msgGap: 0, time24: true, showAvatars: true, groupMessages: true, bigEmoji: true, otherFonts: true,
  sendKey: 'enter', keyMusic: 'Alt+M', keyHome: 'Alt+H',
  appIcon: DEFAULT_APP_ICON,
}

const ACCENTS = ['#5865f2', '#eb459e', '#3ba55d', '#faa61a', '#ed4245', '#9b59b6', '#1abc9c', '#e67e22']

interface SettingsCtx {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  setCustom: (patch: Partial<CustomTheme>) => void
  accents: string[]
  themes: ThemeDef[]
}
const Ctx = createContext<SettingsCtx>({ settings: DEFAULTS, set: () => {}, setCustom: () => {}, accents: ACCENTS, themes: THEMES })

function load(): Settings {
  try {
    const raw = localStorage.getItem('ponoi_settings')
    if (raw) {
      const p = JSON.parse(raw)
      const s = { ...DEFAULTS, ...p, custom: { ...DEFAULT_CUSTOM, ...(p.custom ?? {}) } }
      // v1.62.0: одноразовая миграция — сбор данных включён по умолчанию
      if (!localStorage.getItem('ponoi_mig_162')) {
        s.dataCollect = true
        localStorage.setItem('ponoi_mig_162', '1')
        localStorage.setItem('ponoi_settings', JSON.stringify(s))
      }
      return withAccount(s)
    }
    localStorage.setItem('ponoi_mig_162', '1')
  } catch {}
  const s = { ...DEFAULTS }
  // v1.167.0: первый запуск, языка ещё нигде не сохранено — угадываем по языку
  // ОС/браузера, а не жёстко на русский. Не трогает тех, у кого lang уже сохранён.
  const lang = localStorage.getItem('ponoi_lang')
  if (lang) s.lang = lang
  else if (typeof navigator !== 'undefined' && !/^ru/i.test(navigator.language || '')) s.lang = 'en'
  const zoom = localStorage.getItem('ponoi_zoom'); if (zoom) s.zoom = Number(zoom)
  return withAccount(s)
}

function apply(s: Settings) {
  const root = document.documentElement
  // Автосмена темы: днём (8:00–20:00) — светлая, ночью — выбранная. По умолчанию выключена.
  const day = s.autoTheme && (() => { const h = new Date().getHours(); return h >= 8 && h < 20 })()
  const def = THEMES.find(t => t.key === (day ? 'light' : s.theme)) ?? THEMES[0]
  const c = s.custom
  const use = (c.on && !day)
    ? { dark:c.dark, main:c.main, panel:c.panel, content:c.content, hover:c.hover, active:c.active, accent:c.accent, tx:def.tx, mut:def.mut }
    : def
  root.style.setProperty('--c-dark', use.dark)
  root.style.setProperty('--c-main', use.main)
  root.style.setProperty('--c-panel', use.panel)
  root.style.setProperty('--c-content', use.content)
  root.style.setProperty('--c-hover', use.hover)
  root.style.setProperty('--c-active', use.active)
  root.style.setProperty('--c-accent', (c.on && !day) ? c.accent : (day ? def.accent : (s.accent || use.accent)))
  root.style.setProperty('--tx', use.tx)
  root.style.setProperty('--mut', use.mut)
  root.setAttribute('data-theme', day ? 'light' : s.theme)
  root.style.setProperty('--font-scale', String(s.fontPx / 16))
  root.style.setProperty('--font-px', s.fontPx + 'px')
  document.body.classList.toggle('compact', s.compact)
  document.body.classList.toggle('no-anim', !s.animations)
  ;(document.body.style as any).zoom = String(s.zoom / 100)
  root.style.setProperty('--radius', s.radius + 'px')
  root.style.setProperty('--msg-gap', s.msgGap + 'px')
  document.body.style.fontFamily = s.fontFamilyUrl ? customNickFamily(s.fontFamilyUrl) : (s.fontFamily || '')
  setTime24(s.time24)
}

// Синхронный доступ к текущим настройкам вне React (звуки, интервалы) — модульное
// зеркало, обновляется вместе с состоянием провайдера.
let _current: Settings = DEFAULTS
export function getSettings(): Settings { return _current }

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  useEffect(() => { apply(settings); _current = settings }, [settings])
  // Язык интерфейса: применяем перевод при старте и при смене.
  useEffect(() => { applyLang(settings.lang) }, [settings.lang])
  // v1.158.0: логотип приложения — favicon сразу, иконка окна/трея в Electron (асинхронно).
  useEffect(() => { applyAppIcon(settings.appIcon) }, [settings.appIcon])
  // Автосмена темы: перепроверяем время раз в минуту.
  useEffect(() => {
    if (!settings.autoTheme) return
    const id = setInterval(() => setSettings(prev => ({ ...prev })), 60000)
    return () => clearInterval(id)
  }, [settings.autoTheme])
  // Account-level часть настроек могла догрузиться с сети уже после старта приложения.
  useEffect(() => {
    const onSync = () => setSettings(prev => withAccount(prev))
    window.addEventListener('ponoi-uprefs', onSync)
    return () => window.removeEventListener('ponoi-uprefs', onSync)
  }, [])
  function persist(next: Settings) { localStorage.setItem('ponoi_settings', JSON.stringify(next)); return next }
  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings(prev => persist({ ...prev, [k]: v }))
    if (isAccountKey(k as string)) patchUserPrefs({ account: { ...getUserPrefs().account, [k]: v } })
  }
  function setCustom(patch: Partial<CustomTheme>) {
    setSettings(prev => persist({ ...prev, custom: { ...prev.custom, ...patch } }))
  }
  return <Ctx.Provider value={{ settings, set, setCustom, accents: ACCENTS, themes: THEMES }}>{children}</Ctx.Provider>
}

export const useSettings = () => useContext(Ctx)
