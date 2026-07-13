// v1.272.0: устойчивый клиент — при падении/недоступности Supabase (см. диагноз
// 522 от Cloudflare) списки серверов/друзей/каналов раньше молча становились
// пустыми (myServers()/loadRequests() глотали ошибку сети и просто не находили
// строк) — выглядело неотличимо от «у тебя правда ничего нет». Здесь — простой
// кэш последнего успешного снимка в localStorage: рисуем его СРАЗУ при старте,
// а сеть в фоне обновляет и перезаписывает кэш по факту успеха.
const PREFIX = 'ponoi_cache_'

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

export function cacheSet<T>(key: string, value: T) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)) } catch {}
}
