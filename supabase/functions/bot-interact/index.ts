// Supabase Edge Function: bot-interact — вызов слэш-команды бота (INTERACTION_CREATE).
// Деплой:  supabase functions deploy bot-interact   (--verify-jwt по умолчанию —
//          зовёт обычный пользователь Ponoi из композера, см. src/lib/botApi.ts).
//
// Body: { botAppId, channelId, command, args }
// В отличие от bot-dispatch (события сообщений, фоновая рассылка), тут клиент
// ждёт синхронный ответ бота — webhook_secret нельзя отдавать в браузер, поэтому
// подписанный POST на webhook_url бота идёт отсюда, не напрямую с клиента.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// See bot-dispatch/index.ts for why: webhook_url is attacker-controllable (any
// user can create a bot) and this function fetches it server-side, then reflects
// the response body back into chat — an unchecked internal/loopback URL here is
// both SSRF and a way to exfiltrate the response into a public channel.
function isSafeWebhookUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = m.slice(1).map(Number)
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
  }
  if (host === '[::1]' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { botAppId, channelId, command, args } = await req.json()
    if (!botAppId || !channelId || !command) return json({ error: 'botAppId, channelId and command required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: app } = await admin.from('bot_apps').select('id, bot_user_id, name, webhook_url, webhook_secret').eq('id', botAppId).maybeSingle()
    if (!app || !app.webhook_url) return json({ error: 'bot has no webhook configured' }, 404)
    if (!isSafeWebhookUrl(app.webhook_url)) return json({ error: 'bot webhook URL is not allowed' }, 400)

    const { data: channel } = await admin.from('channels').select('id, server_id').eq('id', channelId).maybeSingle()
    if (!channel) return json({ error: 'channel not found' }, 404)
    const { data: member } = await admin.from('server_members').select('user_id').eq('server_id', channel.server_id).eq('user_id', app.bot_user_id).maybeSingle()
    if (!member) return json({ error: 'bot is not a member of this server' }, 403)

    // Вызывающий тоже обязан быть участником этого сервера и не в тайм-ауте —
    // иначе любой залогиненный аккаунт Ponoi мог бы дёргать чужого бота в чужом
    // канале (guessable botAppId/channelId), а тайм-аут-участник — писать в чат
    // руками бота в обход messages_insert RLS (сама вставка идёт service-role).
    const { data: caller } = await admin.from('server_members').select('user_id, timeout_until').eq('server_id', channel.server_id).eq('user_id', user.id).maybeSingle()
    if (!caller) return json({ error: 'not a member of this server' }, 403)
    if (caller.timeout_until && new Date(caller.timeout_until) > new Date()) return json({ error: 'you are timed out' }, 403)

    const body = JSON.stringify({
      type: 'INTERACTION_CREATE', command, args: args ?? {},
      channelId, userId: user.id,
    })
    const sig = await hmac(app.webhook_secret, body)

    let botReply: string | null = null
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)   // Discord тоже ждёт ~3-5 сек синхронного ответа
      const res = await fetch(app.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ponoi-Signature': sig }, body, signal: ctrl.signal })
      clearTimeout(timer)
      const data = await res.json().catch(() => null)
      botReply = data?.content ? String(data.content).slice(0, 4000) : null
    } catch {
      return json({ error: 'bot did not respond in time' }, 504)
    }
    if (!botReply) return json({ error: 'bot returned no content' }, 502)

    const { data: msg, error: insErr } = await admin.from('messages').insert({
      channel_id: channelId, author: app.bot_user_id, author_name: app.name, content: botReply,
    }).select().single()
    if (insErr) return json({ error: insErr.message }, 500)
    return json({ id: msg.id })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
