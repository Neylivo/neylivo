// Supabase Edge Function: bot-add-to-server — добавляет бота на сервер.
// Деплой:  supabase functions deploy bot-add-to-server   (--verify-jwt по умолчанию).
//
// Body: { botAppId: string, serverId: string }
// Вызывающий — владелец/админ СЕРВЕРА (не бота): server_members.user_id=auth.uid()
// в RLS не даёт вставить чужого пользователя напрямую с клиента, поэтому это
// делает сервисная функция — ровно так же, как kick_member/ban_member уже
// обходят RLS через security definer (supabase/34_permissions.sql).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { botAppId, serverId } = await req.json()
    if (!botAppId || !serverId) return json({ error: 'botAppId and serverId required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(url, serviceKey)

    const { data: server } = await admin.from('servers').select('id, owner').eq('id', serverId).maybeSingle()
    if (!server) return json({ error: 'server not found' }, 404)
    if (server.owner !== user.id) {
      // MANAGE_WEBHOOKS (512) через server_permissions(); owner уже отсёкся выше.
      const { data: permRow } = await admin.rpc('server_permissions', { p_server: serverId, p_user: user.id })
      const perms = typeof permRow === 'number' ? permRow : Number(permRow ?? 0)
      if ((perms & 512) === 0) return json({ error: 'missing MANAGE_WEBHOOKS permission' }, 403)
    }

    const { data: app } = await admin.from('bot_apps').select('id, bot_user_id, name').eq('id', botAppId).maybeSingle()
    if (!app) return json({ error: 'bot app not found' }, 404)

    const { error: insErr } = await admin.from('server_members').insert({
      server_id: serverId, user_id: app.bot_user_id, member_name: app.name, role: 'member',
    })
    if (insErr && !String(insErr.message).includes('duplicate')) return json({ error: insErr.message }, 500)

    return json({ ok: true, botUserId: app.bot_user_id })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
