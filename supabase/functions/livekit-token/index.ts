// Supabase Edge Function: выдаёт LiveKit access token для входа в комнату.
// Деплой:  supabase functions deploy livekit-token
//          (БЕЗ --no-verify-jwt — раньше деплоилась с этим флагом, то есть
//          вообще без проверки авторизации: любой человек в интернете, даже
//          без аккаунта Ponoi, мог запросить токен на ЛЮБУЮ комнату и с ЛЮБЫМ
//          identity — слушать/подключаться к чужим звонкам и выдавать себя за
//          другого участника. Теперь Supabase сам отклоняет запросы без
//          валидного JWT, а внутри функции мы ещё и проверяем, что вызывающий
//          реально состоит в сервере/DM-треде этой комнаты, и подставляем его
//          РЕАЛЬНЫЙ auth.uid() как identity, а не то, что прислал клиент.)
// Секреты: supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_URL=wss://...
import { AccessToken } from 'https://esm.sh/livekit-server-sdk@2.6.1'
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
    const { room, name } = await req.json()
    if (!room) return json({ error: 'room required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
    // identity — ВСЕГДА реальный auth.uid() вызывающего, что бы клиент ни прислал,
    // иначе можно было бы войти в звонок под чужим именем/id.
    const identity = user.id

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    let allowed = false
    if (room.startsWith('ch_')) {
      const channelId = room.slice(3)
      const { data: channel } = await admin.from('channels').select('server_id').eq('id', channelId).maybeSingle()
      if (channel) {
        const { data: member } = await admin.from('server_members').select('user_id')
          .eq('server_id', channel.server_id).eq('user_id', identity).maybeSingle()
        allowed = !!member
      }
    } else if (room.startsWith('dm_')) {
      const threadId = room.slice(3)
      const { data: thread } = await admin.from('dm_threads').select('user_a, user_b').eq('id', threadId).maybeSingle()
      allowed = !!thread && (thread.user_a === identity || thread.user_b === identity)
    }
    if (!allowed) return json({ error: 'not authorized for this room' }, 403)

    const key = Deno.env.get('LIVEKIT_API_KEY')!
    const secret = Deno.env.get('LIVEKIT_API_SECRET')!
    const lkUrl = Deno.env.get('LIVEKIT_URL')!
    const at = new AccessToken(key, secret, { identity, name: name ?? identity })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
    const token = await at.toJwt()
    return json({ token, url: lkUrl })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
