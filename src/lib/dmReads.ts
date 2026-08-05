// v1.477.0: отметка «просмотрено» в личных сообщениях.
//
// Зачем. Отличить «доставлено» от «прочитано» в приложении было нельзя ничем:
// счётчики непрочитанного считаются на устройстве и наружу не выходят. Человек
// не знал, молчат ему в ответ или просто ещё не видели.
//
// Как устроено. Одна строка на «человек × разговор»: докуда он дочитал
// (supabase/106_dm_reads.sql). Отметки на каждое сообщение нет намеренно — это
// в сотни раз больше записей ради того же ответа: сообщение просмотрено, если
// собеседник дочитал ПОЗЖЕ, чем оно отправлено.
//
// ПРИВАТНОСТЬ — главное здесь. Работает в обе стороны: показываешь свою
// отметку — видишь чужую. Выключил (настройка «Показывать, что я прочитал») —
// своя не пишется вовсе, и чужую приложение не показывает. Иначе получилось бы
// подглядывание в одну сторону, а это ровно то, за что такие отметки ругают.
//
// Проверки: src/lib/__ui_test.ts (правила и разбор), живая — на настоящем
// Postgres в scripts/db-test.

import { supabase } from './supabase'
import { getSettings } from './settings'

export interface ReadMark {
  threadId: string
  userId: string
  at: number
}

/** Просмотрено ли сообщение: собеседник дочитал позже, чем оно отправлено. */
export function seen(sentAt: number | string | Date, mark: ReadMark | null): boolean {
  if (!mark) return false
  const t = sentAt instanceof Date ? sentAt.getTime() : new Date(sentAt).getTime()
  if (!Number.isFinite(t)) return false
  // Секунда допуска: время сообщения ставит сервер, отметку — тоже сервер, но
  // между ними бывает разница в доли секунды, и без допуска только что
  // прочитанное сообщение выглядело бы непрочитанным.
  return mark.at + 1000 >= t
}

/** Человеческая подпись под своим сообщением. */
export function seenLabel(sentAt: number | string | Date, mark: ReadMark | null): string {
  if (!seen(sentAt, mark)) return 'Доставлено'
  const d = new Date(mark!.at)
  const сегодня = new Date()
  const тот = d.toDateString() === сегодня.toDateString()
  const время = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return тот ? `Просмотрено в ${время}` : `Просмотрено ${d.toLocaleDateString()} в ${время}`
}

/** Включены ли отметки. Выключены — не пишем свою и не читаем чужую. */
export const readReceiptsOn = (): boolean => getSettings().readReceipts !== false

// ── запись своей отметки ────────────────────────────────────────────────────

const последняя = new Map<string, number>()
/** Чаще раза в 5 секунд писать незачем: человек читает, а не листает базу. */
const НЕ_ЧАЩЕ = 5000

/**
 * «Я дочитал этот разговор». Зовётся, когда разговор открыт и окно в фокусе.
 *
 * Молча ничего не делает, если отметки выключены или таблицы ещё нет: без
 * применённой миграции возможность просто отсутствует, а приложение обязано
 * работать как раньше, а не падать.
 */
export async function markRead(threadId: string, userId: string): Promise<boolean> {
  if (!threadId || !userId || !readReceiptsOn()) return false
  const было = последняя.get(threadId) ?? 0
  const сейчас = Date.now()
  if (сейчас - было < НЕ_ЧАЩЕ) return false
  последняя.set(threadId, сейчас)
  const { error } = await supabase.from('dm_reads')
    .upsert({ thread_id: threadId, user_id: userId, read_at: new Date(сейчас).toISOString() },
      { onConflict: 'thread_id,user_id' })
  if (error) {
    // Нет таблицы — миграция не применена. Это не ошибка человека и не повод
    // шуметь: возможности просто нет.
    последняя.delete(threadId)
    return false
  }
  return true
}

/** Убрать свою отметку — способ передумать. */
export async function forgetRead(threadId: string, userId: string): Promise<void> {
  последняя.delete(threadId)
  await supabase.from('dm_reads').delete().eq('thread_id', threadId).eq('user_id', userId)
}

// ── чтение чужой отметки ────────────────────────────────────────────────────

/** Докуда дочитал СОБЕСЕДНИК. null — не читал, не показывает или нет таблицы. */
export async function theirRead(threadId: string, meId: string): Promise<ReadMark | null> {
  if (!threadId || !readReceiptsOn()) return null
  const { data, error } = await supabase.from('dm_reads')
    .select('thread_id,user_id,read_at')
    .eq('thread_id', threadId)
    .neq('user_id', meId)
    .order('read_at', { ascending: false })
    .limit(1)
  if (error || !data?.length) return null
  const r = data[0] as { thread_id: string; user_id: string; read_at: string }
  return { threadId: r.thread_id, userId: r.user_id, at: new Date(r.read_at).getTime() }
}

/**
 * Живое обновление: собеседник прочитал прямо сейчас.
 *
 * Возвращает функцию отписки. Своя отметка сюда не приходит — она не новость
 * для того, кто её и поставил.
 */
export function watchReads(threadId: string, meId: string, onMark: (m: ReadMark) => void): () => void {
  if (!threadId || !readReceiptsOn()) return () => {}
  const ch = supabase.channel('dmreads:' + threadId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'dm_reads', filter: 'thread_id=eq.' + threadId },
      (p: any) => {
        const r = p.new
        if (!r || r.user_id === meId) return
        onMark({ threadId: r.thread_id, userId: r.user_id, at: new Date(r.read_at).getTime() })
      })
    .subscribe()
  return () => { try { void supabase.removeChannel(ch) } catch {} }
}
