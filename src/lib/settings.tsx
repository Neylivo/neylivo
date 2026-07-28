import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { setTime24 } from './ui'
import { applyLang } from './i18n'
import { applyAppIcon, DEFAULT_APP_ICON } from './appIcon'
import { getUserPrefs, patchUserPrefs } from './userPrefs'
import { customNickFamily } from './profilePrefs'
// v1.337.0: сами данные и их запись/чтение — в settingsStore.ts. Там же они и
// проверяются (npm run test:settings): «сохраняется ли настройка» невозможно
// проверить, пока это перемешано с React-провайдером.
import {
  DEFAULTS, DEFAULT_CUSTOM, ACCOUNT_KEYS, isAccountKey, loadSettings, saveSettings,
  type Settings, type CustomTheme,
} from './settingsStore'
export { DEFAULTS, DEFAULT_CUSTOM } from './settingsStore'
export type { Settings, CustomTheme } from './settingsStore'

// Account-level переключатели (уведомления, кто может писать в ЛС, сбор данных) —
// синхронизируются через user_prefs (миграция 39), а не только на этом устройстве.
// Остальные поля Settings (тема, зум, шрифт, хоткеи, громкость...) — про это устройство,
// остаются в localStorage.
function withAccount(s: Settings): Settings {
  const acc = getUserPrefs().account
  const next = { ...s }
  for (const k of ACCOUNT_KEYS) if (acc[k] !== undefined) (next as any)[k] = acc[k]
  return next
}

export interface ThemeDef { key: string; name: string; dark: string; main: string; panel: string; content: string; hover: string; active: string; accent: string; tx: string; mut: string }

// v1.296.0: светлая ли тема — по воспринимаемой яркости основного фона. Формула
// стандартная (веса каналов под чувствительность глаза), порог 0.6 разделяет
// светлые темы от тёмных с запасом: у самой светлой тёмной темы яркость ~0.22.
function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

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
  // Пометка из v1.62.0 сохраняется: по ней отличается «человек уже пользовался
  // приложением» от первого запуска.
  try { if (!localStorage.getItem('ponoi_mig_162')) localStorage.setItem('ponoi_mig_162', '1') } catch {}
  return withAccount(loadSettings())
}

function apply(s: Settings) {
  const root = document.documentElement
  // Автосмена темы: днём (8:00–20:00) — светлая, ночью — выбранная. По умолчанию выключена.
  // Системная настройка приоритетнее расписания: она отражает то, что человек
  // выбрал сам, а расписание — лишь догадку о том, когда ему светло.
  const sysLight = s.systemTheme && typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: light)').matches
  const day = sysLight || (s.autoTheme && (() => { const h = new Date().getHours(); return h >= 8 && h < 20 })())
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
  // v1.296.0: подложки наведения и выделения по всему приложению были жёстко
  // белыми полупрозрачными (rgba(255,255,255,.08) и подобные — почти 300 мест).
  // На тёмных темах это работает, а на светлой белое по белому попросту исчезает:
  // активный канал и выделенные строки становились невидимыми. Здесь считаем,
  // светлая тема или тёмная, и переворачиваем цвет подложки. На тёмных темах
  // значение остаётся прежним (255,255,255), поэтому вид не меняется вообще.
  const light = isLightColor(use.content)
  root.style.setProperty('--ov', light ? '0,0,0' : '255,255,255')
  // Усиленный текст (выделенный пункт, активная вкладка) был жёстко белым. На
  // тёмных темах это остаётся белым и вид не меняется, на светлой становится
  // почти чёрным — иначе подпись выделенного пункта сливалась бы с фоном.
  root.style.setProperty('--tx-hi', light ? '#1a1a1c' : '#ffffff')
  // Имя автора сообщения чуть мягче белого — на тёмных темах оставляем ровно
  // прежний оттенок, иначе это было бы видимым изменением, а не починкой.
  root.style.setProperty('--tx-name', light ? '#1a1a1c' : '#f2f3f5')
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

/**
 * Режим разработчика («Дополнительно» → «Режим разработчика»).
 *
 * v1.332.0: тумблер сохранялся и не читался вообще нигде, а пункты «Копировать ID»
 * висели во всех контекстных меню всегда — то есть настройка обещала показать то,
 * что и так показано, и выключить это было нельзя. Теперь как в Discord: пункты с
 * ID появляются только при включённом режиме. Читаем в момент отрисовки меню —
 * меню живёт долю секунды, подписка на изменения тут ни к чему.
 */
export const devMode = (): boolean => _current.devmode

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  useEffect(() => { apply(settings); _current = settings }, [settings])
  // v1.332.0: своя активность живёт в presence, а presence поднимается выше этого
  // провайдера и настройки читает напрямую из localStorage — сообщаем ему, что
  // текст поменялся, иначе новый статус увидели бы только после перезапуска.
  useEffect(() => {
    window.dispatchEvent(new Event('ponoi-activity'))
  }, [settings.actOn, settings.actText])
  // Язык интерфейса: применяем перевод при старте и при смене.
  useEffect(() => { applyLang(settings.lang) }, [settings.lang])
  // v1.158.0: логотип приложения — favicon сразу, иконка окна/трея в Electron (асинхронно).
  useEffect(() => { applyAppIcon(settings.appIcon) }, [settings.appIcon])
  // v1.309.0: система переключила тему — реагируем сразу, а не через минуту.
  useEffect(() => {
    if (!settings.systemTheme || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const h = () => setSettings(prev => ({ ...prev }))
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [settings.systemTheme])
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
  const persist = (next: Settings) => saveSettings(next)
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
