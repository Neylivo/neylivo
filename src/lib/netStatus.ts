import { useEffect, useState } from 'react'
import { ЭТО_ОСТАНОВКА } from './humanFail'

// v1.272.0: сигнал «сеть до Supabase сейчас не отвечает» — не браузерный
// navigator.onLine (тот молчит, если Wi-Fi есть, а именно Supabase лежит —
// см. диагноз 522 от Cloudflare), а по факту успеха/неуспеха РЕАЛЬНЫХ запросов.
// Компоненты, грузящие ключевые списки (сервера, друзья, каналы), зовут
// netOk()/netFail() вокруг запроса. Две подряд неудачи — баннер «нет связи»,
// одна успешная — сразу гаснет (не ждём отдельного «всё ок» после сбоя).
//
// v1.563.0: у отказа появилась ВТОРАЯ причина, и путать их нельзя.
// «Нет связи» человек понимает как «у меня интернет барахлит» и жмёт обновить
// по десять раз. Но 16.08.2026 связь была прекрасная: Supabase закрыл проект за
// перерасход трафика и отвечал 402 на каждый запрос. Обновлять было бесполезно —
// и человеку надо было сказать именно это, а не «нет связи».
let fails = 0
/** Проект закрыт за перерасход (402). Отдельно от fails: чинится не ожиданием. */
let stopped = false
// v1.275.0: момент, с которого держится непрерывная деградация — нужен, чтобы
// не предлагать аварийный чат (emergencyChat.ts) при мелком секундном сбое,
// только при ДЕЙСТВИТЕЛЬННО долгом отказе основного бэкенда.
let degradedSince = 0
const listeners = new Set<() => void>()
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

// Остановка засчитывается с ПЕРВОГО раза, без «двух подряд»: 402 — это ответ
// сервера, а не сбой связи, вторым запросом он не опровергается.
export function isNetDegraded(): boolean { return fails >= 2 || stopped }

export function isNetStopped(): boolean { return stopped }

export function netOk() {
  if (fails === 0 && !stopped) return
  fails = 0
  degradedSince = 0
  stopped = false
  notify()
}

/**
 * Запрос не удался.
 *
 * Отказ передавать НЕОБЯЗАТЕЛЬНО — старые вызовы `netFail()` работают как
 * прежде. Но если передать, баннер скажет правду про остановленный проект
 * вместо «нет связи».
 */
export function netFail(отказ?: unknown) {
  fails++
  const код = (отказ as any)?.status ?? (отказ as any)?.context?.status
  if (код === 402 || ЭТО_ОСТАНОВКА.test(String((отказ as any)?.message ?? отказ ?? ''))) {
    if (!stopped) { stopped = true; if (!degradedSince) degradedSince = Date.now(); notify() }
  }
  if (fails === 2) { degradedSince = Date.now(); notify() }
}

export function useNetStopped(): boolean {
  const [v, setV] = useState(isNetStopped)
  useEffect(() => {
    const fn = () => setV(isNetStopped())
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return v
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
