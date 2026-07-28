// v1.193.0: платформа ботов — рендерер-обвязка вокруг Edge Functions
// (supabase/functions/bot-*) и таблиц bot_apps/bot_commands.
import { supabase } from './supabase'

export interface BotApp {
  id: string
  owner_id: string
  bot_user_id: string
  name: string
  avatar_url: string | null
  webhook_url: string | null
  created_at: string
  /** Вид готового бота «от нас» (v1.333.0); null — обычный бот с вебхуком. */
  builtin: string | null
}
export interface BotCommand {
  id: string; bot_app_id: string; name: string; description: string
  options: { name: string; description: string; required?: boolean }[]
  /** Готовый ответ — только у бота без программирования (v1.344.0, миграция 92). */
  reply?: string | null
}

// supabase-js бросает generic FunctionsHttpError («non-2xx status code») на ЛЮБОЙ
// код ответа функции, а data при этом форсится в null — реальный текст ошибки
// (json {error:...}, который шлют bot-create/bot-add-to-server/bot-interact) жив
// только в ещё не прочитанном error.context (это тот самый Response).
//
// v1.351.0: этого было мало. Если функция вообще не развёрнута или упала до
// нашего кода, тела с полем error нет, и человек получал ровно «Edge Function
// returned a non-2xx status code» — бесполезную строку, по которой нельзя
// понять ни что сломалось, ни что делать. Теперь достаём и код ответа, и сырой
// текст, а самые частые случаи объясняем словами.
async function edgeErr(error: any, fn?: string): Promise<string> {
  const res = error?.context
  const status: number | undefined = typeof res?.status === 'number' ? res.status : undefined
  let raw = ''
  try {
    // Тело читается один раз: сначала как текст, а json разбираем уже из него.
    raw = typeof res?.text === 'function' ? String(await res.text()) : ''
  } catch { /* тело недоступно — обойдёмся кодом ответа */ }
  if (raw) {
    try {
      const body = JSON.parse(raw)
      if (body?.error) return String(body.error)
    } catch { /* не json — покажем как есть ниже */ }
  }

  const where = fn ? `Функция «${fn}»` : 'Серверная функция'
  if (status === 404) {
    return `${where} не развёрнута на сервере. Нужно выполнить: supabase functions deploy ${fn ?? '<имя>'}`
  }
  if (status === 401 || status === 403) {
    return `${where} отклонила запрос (${status}). Скорее всего истёк вход — перезайди в приложение.`
  }
  if (status === 500 && /column .* does not exist|relation .* does not exist/i.test(raw)) {
    return `${where} упала: в базе нет нужной колонки или таблицы — не применена одна из миграций supabase/.`
  }
  if (status) {
    const tail = raw.trim().slice(0, 200)
    return `${where} ответила ${status}${tail ? ': ' + tail : ' без объяснения'}`
  }
  return error?.message ?? String(error)
}

export async function myBots(): Promise<BotApp[]> {
  // select('*'), а не перечисление колонок: колонку builtin добавляет миграция 89,
  // и пока её не применили, запрос со списком колонок падал бы целиком — вместе
  // со всем разделом ботов. С '*' просто не будет этого поля.
  const { data } = await supabase.from('bot_apps').select('*').order('created_at')
  return ((data ?? []) as any[]).map(b => ({ ...b, builtin: b.builtin ?? null })) as BotApp[]
}

// Возвращает токен и секрет ОДИН раз — дальше они не читаются нигде (хранится только hash).
/**
 * @param builtin вид готового бота «от нас» (см. supabase/functions/_shared/builtinBots.ts).
 *   Обычный бот создаётся без него, как и раньше.
 */
export async function createBot(name: string, builtin?: string): Promise<{ id: string; token: string; webhookSecret: string; botUserId: string }> {
  // Поле builtin шлём, только когда оно есть: у не обновлённой функции запрос
  // тогда выглядит ровно так же, как раньше, и она его понимает.
  const body: Record<string, unknown> = { name }
  if (builtin) body.builtin = builtin
  const { data, error } = await supabase.functions.invoke('bot-create', { body })
  if (error) throw new Error(await edgeErr(error, 'bot-create'))
  if (data?.error) throw new Error(data.error)
  return data
}

