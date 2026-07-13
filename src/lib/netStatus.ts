import { useEffect, useState } from 'react'

// v1.272.0: сигнал «сеть до Supabase сейчас не отвечает» — не браузерный
// navigator.onLine (тот молчит, если Wi-Fi есть, а именно Supabase лежит —
// см. диагноз 522 от Cloudflare), а по факту успеха/неуспеха РЕАЛЬНЫХ запросов.
// Компоненты, грузящие ключевые списки (сервера, друзья, каналы), зовут
// netOk()/netFail() вокруг запроса. Две подряд неудачи — баннер «нет связи»,
// одна успешная — сразу гаснет (не ждём отдельного «всё ок» после сбоя).
let fails = 0
const listeners = new Set<() => void>()
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

export function isNetDegraded(): boolean { return fails >= 2 }

export function netOk() {
  if (fails === 0) return
  fails = 0
  notify()
}

export function netFail() {
  fails++
  if (fails === 2) notify()
}

export function useNetDegraded(): boolean {
  const [v, setV] = useState(isNetDegraded)
  useEffect(() => {
    const fn = () => setV(isNetDegraded())
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return v
}
