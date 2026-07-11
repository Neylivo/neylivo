// Supabase Edge Function: bot-dispatch — рассылает событие MESSAGE_CREATE ботам,
// состоящим в сервере канала, куда пришло сообщение.
// Деплой:  supabase functions deploy bot-dispatch --no-verify-jwt
//          (дальше настроить в Supabase Dashboard -> Database -> Webhooks:
//          триггер INSERT на таблице messages -> HTTP-запрос на URL этой функции.
//          Это штатный механизм Supabase для «событие в БД -> вызов Edge Function»,
//          отдельный pg_net-триггер вручную не нужен). В настройках вебхука —
//          добавить HTTP-заголовок  X-Webhook-Secret: <тот же секрет, что в
//          переменной окружения DB_WEBHOOK_SECRET этой функции> — без него функция
//          вызывается ---no-verify-jwt, а значит без заголовка ЛЮБОЙ мог бы слать
//          сюда поддельные {record:{...}} и заставить нас HMAC-подписать чужой
//          контент настоящим webhook_secret бота.
//
// Payload вебхука-от-БД: { type: 'INSERT', table: 'messages', record: {...} }.
// Слэш-команды (INTERACTION_CREATE) шлются не отсюда — см. src/lib/botApi.ts,
// вызывается напрямую из Composer.tsx при отправке команды, синхронно ждёт ответ.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Content-Type': 'application/json' }

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// bot_apps.webhook_url is set by whoever created the bot (any logged-in user, see
// bot-create) — without this check they could point it at an internal/cloud-metadata
// address and use the dispatch as an SSRF probe. Blocks scheme != https and the
// common private/loopback/link-local ranges; doesn't defend against DNS rebinding.
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
  try {
    // Заголовок задаётся в настройках Database Webhook в Dashboard (см. коммент выше).
    // Если секрет не настроен как переменная окружения — фейлимся закрыто (403), а не открыто.
    const expected = Deno.env.get('DB_WEBHOOK_SECRET')
    if (!expected || req.headers.get('X-Webhook-Secret') !== expected) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors })
    }
    const payload = await req.json()
    if (payload.table !== 'messages' || payload.type !== 'INSERT') return new Response('ignored', { headers: cors })
    const msg = payload.record
    if (!msg?.channel_id || !msg?.content) return new Response('ignored', { headers: cors })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: channel } = await admin.from('channels').select('server_id').eq('id', msg.channel_id).maybeSingle()
    if (!channel) return new Response('no channel', { headers: cors })

    // Сообщение от самого бота не шлём другим ботам как событие — иначе легко
    // получить эхо-цикл (бот А отвечает на своё же прошлое сообщение и т.д.).
    const { data: senderApp } = await admin.from('bot_apps').select('id').eq('bot_user_id', msg.author).maybeSingle()
    if (senderApp) return new Response('sender is a bot', { headers: cors })

    const { data: members } = await admin.from('server_members').select('user_id').eq('server_id', channel.server_id)
    const memberIds = new Set((members ?? []).map((m: any) => m.user_id))
    const { data: bots } = await admin.from('bot_apps').select('id, bot_user_id, webhook_url, webhook_secret').not('webhook_url', 'is', null)
    const targets = (bots ?? []).filter((b: any) => memberIds.has(b.bot_user_id) && isSafeWebhookUrl(b.webhook_url))

    const body = JSON.stringify({ type: 'MESSAGE_CREATE', message: msg })
    await Promise.all(targets.map(async (b: any) => {
      try {
        const sig = await hmac(b.webhook_secret, body)
        await fetch(b.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ponoi-Signature': sig }, body })
      } catch { /* один упавший вебхук не должен ронять остальных */ }
    }))

    return new Response(JSON.stringify({ dispatched: targets.length }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors })
  }
})
