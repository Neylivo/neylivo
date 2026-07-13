// v1.275.0: аварийный резервный чат — отдельный минимальный сервис (см.
// emergency-server/ в корне репозитория, задеплоен на Render), НЕ копия
// основного бэкенда. Свои аккаунты, один общий чат, без серверов/каналов/друзей.
// Показывается только когда основной Supabase недоступен длительное время
// (см. netStatus.ts) — как «хоть куда-то написать», а не полноценная замена.
//
// Бесплатный тариф Render — единственный инстанс без резерва, изредка отвечает
// 404 на секунду при перераспределении маршрутов (см. диагностику при настройке).
// Поэтому каждый запрос — с несколькими попытками, прежде чем показать ошибку.
const BASE = 'https://ponoi-emergency-chat.onrender.com'
const TOKEN_KEY = 'ponoi_ec_token'
const NAME_KEY = 'ponoi_ec_username'

export interface EcMessage { id: number; username: string; content: string; created_at: string }

async function req(path: string, opts: RequestInit = {}, retries = 3): Promise<any> {
  let lastErr: any = null
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
      if (r.status === 404 && i < retries - 1) { await new Promise(res => setTimeout(res, 1200)); continue }
      const text = await r.text()
      let body: any = null
      try { body = text ? JSON.parse(text) : null } catch { body = null }
      if (!r.ok) throw new Error(body?.error || 'Аварийный чат сейчас недоступен (' + r.status + ')')
      return body
    } catch (e) { lastErr = e; if (i < retries - 1) await new Promise(res => setTimeout(res, 1200)) }
  }
  throw lastErr ?? new Error('Аварийный чат недоступен')
}

export function ecToken(): string | null { return localStorage.getItem(TOKEN_KEY) }
export function ecUsername(): string | null { return localStorage.getItem(NAME_KEY) }
export function ecLogout() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NAME_KEY) }

function saveSession(body: { token: string; username: string }) {
  localStorage.setItem(TOKEN_KEY, body.token)
  localStorage.setItem(NAME_KEY, body.username)
}

export async function ecRegister(username: string, password: string) {
  const body = await req('/register', { method: 'POST', body: JSON.stringify({ username, password }) })
  saveSession(body)
  return body.username as string
}

export async function ecLogin(username: string, password: string) {
  const body = await req('/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  saveSession(body)
  return body.username as string
}

export async function ecFetchMessages(): Promise<EcMessage[]> {
  const token = ecToken()
  if (!token) throw new Error('Не авторизован')
  const body = await req('/messages', { headers: { Authorization: 'Bearer ' + token } })
  return body.messages as EcMessage[]
}

export async function ecSendMessage(content: string): Promise<EcMessage> {
  const token = ecToken()
  if (!token) throw new Error('Не авторизован')
  const body = await req('/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ content }) })
  return body.msg as EcMessage
}

// Реалтайм через WebSocket — переподключается сам при обрыве (тот же дух,
// что и у supabase-js, только руками: тут нет готового SDK).
export function ecConnect(onMessage: (m: EcMessage) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retryDelay = 1000
  function connect() {
    if (closed) return
    const token = ecToken()
    if (!token) return
    ws = new WebSocket(BASE.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws?token=' + encodeURIComponent(token))
    ws.onopen = () => { retryDelay = 1000 }
    ws.onmessage = e => {
      try { const p = JSON.parse(e.data); if (p.type === 'message') onMessage(p.msg) } catch {}
    }
    ws.onclose = () => {
      if (closed) return
      window.setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 1.5, 15000)
    }
    ws.onerror = () => { try { ws?.close() } catch {} }
  }
  connect()
  return () => { closed = true; try { ws?.close() } catch {} }
}
