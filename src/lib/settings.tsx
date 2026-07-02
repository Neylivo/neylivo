
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export interface Settings {
  theme: 'dark' | 'light' | 'midnight'
  accent: string
  compact: boolean
  fontScale: number   // 0.85 .. 1.3
  zoom: number        // 70 .. 130 (%)
  animations: boolean
  notifSystem: boolean
  notifSounds: boolean
  mentionsOnly: boolean
  unreadBadge: boolean
  micVol: number
  spkVol: number
  lang: string
  dmAll: boolean
  dmMembers: boolean
  dataCollect: boolean
  devmode: boolean
  actOn: boolean
  actText: string
}

export const DEFAULTS: Settings = {
  theme: 'dark', accent: '#5865f2', compact: false, fontScale: 1, zoom: 100, animations: true,
  notifSystem: true, notifSounds: true, mentionsOnly: false, unreadBadge: true,
  micVol: 100, spkVol: 100, lang: 'ru', dmAll: true, dmMembers: true, dataCollect: false,
  devmode: false, actOn: false, actText: '',
}

const ACCENTS = ['#5865f2', '#eb459e', '#3ba55d', '#faa61a', '#ed4245', '#9b59b6', '#1abc9c', '#e67e22']

interface SettingsCtx {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  accents: string[]
}
const Ctx = createContext<SettingsCtx>({ settings: DEFAULTS, set: () => {}, accents: ACCENTS })

function load(): Settings {
  try {
    const raw = localStorage.getItem('ponoi_settings')
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  // migrate older single keys
  const s = { ...DEFAULTS }
  const lang = localStorage.getItem('ponoi_lang'); if (lang) s.lang = lang
  const zoom = localStorage.getItem('ponoi_zoom'); if (zoom) s.zoom = Number(zoom)
  return s
}

function apply(s: Settings) {
  const root = document.documentElement
  root.style.setProperty('--c-accent', s.accent)
  root.setAttribute('data-theme', s.theme)
  root.style.setProperty('--font-scale', String(s.fontScale))
  document.body.classList.toggle('compact', s.compact)
  document.body.classList.toggle('no-anim', !s.animations)
  ;(document.body.style as any).zoom = String(s.zoom / 100)
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  useEffect(() => { apply(settings) }, [settings])
  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings(prev => {
      const next = { ...prev, [k]: v }
      localStorage.setItem('ponoi_settings', JSON.stringify(next))
      return next
    })
  }
  return <Ctx.Provider value={{ settings, set, accents: ACCENTS }}>{children}</Ctx.Provider>
}

export const useSettings = () => useContext(Ctx)
