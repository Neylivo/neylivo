import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// v1.393.0: «кубик» профиля (nameplate) чужих людей.
//
// Настройка обещала «Видно всем», а на деле кубик рисовался в одном-единственном
// месте — в списке участников сервера. Человеку, с которым только переписываешься
// в личных сообщениях, он не показывался нигде: тот видит собеседника в списке ЛС,
// а там кубика не было. Настройка была на вид рабочей и ничего не делала.
//
// Устроено так же, как useUserFonts: общий кэш на все списки, догрузка только
// незнакомых людей и сброс по событию 'ponoi-profile', когда человек поменял
// оформление у себя.

export interface UserPlate {
  url?: string | null
  kind?: 'image' | 'video' | null
  outline?: string | null
}

const cache = new Map<string, UserPlate>()
const pending = new Set<string>()

export function useUserPlates(ids: (string | undefined | null)[]): (id?: string | null) => UserPlate {
  const [ver, setVer] = useState(0)
  const key = Array.from(new Set(ids.filter((x): x is string => !!x))).sort().join(',')
  useEffect(() => {
    const need = key ? key.split(',').filter(id => !cache.has(id) && !pending.has(id)) : []
    if (!need.length) return
    need.forEach(id => pending.add(id))
    ;(async () => {
      // До миграции 24 колонок кубика нет — тогда просто считаем, что его нет ни
      // у кого, и молчим: это украшение, а не поломка.
      const { data, error } = await supabase.from('profiles')
        .select('id, nameplate_url, nameplate_kind, nameplate_outline').in('id', need) as { data: any[] | null; error: any }
      need.forEach(id => pending.delete(id))
      if (error) { need.forEach(id => cache.set(id, {})); return }
      for (const id of need) {
        const r: any = ((data ?? []) as any[]).find((x: any) => x.id === id)
        cache.set(id, r ? { url: r.nameplate_url, kind: r.nameplate_kind === 'video' ? 'video' : 'image', outline: r.nameplate_outline } : {})
      }
      setVer(v => v + 1)
    })()
  }, [key, ver])
  useEffect(() => {
    const h = (e: any) => { const id = e?.detail?.id; if (id && cache.has(id)) { cache.delete(id); setVer(v => v + 1) } }
    window.addEventListener('ponoi-profile', h)
    return () => window.removeEventListener('ponoi-profile', h)
  }, [])
  return id => (id && cache.get(id)) || {}
}
