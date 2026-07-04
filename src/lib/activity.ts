
import { supabase } from './supabase'

// История игровых сессий (миграция 14): пишем старт/конец своей игры,
// читаем агрегат за 7 дней для вкладки «История активностей» в фулл-профиле.

export async function startSession(userId: string, name: string, since: number): Promise<string | null> {
  try {
    const { data } = await supabase.from('activity_sessions')
      .insert({ user_id: userId, kind: 'game', name, started_at: new Date(since).toISOString() })
      .select('id').single()
    return (data as any)?.id ?? null
  } catch { return null }
}

export async function endSession(id: string) {
  try { await supabase.from('activity_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id) } catch {}
}

export interface GameStat { name: string; totalMs: number; sessions: number; last: number }

// Статистика за неделю: сумма часов по каждой игре. Открытая сессия считается
// «до текущего момента», но каждая сессия ограничена 8 часами (защита от
// зависших записей, если приложение убили и ended_at не записался).
export async function weekStats(userId: string): Promise<GameStat[]> {
  try {
    const from = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('activity_sessions').select('name, started_at, ended_at')
      .eq('user_id', userId).gte('started_at', from)
      .order('started_at', { ascending: false }).limit(300)
    const by: Record<string, GameStat> = {}
    for (const r of (data ?? []) as any[]) {
      const s = new Date(r.started_at).getTime()
      const e = r.ended_at ? new Date(r.ended_at).getTime() : Date.now()
      const st = by[r.name] ?? (by[r.name] = { name: r.name, totalMs: 0, sessions: 0, last: 0 })
      st.totalMs += Math.min(Math.max(0, e - s), 8 * 3600000)
      st.sessions++
      st.last = Math.max(st.last, s)
    }
    return Object.values(by).sort((a, b) => b.totalMs - a.totalMs)
  } catch { return [] }
}