export async function setBotWebhook(botAppId: string, webhookUrl: string | null): Promise<void> {
  const { data, error } = await supabase.from('bot_apps').update({ webhook_url: webhookUrl }).eq('id', botAppId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Не сохранилось — нет прав на изменение бота')
}

export async function deleteBot(botAppId: string): Promise<void> {
  const { error } = await supabase.from('bot_apps').delete().eq('id', botAppId)
  if (error) throw error
}

export async function addBotToServer(botAppId: string, serverId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('bot-add-to-server', { body: { botAppId, serverId } })
  if (error) throw new Error(await edgeErr(error, 'bot-add-to-server'))
  if (data?.error) throw new Error(data.error)
}

/**
 * Кто из ботов уже стоит на сервере (v1.355.0).
 *
 * Нужно, чтобы каталог не предлагал добавить то, что уже добавлено. Отказ всё
 * равно даёт сервер, но у готовых ботов путь такой: сначала заводится новое
 * бот-приложение, и только потом оно ставится на сервер — узнав об отказе
 * последним, мы бы оставляли за собой мусорное приложение при каждом промахе.
 *
 * Возвращаем и вид готового бота (builtin): двух «Кубиков» на сервере быть не
 * должно, хотя приложения у них разные.
 */
export async function botsOnServer(serverId: string): Promise<{ botUserId: string; appId: string; builtin: string | null }[]> {
  const { data: members } = await supabase.from('server_members').select('user_id').eq('server_id', serverId)
  const ids = (members ?? []).map((m: any) => m.user_id)
  if (!ids.length) return []
  const { data } = await supabase.from('bot_apps_public').select('id, bot_user_id, builtin').in('bot_user_id', ids)
  return (data ?? []).map((b: any) => ({ botUserId: b.bot_user_id, appId: b.id, builtin: b.builtin ?? null }))
}

/**
 * Серверы, куда я вправе ставить ботов: свои или те, где моей роли выдали
 * «Управление ботами» (v1.355.0).
 *
 * Раньше в выборе были все серверы подряд, и на чужом «Добавить» просто падало
 * с отказом — выглядело как поломка, а не как отсутствие права.
 */
export async function serversForBots(): Promise<{ id: string; name: string }[]> {
  const { data: servers, error } = await supabase.from('servers').select('id, name, owner').order('created_at')
  if (error) throw error
  const me = (await supabase.auth.getUser()).data.user?.id
  const out: { id: string; name: string }[] = []
  for (const sv of (servers ?? []) as any[]) {
    if (sv.owner === me) { out.push({ id: sv.id, name: sv.name }); continue }
    const { data: mask } = await supabase.rpc('server_permissions', { p_server: sv.id, p_user: me })
    // 512 = MANAGE_WEBHOOKS, в интерфейсе «Управление ботами» (src/lib/permissions.ts).
    if ((Number(mask ?? 0) & 512) !== 0) out.push({ id: sv.id, name: sv.name })
  }
  return out
}

/**
 * Убрать бота с сервера (v1.355.0).
 *
 * Через функцию, а не прямым delete: правило sm_delete пускает только к своей
 * строке, а строка бота принадлежит боту — запрос не падал, он просто удалял
 * ноль строк, и кнопка «Убрать бота» ничего не делала. Право проверяет база
 * (supabase/95_bot_membership.sql), не интерфейс.
 */
export async function removeBotFromServer(botUserId: string, serverId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_bot_from_server', { p_bot_user: botUserId, p_server: serverId })
  if (!error) return
  const m = String(error.message ?? '')
  if (m.includes('missing_manage_bots')) throw new Error('Убирать ботов может только владелец сервера или тот, чьей роли выдали право «Управление ботами»')
  if (m.includes('not_a_bot')) throw new Error('Это не бот — обычных участников убирают через список участников')
  if (m.includes('server_not_found')) throw new Error('Сервер не найден')
  if (m.includes('remove_bot_from_server') && m.includes('does not exist')) {
    throw new Error('Нужно применить миграцию supabase/95_bot_membership.sql')
  }
  throw new Error(m || 'Не удалось убрать бота')
}

/**
 * Профиль бота: аватарка, «о себе» и цвета карточки (v1.340.0).
 *
 * Через функцию, а не прямым update: строка профиля принадлежит боту, и правило
 * доступа пускает к ней только его самого. Функция проверяет, что зовущий —
 * владелец приложения (см. supabase/91_bot_profile.sql).
 */
export async function setBotProfile(botAppId: string, p: {
  avatarUrl: string | null; about: string; primary: string | null; accent: string | null
  bannerUrl?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('set_bot_profile', {
    p_app: botAppId,
    p_avatar: p.avatarUrl,
    p_about: p.about,
    p_primary: p.primary,
    p_accent: p.accent,
    p_banner: p.bannerUrl ?? null,
  })
  if (error) {
    const m = String(error.message || '')
    if (m.includes('not_your_bot')) throw new Error('Это не твой бот')
    if (m.includes('bad_avatar')) throw new Error('Ссылка на аватарку должна начинаться с https://')
    if (m.includes('bad_banner')) throw new Error('Ссылка на шапку должна начинаться с https://')
    if (m.includes('bad_color')) throw new Error('Цвет должен быть в виде #rrggbb')
    // Функция с шестью параметрами появляется только в 93: пока её нет, Postgres
    // говорит «функция не найдена» — подсказываем именно ту миграцию.
    if (m.includes('set_bot_profile')) throw new Error('Нужно применить миграции supabase/91_bot_profile.sql и 93_profile_banner.sql')
    throw new Error(m)
  }
}

/** Текущий профиль бота — чтобы форма открывалась заполненной. */
export async function fetchBotProfile(botUserId: string): Promise<{
  avatar_url: string | null; about: string | null; primary_color: string | null
  accent_color: string | null; banner_url?: string | null
} | null> {
  // Колонка banner_url появляется в 93 — если её ещё нет, читаем прежний набор.
  let { data, error } = await supabase.from('profiles')
    .select('avatar_url, about, primary_color, accent_color, banner_url').eq('id', botUserId).maybeSingle()
  if (error) ({ data } = await supabase.from('profiles')
    .select('avatar_url, about, primary_color, accent_color').eq('id', botUserId).maybeSingle())
  return (data as any) ?? null
}

export async function fetchBotCommands(botAppId: string): Promise<BotCommand[]> {
  const { data } = await supabase.from('bot_commands').select('*').eq('bot_app_id', botAppId).order('name')
  return (data ?? []) as BotCommand[]
}
export async function fetchServerBotCommands(serverId: string): Promise<(BotCommand & { botAppId: string })[]> {
  // Команды всех ботов, реально состоящих в этом сервере (для автодополнения /команд в Composer).
  // bot_apps_public — потому что боты обычно чужие: RLS на bot_apps самой
  // пускает только владельца (см. supabase/53_bot_apps_public.sql).
  const { data: bots } = await supabase.from('bot_apps_public').select('id, bot_user_id')
  const { data: members } = await supabase.from('server_members').select('user_id').eq('server_id', serverId)
  const memberIds = new Set((members ?? []).map((m: any) => m.user_id))
  const serverBotIds = (bots ?? []).filter((b: any) => memberIds.has(b.bot_user_id)).map((b: any) => b.id)
  if (!serverBotIds.length) return []
  const { data } = await supabase.from('bot_commands').select('*').in('bot_app_id', serverBotIds)
  return ((data ?? []) as BotCommand[]).map(c => ({ ...c, botAppId: c.bot_app_id }))
}
export async function saveBotCommand(botAppId: string, cmd: { id?: string; name: string; description: string; options: BotCommand['options']; reply?: string | null }): Promise<void> {
  const row: Record<string, unknown> = {
    bot_app_id: botAppId, name: cmd.name.trim().toLowerCase(), description: cmd.description.trim(), options: cmd.options,
  }
  // Поле есть только после миграции 92 — не шлём его, если ответа нет, чтобы у
  // тех, кто её ещё не применил, обычные команды продолжали сохраняться.
  if (cmd.reply !== undefined) row.reply = cmd.reply
  if (cmd.id) {
    const { data, error } = await supabase.from('bot_commands').update(row).eq('id', cmd.id).select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('Не сохранилось — нет прав на изменение команды')
  } else {
    const { error } = await supabase.from('bot_commands').insert(row)
    if (error) throw error
  }
}
export async function deleteBotCommand(id: string): Promise<void> {
  const { error } = await supabase.from('bot_commands').delete().eq('id', id)
  if (error) throw error
}

// Вызов слэш-команды бота — ждёт синхронный ответ (или ошибку/таймаут), сам
// кладёт ответ бота в чат (см. supabase/functions/bot-interact).
export async function invokeBotCommand(botAppId: string, channelId: string, command: string, args: Record<string, string>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('bot-interact', { body: { botAppId, channelId, command, args } })
  if (error) throw new Error(await edgeErr(error, 'bot-interact'))
  if (data?.error) throw new Error(data.error)
}
