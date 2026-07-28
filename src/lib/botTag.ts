// v1.193.0: бейдж «БОТ» у имени в чате — тот же приём кэширования по userId,
// что и src/lib/userTag.ts (тег сервера), только источник — profiles.is_bot.
import { supabase } from './supabase'

const cache = new Map<string, boolean>()

export async function isBotUser(userId: string): Promise<boolean> {
  if (cache.has(userId)) return cache.get(userId)!
  try {
    const { data } = await supabase.from('profiles').select('is_bot').eq('id', userId).maybeSingle()
    const v = !!(data as any)?.is_bot
    cache.set(userId, v)
    return v
  } catch { return false }
}

// ── Кто вообще бот: список для мгновенных ответов (v1.356.0) ────────────────
//
// isBotUser выше спрашивает базу и отвечает обещанием — этого хватает бейджу у
// имени, который может дорисоваться. Но статусу «в сети» это не годится: точка
// рядом с аватаркой рисуется синхронно и много раз в секунду, спрашивать базу
// оттуда нельзя. Поэтому список пользователей-ботов забираем один раз целиком
// (bot_apps_public открыт всем вошедшим и секретов не содержит) и держим в памяти.

const botUsers = new Set<string>()
let primed: Promise<void> | null = null

/** Забрать список ботов один раз за сеанс. Повторные вызовы бесплатны. */
export function primeBotUsers(): Promise<void> {
  if (primed) return primed
  primed = (async () => {
    const { data } = await supabase.from('bot_apps_public').select('bot_user_id')
    for (const r of (data ?? []) as any[]) if (r.bot_user_id) botUsers.add(r.bot_user_id)
  })().catch(() => { /* не вышло — просто не считаем никого ботом */ })
  return primed
}

/** Бот ли это, без обращения к базе. До primeBotUsers() отвечает «нет». */
export const isKnownBot = (userId: string): boolean => botUsers.has(userId)
