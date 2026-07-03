// Supabase Edge Function: send-push — delivers web-push notifications.
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform)
//
// Body: { userIds: string[], title: string, body: string, url?: string }
// Reads push_subscriptions for those users (service role — bypasses RLS), sends a
// web-push to each, and prunes subscriptions that come back 404/410 (gone).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { userIds, title, body, url } = await req.json()
    if (!Array.isArray(userIds) || !userIds.length) {
      return new Response(JSON.stringify({ error: 'userIds required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const pub = Deno.env.get('VAPID_PUBLIC_KEY')!
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')!
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@ponoi.app'
    webpush.setVapidDetails(subject, pub, priv)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .in('user_id', userIds)
    if (error) throw error

    const payload = JSON.stringify({ title: title ?? 'Ponoi', body: body ?? '', url: url ?? '/' })
    let sent = 0
    const gone: string[] = []
    await Promise.all((subs ?? []).map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (e: any) {
        const code = e?.statusCode
        if (code === 404 || code === 410) gone.push(s.endpoint)
      }
    }))
    if (gone.length) await supabase.from('push_subscriptions').delete().in('endpoint', gone)

    return new Response(JSON.stringify({ sent, pruned: gone.length }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})