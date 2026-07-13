import { useEffect, useState } from 'react'

// v1.272.0: сигнал «сеть до Supabase сейчас не отвечает» — не браузерный
// navigator.onLine (тот молчит, если Wi-Fi есть, а именно Supabase лежит —
// см. диагноз 522 от Cloudflare), а по факту успеха/неуспеха РЕАЛЬНЫХ запросов.
// Компоненты, грузящие ключевые списки (сервера, друзья, каналы), зовут
// netOk()/netFail() вокруг запроса. Две подряд неудачи — баннер «нет связи»,
// одна успешная — сразу гаснет (не ждём отдельного «всё ок» после сбоя).
let fails = 0
// v1.275.0: момент, с которого держится непрерывная деградация — нужен, чтобы
// не предлагать аварийный чат (emergencyChat.ts) при мелком секундном сбое,
// только при ДЕЙСТВИТЕЛЬННО долгом отказе основного бэкенда.
let degradedSince = 0
const listeners = new Set<() => void>()
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

export function isNetDegraded(): boolean { return fails >= 2 }

export function netOk() {
  if (fails === 0) return
  fails = 0
  degradedSince = 0
  notify()
}

export function netFail() {
  fails++
  if (fails === 2) { degradedSince = Date.now(); notify() }
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

// Сколько мс подряд держится деградация (0 — сейчас всё ок).
export function useNetDegradedForMs(): number {
  const degraded = useNetDegraded()
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (!degraded) { setMs(0); return }
    const id = window.setInterval(() => setMs(Date.now() - degradedSince), 1000)
    setMs(Date.now() - degradedSince)
    return () => window.clearInterval(id)
  }, [degraded])
  return ms
}
