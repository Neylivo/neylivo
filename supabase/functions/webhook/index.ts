// Supabase Edge Function: webhook — приём сообщений от сторонних приложений.
//
// Деплой:  supabase functions deploy webhook --no-verify-jwt
//          Флаг обязателен: сюда шлют скрипты и сборочные системы, у которых нет
//          и не может быть токена Ponoi. Вместо него — собственный токен вебхука
//          в самом адресе.
//
// Адрес:   POST /functions/v1/webhook/<id>/<token>
// Тело:    { "content": "текст", "username": "необязательно", "avatar_url": "необязательно" }
//
// Тот же смысл, что у вебхуков Discord: внешняя система пишет в канал от заданного
// имени, не заводя учётной записи.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Сравнение за постоянное время: обычное === выходит на первом несовпавшем
 *  символе, и по времени ответа можно подбирать токен посимвольно. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const MAX_CONTENT = 4000
const MAX_NAME = 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Только POST' }, 405)

  // .../webhook/<id>/<token>
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const i = parts.indexOf('webhook')
  const id = i >= 0 ? parts[i + 1] : undefined
  const token = i >= 0 ? parts[i + 2] : undefined
  if (!id || !token) return json({ error: 'Адрес должен быть вида /webhook/<id>/<токен>' }, 400)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Тело запроса — не JSON' }, 400) }

  const content = String(body?.content ?? '').trim()
  if (!content) return json({ error: 'Пустое поле content' }, 400)
  if (content.length > MAX_CONTENT) return json({ error: `content длиннее ${MAX_CONTENT} символов` }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: wh } = await admin.from('webhooks')
    .select('id, channel_id, name, token_hash, created_by').eq('id', id).maybeSingle()
  // Одинаковый ответ и когда вебхука нет, и когда токен неверный: разные ответы
  // позволяли бы перебором выяснять, какие идентификаторы существуют.
  if (!wh || !safeEqual(await sha256(token), String(wh.token_hash))) {
    return json({ error: 'Неверный адрес или токен' }, 401)
  }

  // Имя можно переопределить в запросе — так у одного вебхука могут быть разные
  // отправители («сборка», «мониторинг»), как в Discord.
  const author_name = String(body?.username ?? wh.name).trim().slice(0, MAX_NAME) || String(wh.name)

  // Автор сообщения — тот, кто завёл вебхук: колонка author ссылается на реальную
  // учётную запись, а отдельной «учётки вебхука» в приложении нет. Видимое имя при
  // этом берётся из вебхука, поэтому в чате он выглядит собой, а не человеком.
  const { error } = await admin.from('messages').insert({
    channel_id: wh.channel_id,
    author: wh.created_by,
    author_name,
    content,
  })
  if (error) return json({ error: error.message }, 500)

  await admin.from('webhooks').update({ last_used_at: new Date().toISOString() }).eq('id', wh.id)
  return json({ ok: true })
})
