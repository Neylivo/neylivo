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
