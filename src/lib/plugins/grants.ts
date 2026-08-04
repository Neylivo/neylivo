// v1.468.0: личная передача плагина — обращения к базе.
//
// Правила и сама выдача содержимого лежат в базе (supabase/105_plugin_grants.sql):
// таблица закрыта наглухо, а получателю отвечает функция, проверяющая код,
// адресата, срок и остаток получений.
//
// Сам код передачи и всё, что можно посчитать без сети, — в grantCodes.ts:
// рядом с клиентом Supabase это нечем проверить, он требует настроек окружения
// и падает в сборке проверки ещё до первой строки.
//
// ЧЕСТНО. Это не защита от копирования. Плагин — обычный JavaScript, который
// выполняется у человека на устройстве: получив его, он видит весь код и может
// передать файл дальше. Передача даёт адресность, ограниченность и СЛЕД — и
// ровно это, слово в слово, написано человеку на экране (GRANT_HONESTY).
//
// Проверки: scripts/db-test/rls-test.mjs (правила) и __test.ts (код).

import { supabase } from '../supabase'
import { normCode, makeCode, expiryFromDays, clampUses } from './grantCodes'

/**
 * Понятная причина вместо ответа базы.
 *
 * Пока миграция 105 не применена, таблицы и функции просто нет, и Postgres
 * отвечает «relation "plugin_grants" does not exist». Человеку это ничего не
 * говорит: он видит поломку там, где на самом деле не хватает одного действия
 * владельца. Говорим прямо, что именно надо сделать.
 */
export function grantError(e: unknown): string {
  const t = String((e as { message?: string })?.message ?? e)
  if (/plugin_grants|claim_plugin_grant|peek_plugin_grant/.test(t) && /does not exist|not find|schema cache/i.test(t)) {
    return 'Личная передача ещё не включена на сервере — нужно применить supabase/105_plugin_grants.sql'
  }
  return t
}

export * from './grantCodes'

export interface Grant {
  id: string
  code: string
  kind: string
  plugin_id: string
  plugin_name: string
  plugin_version: string
  note: string
  to_user: string | null
  uses_left: number
  expires_at: string | null
  revoked: boolean
  created_at: string
}

export interface GrantClaim { grant_id: string; user_id: string; claimed_at: string }

export interface NewGrant {
  pluginId: string
  pluginName: string
  pluginVersion: string
  /** Сам .ponoi-файл. */
  payload: string
  /** Кому именно. null — любому, у кого есть код. */
  toUser?: string | null
  /** Сколько раз можно забрать. */
  uses?: number
  /** Через сколько дней перестанет работать. 0 — без срока. */
  days?: number
  /** Записка для себя: кому и за что. Видит только автор. */
  note?: string
}

export async function createGrant(me: string, g: NewGrant): Promise<Grant> {
  const code = makeCode()
  const { data, error } = await supabase.from('plugin_grants').insert({
    code,
    author: me,
    to_user: g.toUser ?? null,
    kind: 'plugin',
    plugin_id: g.pluginId,
    plugin_name: g.pluginName,
    plugin_version: g.pluginVersion || '',
    payload: g.payload,
    note: (g.note ?? '').slice(0, 300),
    uses_left: clampUses(g.uses ?? 1),
    expires_at: expiryFromDays(g.days ?? 0),
  }).select().single()
  if (error) throw new Error(error.message)
  return data as Grant
}

export async function myGrants(): Promise<Grant[]> {
  const { data, error } = await supabase.from('plugin_grants')
    .select('id,code,kind,plugin_id,plugin_name,plugin_version,note,to_user,uses_left,expires_at,revoked,created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as Grant[]
}

/** Кто и когда забрал — след, ради которого всё и делалось. */
export async function grantClaims(ids: string[]): Promise<GrantClaim[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('plugin_grant_claims')
    .select('grant_id,user_id,claimed_at').in('grant_id', ids)
  if (error) throw new Error(error.message)
  return (data ?? []) as GrantClaim[]
}

export async function revokeGrant(id: string): Promise<void> {
  const { error } = await supabase.from('plugin_grants').update({ revoked: true }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteGrant(id: string): Promise<void> {
  const { error } = await supabase.from('plugin_grants').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export interface PeekResult {
  kind: string
  plugin_id: string
  plugin_name: string
  plugin_version: string
  author: string
  mine: boolean
}

/** Посмотреть, что предлагают, не забирая. Файла отсюда не приходит. */
export async function peekGrant(code: string): Promise<PeekResult> {
  const { data, error } = await supabase.rpc('peek_plugin_grant', { p_code: normCode(code) })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Код не найден')
  return row as PeekResult
}

export interface ClaimResult extends PeekResult { payload: string }

/**
 * Забрать. Повторный вызов тем же человеком получения НЕ расходует — так решено
 * в самой функции базы: сразу после получения приложение показывает разрешения,
 * и человек может отказаться. Сгорай единственная попытка на его осторожности,
 * это была бы поломка, а не защита.
 */
export async function claimGrant(code: string): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc('claim_plugin_grant', { p_code: normCode(code) })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Код не найден')
  return row as ClaimResult
}
