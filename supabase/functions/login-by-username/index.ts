// Supabase Edge Function: login-by-username — resolves a username to its
// account and signs in with a password, WITHOUT ever handing the email address
// to the client.
//
// Replaces the old client-side flow: RPC email_for_username(username) -> email
// exposed straight to the browser -> supabase.auth.signInWithPassword(email, pw).
// That RPC was `grant execute ... to anon`, so anyone on the internet (no
// account needed) could resolve ANY Ponoi username to its real email address —
// a PII leak, and free reconnaissance for phishing/credential-stuffing. See
// security audit findings. supabase/19_login_by_username.sql now revokes anon/
// authenticated execute on that RPC; this function is the only remaining path.
//
// Deploy:  supabase functions deploy login-by-username --no-verify-jwt
//          (called before the user has a session, same as the old RPC path)
//
// Body: { username: string, password: string }
// Response: { access_token, refresh_token } on success, or { error } — the
// error message is identical whether the username doesn't exist or the
// password is wrong, so the endpoint can't be used to enumerate usernames.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const INVALID = () => json({ error: 'Invalid login credentials' }, 400)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { username, password } = await req.json()
    if (!username || !password) return json({ error: 'username and password required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Escape ilike wildcards (%, _) in the username so it's an exact
    // case-insensitive match, not a pattern — a raw "%"/"_" in the input
    // would otherwise match unrelated usernames.
    const escaped = String(username).replace(/([%_\\])/g, '\\$1')
    const { data: prof } = await admin.from('profiles').select('id').ilike('username', escaped).maybeSingle()
    if (!prof) return INVALID()
    const { data: authUser } = await admin.auth.admin.getUserById(prof.id)
    const email = authUser?.user?.email
    if (!email) return INVALID()

    // The actual credential check happens here, against the anon-key client —
    // this function never grants a session on username match alone.
    const anon = createClient(url, anonKey)
    const { data, error } = await anon.auth.signInWithPassword({ email, password })
    if (error) {
      // Passed through as-is (e.g. "Email not confirmed" vs "Invalid login
      // credentials") without ever including the email — that's a narrower,
      // accepted residual leak (confirms a username exists, not its email)
      // versus the original bug (any username -> real email, no auth needed).
      // The client sends the user to email-based login for the confirm-code
      // resend step, since that needs the address and we won't hand it over.
      return json({ error: error.message }, 400)
    }
    if (!data.session) return INVALID()
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
