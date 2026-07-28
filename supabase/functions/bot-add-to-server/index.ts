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
    if (!server) return json({ error: 'Сервер не найден' }, 404)
    if (server.owner !== user.id) {
      // MANAGE_WEBHOOKS (512) = «Управление ботами» в интерфейсе; owner уже отсёкся выше.
      const { data: permRow } = await admin.rpc('server_permissions', { p_server: serverId, p_user: user.id })
      const perms = typeof permRow === 'number' ? permRow : Number(permRow ?? 0)
      if ((perms & 512) === 0) {
        return json({ error: 'Ботов на этот сервер может добавлять только владелец или тот, чьей роли выдали право «Управление ботами»' }, 403)
      }
    }

    const { data: app } = await admin.from('bot_apps').select('id, bot_user_id, name, builtin').eq('id', botAppId).maybeSingle()
    if (!app) return json({ error: 'Бот не найден' }, 404)

    // v1.355.0: раньше повторное добавление молча «удавалось» — ошибку дубликата
    // глушили, и человек видел «Бот добавлен» второй раз подряд, хотя ничего не
    // происходило. Первичный ключ (server_id, user_id) второй строки и так бы не
    // дал, но врать об этом нельзя: отвечаем честно.
    const { data: already } = await admin.from('server_members')
      .select('user_id').eq('server_id', serverId).eq('user_id', app.bot_user_id).maybeSingle()
    if (already) return json({ error: 'Этот бот уже есть на сервере' }, 409)

    // Готовые боты («Кубик», «Таймер» и прочие из _shared/builtinBots.ts) — особый
    // случай: каждое добавление заводит НОВОЕ бот-приложение со своим bot_user_id,
    // поэтому ключ выше их не ловит, и на сервере оказывалось два одинаковых бота,
    // отвечающих на одну команду хором. Считаем их одинаковыми по виду.
    if (app.builtin) {
      const { data: members } = await admin.from('server_members').select('user_id').eq('server_id', serverId)
      const ids = (members ?? []).map((m: any) => m.user_id)
      if (ids.length) {
        const { data: sameKind } = await admin.from('bot_apps')
          .select('id').eq('builtin', app.builtin).in('bot_user_id', ids).limit(1)
        if (sameKind && sameKind.length) return json({ error: `Бот «${app.name}» уже есть на сервере` }, 409)
      }
    }

    const { error: insErr } = await admin.from('server_members').insert({
      server_id: serverId, user_id: app.bot_user_id, member_name: app.name, role: 'member',
    })
    if (insErr) {
      // Гонка: между проверкой выше и вставкой бота успели добавить с другого
      // устройства. Ответ тот же самый — для человека это одно и то же.
      if (String(insErr.message).includes('duplicate')) return json({ error: 'Этот бот уже есть на сервере' }, 409)
      return json({ error: insErr.message }, 500)
    }

    return json({ ok: true, botUserId: app.bot_user_id })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
