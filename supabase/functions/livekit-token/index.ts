// Supabase Edge Function: выдаёт LiveKit access token для входа в комнату.
// Деплой:  supabase functions deploy livekit-token --no-verify-jwt
// Секреты: supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_URL=wss://...
import { AccessToken } from 'https://esm.sh/livekit-server-sdk@2.6.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { room, identity, name } = await req.json()
    if (!room || !identity) {
      return new Response(JSON.stringify({ error: 'room and identity required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const key = Deno.env.get('LIVEKIT_API_KEY')!
    const secret = Deno.env.get('LIVEKIT_API_SECRET')!
    const url = Deno.env.get('LIVEKIT_URL')!
    const at = new AccessToken(key, secret, { identity, name: name ?? identity })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
    const token = await at.toJwt()
    return new Response(JSON.stringify({ token, url }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
