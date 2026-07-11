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
import { AccessToken, RoomServiceClient } from 'https://esm.sh/livekit-server-sdk@2.6.1'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// v1.230.0: разрешение звонить настраивается в Настройках (dm_call_privacy —
// all/friends/favorites/none, favorites = звонящий закреплён в ЛС у цели). Не
// используем RLS/can_call() отсюда — тут сервисный ключ без auth.uid(), поэтому
// та же логика продублирована напрямую через admin-клиент.
async function canCall(admin: ReturnType<typeof createClient>, callerId: string, calleeId: string): Promise<boolean> {
  // v1.233.0: раньше блокировка проверялась только для сообщений (dm_insert) — если
  // у цели dm_call_privacy='all', заблокированный ею человек всё равно мог позвонить.
  const { data: blk } = await admin.from('blocked_users').select('blocker_id')
    .or(`and(blocker_id.eq.${callerId},blocked_id.eq.${calleeId}),and(blocker_id.eq.${calleeId},blocked_id.eq.${callerId})`)
    .maybeSingle()
  if (blk) return false
  const { data: prof } = await admin.from('profiles').select('dm_call_privacy').eq('id', calleeId).maybeSingle()
  const privacy = (prof as any)?.dm_call_privacy ?? 'friends'
  if (privacy === 'all') return true
  if (privacy === 'none') return false
  const { data: fr } = await admin.from('friend_requests').select('id').eq('status', 'accepted')
    .or(`and(from_user.eq.${callerId},to_user.eq.${calleeId}),and(from_user.eq.${calleeId},to_user.eq.${callerId})`)
    .maybeSingle()
  const isFriend = !!fr
  if (privacy === 'friends') return isFriend
  if (privacy === 'favorites') {
    if (!isFriend) return false
    const { data: up } = await admin.from('user_prefs').select('dm_pinned').eq('user_id', calleeId).maybeSingle()
    const pinned: string[] = (up as any)?.dm_pinned ?? []
    return pinned.includes(callerId)
  }
  return false
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

    const key = Deno.env.get('LIVEKIT_API_KEY')!
    const secret = Deno.env.get('LIVEKIT_API_SECRET')!
    const lkUrl = Deno.env.get('LIVEKIT_URL')!

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
      const { data: thread } = await admin.from('dm_threads').select('user_a, user_b, is_group').eq('id', threadId).maybeSingle()
      const isParticipant = !!thread && (thread.user_a === identity || thread.user_b === identity)
      // v1.230.0: настройка «кто может звонить» (dm_call_privacy) применяется только
      // к тому, кто НАЧИНАЕТ звонок, а не к тому, кто отвечает на уже идущий — иначе
      // строгая настройка получателя мешала бы ему же самому принять свой звонок.
      // Различаем по факту существования комнаты в LiveKit: до первого джойна её нет.
      if (isParticipant && thread && !thread.is_group) {
        const otherId = thread.user_a === identity ? thread.user_b : thread.user_a
        let roomExists = false
        try {
          const svc = new RoomServiceClient(lkUrl, key, secret)
          const rooms = await svc.listRooms([room])
          roomExists = rooms.length > 0
        } catch { /* LiveKit недоступен для проверки — не блокируем звонок из-за этого */ }
        allowed = roomExists || await canCall(admin, identity, otherId)
      } else {
        allowed = isParticipant
      }
    }
    if (!allowed) return json({ error: 'not authorized for this room' }, 403)

    const at = new AccessToken(key, secret, { identity, name: name ?? identity })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
    const token = await at.toJwt()
    return json({ token, url: lkUrl })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
