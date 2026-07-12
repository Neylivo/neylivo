// Supabase Edge Function: send-push — delivers web-push notifications.
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform)
//
// Body: { userIds: string[], title: string, body: string, url?: string, ctx?: PushCtx }
// Reads push_subscriptions for those users (service role — bypasses RLS), sends a
// web-push to each, and prunes subscriptions that come back 404/410 (gone).
//
// Security: this used to trust userIds/title/body from the caller with no checks
// at all — any logged-in user could push a spoofed native notification ("Ponoi:
// reset your password") to ANY other user. Now the caller must be authenticated,
// and each target is dropped unless the caller actually shares context with them
// (DM thread, accepted friendship, or a common server) — matching the three real
// call sites (DM message, server invite, @mention) in src/lib/push.ts.
//
// v1.243.0: on top of that privacy check, drop targets who muted this exact source
// (DM peer, or channel/whole server) or who set the server to "@mentions only" and
// weren't actually mentioned. Those preferences live in user_prefs (RLS: readable
// only by their own owner) — the CALLER'S browser has no way to read a target's
// prefs, so this filtering can only happen here, with the service-role key.
// ctx.mentionedUserIds is computed by the caller's client (it already has the
// server's member/role list) — replicating that text-mention parsing here would
// just be the same logic duplicated in two places and drifting out of sync.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

type PushCtx =
  | { kind: 'dm' }
  | { kind: 'channel'; serverId: string; channelId: string; mentionedUserIds: string[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { userIds, title, body, url, ctx } = await req.json() as { userIds: unknown; title: unknown; body: unknown; url: unknown; ctx?: PushCtx }
    if (!Array.isArray(userIds) || !userIds.length) return json({ error: 'userIds required' }, 400)

    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(supaUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const targets = Array.from(new Set((userIds as string[]).filter((id) => id && id !== user.id)))
    if (!targets.length) return json({ sent: 0, pruned: 0 })

    const [dmRes, frRes, smMineRes, smTheirsRes] = await Promise.all([
      admin.from('dm_threads').select('user_a, user_b')
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`),
      admin.from('friend_requests').select('from_user, to_user')
        .eq('status', 'accepted').or(`from_user.eq.${user.id},to_user.eq.${user.id}`),
      admin.from('server_members').select('server_id').eq('user_id', user.id),
      admin.from('server_members').select('server_id, user_id').in('user_id', targets),
    ])
    const dmPeers = new Set(
      (dmRes.data ?? []).map((t: any) => (t.user_a === user.id ? t.user_b : t.user_a))
    )
    const friends = new Set(
      (frRes.data ?? []).map((f: any) => (f.from_user === user.id ? f.to_user : f.from_user))
    )
    const myServers = new Set((smMineRes.data ?? []).map((m: any) => m.server_id))
    const sharedServerUsers = new Set(
      (smTheirsRes.data ?? []).filter((m: any) => myServers.has(m.server_id)).map((m: any) => m.user_id)
    )
    let allowed = targets.filter((id) => dmPeers.has(id) || friends.has(id) || sharedServerUsers.has(id))
    if (!allowed.length) return json({ sent: 0, pruned: 0 })

    // v1.243.0: заглушки/режим уведомлений получателей — см. комментарий над Deno.serve.
    if (ctx && (ctx.kind === 'dm' || ctx.kind === 'channel')) {
      const { data: prefs } = await admin.from('user_prefs')
        .select('user_id, ch_muted, srv_notif, dm_muted')
        .in('user_id', allowed)
      const prefsById = new Map((prefs ?? []).map((p: any) => [p.user_id, p]))
      allowed = allowed.filter((id) => {
        const p: any = prefsById.get(id)
        if (!p) return true   // строки в user_prefs ещё нет — значит, все настройки по умолчанию ("всё")
        if (ctx.kind === 'dm') {
          const exp = p.dm_muted?.[user.id]
          return !(exp !== undefined && (exp === 0 || Date.now() < exp))
        }
        if (p.ch_muted?.[ctx.channelId]) return false
        const mode = p.srv_notif?.[ctx.serverId] ?? 'all'
        if (mode === 'mute') return false
        if (mode === 'mentions') return (ctx.mentionedUserIds ?? []).includes(id)
        return true
      })
      if (!allowed.length) return json({ sent: 0, pruned: 0 })
    }

    const pub = Deno.env.get('VAPID_PUBLIC_KEY')!
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')!
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@ponoi.app'
    webpush.setVapidDetails(subject, pub, priv)

    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .in('user_id', allowed)
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
    if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone)

    return json({ sent, pruned: gone.length })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
