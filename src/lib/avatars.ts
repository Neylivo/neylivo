
// v1.102.0: единый источник аватарок для всего приложения.
// Проблема: аватарки в разных местах брались из разных источников (замороженная копия
// в строке сообщения, кэш присутствия, join профилей, а где-то не подтягивались вовсе) —
// у одного и того же человека аватарка была видна в одном месте и отсутствовала в другом.
// Решение: живой кэш profiles.avatar_url. Компонент Avatar получает userId и берёт
// актуальную аватарку отсюда; кэш обновляется реалтаймом при смене аватарки —
// у всех и везде одинаково, сразу.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const cache: Record<string, string | null> = {}
const pending = new Set<string>()
const listeners = new Set<() => void>()
let timer: number | null = null
let subscribed = false

function notify() { listeners.forEach(l => { try { l() } catch {} }) }

// Реалтайм: кто-то сменил аватарку — обновляем кэш, все Avatar перерисовываются.
function ensureRealtime() {
  if (subscribed) return
  subscribed = true
  try {
    supabase.channel('avatars:profiles')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, p => {
        const row = p.new as any
        if (!row?.id) return
        cache[row.id] = row.avatar_url ?? null
        notify()
      })
      .subscribe()
  } catch {}
}

// Запросы за неизвестными профилями батчатся (окно 50 мс) в один .in() запрос.
function flush() {
  timer = null
  const ids = [...pending]
  pending.clear()
  if (!ids.length) return
  supabase.from('profiles').select('id, avatar_url').in('id', ids)
    .then(({ data }) => {
      for (const id of ids) if (!(id in cache)) cache[id] = null   // профиля нет — «без аватарки», не перезапрашиваем
      for (const r of ((data ?? []) as any[])) cache[r.id] = r.avatar_url ?? null
      notify()
    })
}

export function requestAvatar(userId: string) {
  if (userId in cache || pending.has(userId)) return
  pending.add(userId)
  if (timer == null) timer = window.setTimeout(flush, 50)
}

// v1.223.0: синхронное чтение кэша вне React (например, в обработчике realtime-
// события для OS-уведомления) — групповые беседы не могут заранее знать заранее,
// чья аватарка понадобится (в 1-в-1 это всегда была аватарка «активного друга»).
export function avatarOf(userId: string): string | null | undefined {
  requestAvatar(userId)
  return cache[userId]
}

/** Актуальная аватарка пользователя: undefined — ещё грузится, null — нет аватарки. */
export function useAvatarOf(userId?: string | null): string | null | undefined {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!userId) return
    ensureRealtime()
    requestAvatar(userId)
    const l = () => bump(v => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [userId])
  return userId ? cache[userId] : undefined
}
