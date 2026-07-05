// v1.112.0: шрифты пользователей (ник + сообщения) для чата и списка участников.
// Кэш по id пользователя: пресет — это CSS font-family, свой файл — @font-face,
// создаваемый на лету (customNickFamily). Обновляется по событию 'ponoi-profile'.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { customNickFamily } from './profilePrefs'

export interface UserFonts { nick?: string; msg?: string }

const cache = new Map<string, UserFonts>()
const pending = new Set<string>()

function famOf(font?: string | null, url?: string | null): string | undefined {
  if (url) return `'${customNickFamily(url)}', sans-serif`
  return font || undefined
}

export function useUserFonts(ids: (string | undefined | null)[]): (id?: string | null) => UserFonts {
  const [ver, setVer] = useState(0)
  const key = Array.from(new Set(ids.filter((x): x is string => !!x))).sort().join(',')
  useEffect(() => {
    const need = key ? key.split(',').filter(id => !cache.has(id) && !pending.has(id)) : []
    if (!need.length) return
    need.forEach(id => pending.add(id))
    ;(async () => {
      // До миграции 27 нет msg_font, до 26 — nick_font: откатываемся ступенчато.
      let { data, error } = await supabase.from('profiles').select('id, nick_font, nick_font_url, msg_font, msg_font_url').in('id', need)
      if (error) ({ data, error } = await supabase.from('profiles').select('id, nick_font, nick_font_url').in('id', need))
      need.forEach(id => pending.delete(id))
      if (error) { need.forEach(id => cache.set(id, {})); return }
      for (const id of need) {
        const r: any = ((data ?? []) as any[]).find((x: any) => x.id === id)
        cache.set(id, r ? { nick: famOf(r.nick_font, r.nick_font_url), msg: famOf(r.msg_font, r.msg_font_url) } : {})
      }
      setVer(v => v + 1)
    })()
  }, [key, ver])
  // Пользователь сменил шрифт (событие 'ponoi-profile') — сбрасываем его кэш и перечитываем.
  useEffect(() => {
    const h = (e: any) => { const id = e?.detail?.id; if (id && cache.has(id)) { cache.delete(id); setVer(v => v + 1) } }
    window.addEventListener('ponoi-profile', h)
    return () => window.removeEventListener('ponoi-profile', h)
  }, [])
  return id => (id && cache.get(id)) || {}
}
