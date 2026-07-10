// Supabase Edge Function: bot-create — регистрирует новое бот-приложение.
// Деплой:  supabase functions deploy bot-create   (--verify-jwt по умолчанию —
//          вызывающий должен быть настоящим залогиненным пользователем Ponoi).
// Секреты: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY — платформенные.
//
// Body: { name: string }
// Создаёт настоящий auth.users-аккаунт для бота (server_members/messages — жёсткие
// FK на auth.users, обойти нельзя), profiles.is_bot=true, генерирует токен
// (виден только сейчас, дальше храним лишь его sha256).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { name } = await req.json()
    if (!name || typeof name !== 'string' || !name.trim()) return json({ error: 'name required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Кто вызывает — обычная сессия Ponoi (владелец будущего бота).
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(url, serviceKey)

    // Настоящий auth.users-аккаунт бота — без него server_members/messages не примут его как автора.
    const botEmail = `bot+${crypto.randomUUID()}@ponoi.bots`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: botEmail, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
      user_metadata: { is_bot: true, bot_name: name.trim() },
    })
    if (createErr || !created.user) return json({ error: createErr?.message ?? 'failed to create bot account' }, 500)
    const botUserId = created.user.id

    await admin.from('profiles').insert({ id: botUserId, username: name.trim(), display_name: name.trim(), is_bot: true })

    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const tokenHash = await sha256(token)
    const webhookSecret = crypto.randomUUID().replace(/-/g, '')

    const { data: app, error: appErr } = await admin.from('bot_apps').insert({
      owner_id: user.id, bot_user_id: botUserId, name: name.trim(),
      token_hash: tokenHash, webhook_secret: webhookSecret,
    }).select().single()
    if (appErr || !app) {
      await admin.auth.admin.deleteUser(botUserId).catch(() => {})
      return json({ error: appErr?.message ?? 'failed to create bot_apps row' }, 500)
    }

    return json({ id: app.id, botUserId, name: app.name, token, webhookSecret })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
