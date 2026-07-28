// Supabase Edge Function: bot-api — REST-поверхность для самого бота (внешний
// процесс, обычный HTTP, никакого supabase-js/сессии — только статический токен).
// Деплой:  supabase functions deploy bot-api --no-verify-jwt
//          (у бота нет Supabase-сессии — проверяем токен сами, ниже)
//
// Заголовок:  Authorization: Bot <токен>
// Эндпоинты:
//   GET  /bot-api/me                      — проверить токен, узнать свой user_id
//   POST /bot-api/messages { channelId, content }  — отправить сообщение в канал
//
// Бот не имеет настоящей Supabase JWT-сессии, поэтому RLS для него не работает —
// все проверки членства/прав здесь делаем руками (service-role клиент), теми же
// функциями (server_permissions), что использует RLS для обычных пользователей.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    const authz = req.headers.get('Authorization') ?? ''
    const m = authz.match(/^Bot\s+(.+)$/i)
    if (!m) return json({ error: 'missing Authorization: Bot <token>' }, 401)
    const tokenHash = await sha256(m[1])

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: app } = await admin.from('bot_apps').select('id, bot_user_id, name').eq('token_hash', tokenHash).maybeSingle()
    if (!app) return json({ error: 'invalid bot token' }, 401)

    const path = new URL(req.url).pathname.replace(/^\/bot-api/, '') || '/'

    if (req.method === 'GET' && path === '/me') {
      return json({ botUserId: app.bot_user_id, name: app.name })
    }

    if (req.method === 'POST' && path === '/messages') {
      const { channelId, content } = await req.json()
      if (!channelId || !content) return json({ error: 'channelId and content required' }, 400)

      const { data: channel } = await admin.from('channels').select('id, server_id').eq('id', channelId).maybeSingle()
      if (!channel) return json({ error: 'channel not found' }, 404)

      const { data: member } = await admin.from('server_members').select('user_id')
        .eq('server_id', channel.server_id).eq('user_id', app.bot_user_id).maybeSingle()
      if (!member) return json({ error: 'bot is not a member of this server' }, 403)

      // v1.331.0: раньше здесь стояло «отправка текста ничем не гейтится и у людей,
      // членства достаточно» — это было верно для messages_insert из 03, но с тех
      // пор правило обросло проверками: канал только для чтения (78) и приватный
      // канал (69). Бот ходит с сервисным ключом, RLS его не касается, так что обе
      // проверки он просто не замечал: писал в «Объявления», где людям писать
      // запрещено, и в закрытый канал, доступ к которому ему не давали.
      // Спрашиваем те же функции, что и правила доступа.
      const [{ data: canView }, { data: canSend }] = await Promise.all([
        admin.rpc('can_view_channel', { p_channel_id: channelId, p_user: app.bot_user_id }),
        admin.rpc('channel_can_send', { p_channel: channelId, p_user: app.bot_user_id }),
      ])
      if (canView !== true) return json({ error: 'bot has no access to this channel' }, 403)
      if (canSend !== true) return json({ error: 'channel is read-only for this bot' }, 403)

      const { data: msg, error: insErr } = await admin.from('messages').insert({
        channel_id: channelId, author: app.bot_user_id, author_name: app.name, content: String(content).slice(0, 4000),
      }).select().single()
      if (insErr) return json({ error: insErr.message }, 500)
      return json({ id: msg.id, createdAt: msg.created_at })
    }

    return json({ error: 'not found' }, 404)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
