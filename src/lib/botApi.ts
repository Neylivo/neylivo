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
async function edgeErr(error: any): Promise<string> {
  try { const body = await error?.context?.json?.(); if (body?.error) return String(body.error) } catch { /* не json — используем текст ниже */ }
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
  const { data, error } = await supabase.functions.invoke('bot-create', { body: { name, builtin: builtin ?? null } })
  if (error) throw new Error(await edgeErr(error))
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
  if (error) throw new Error(await edgeErr(error))
  if (data?.error) throw new Error(data.error)
}

export async function removeBotFromServer(botUserId: string, serverId: string): Promise<void> {
  const { error } = await supabase.from('server_members').delete().eq('server_id', serverId).eq('user_id', botUserId)
  if (error) throw error
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
}): Promise<void> {
  const { error } = await supabase.rpc('set_bot_profile', {
    p_app: botAppId,
    p_avatar: p.avatarUrl,
    p_about: p.about,
    p_primary: p.primary,
    p_accent: p.accent,
  })
  if (error) {
    const m = String(error.message || '')
    if (m.includes('not_your_bot')) throw new Error('Это не твой бот')
    if (m.includes('bad_avatar')) throw new Error('Ссылка на аватарку должна начинаться с https://')
    if (m.includes('bad_color')) throw new Error('Цвет должен быть в виде #rrggbb')
    if (m.includes('set_bot_profile')) throw new Error('Нужно применить миграцию supabase/91_bot_profile.sql')
    throw new Error(m)
  }
}

/** Текущий профиль бота — чтобы форма открывалась заполненной. */
export async function fetchBotProfile(botUserId: string): Promise<{
  avatar_url: string | null; about: string | null; primary_color: string | null; accent_color: string | null
} | null> {
  const { data } = await supabase.from('profiles')
    .select('avatar_url, about, primary_color, accent_color').eq('id', botUserId).maybeSingle()
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
  if (error) throw new Error(await edgeErr(error))
  if (data?.error) throw new Error(data.error)
}
