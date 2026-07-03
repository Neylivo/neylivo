
import { supabase } from './supabase'

export type RxTable = 'reactions' | 'dm_reactions'
export interface Reaction { message_id: string; user_id: string; emoji: string }

export async function loadReactions(table: RxTable, messageIds: string[]): Promise<Reaction[]> {
  if (!messageIds.length) return []
  const { data } = await supabase.from(table).select('message_id, user_id, emoji').in('message_id', messageIds)
  return (data ?? []) as Reaction[]
}

// Toggle: if the user already reacted with this emoji, remove it; otherwise add it.
export async function toggleReaction(table: RxTable, messageId: string, userId: string, emoji: string) {
  const { data } = await supabase.from(table).select('emoji')
    .eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji).maybeSingle()
  if (data) {
    await supabase.from(table).delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
  } else {
    await supabase.from(table).insert({ message_id: messageId, user_id: userId, emoji })
  }
}

// Group flat reaction rows into per-message summaries: { emoji, count, mine }
export interface RxSummary { emoji: string; count: number; users: string[] }
export function groupReactions(rows: Reaction[]): Record<string, RxSummary[]> {
  const byMsg: Record<string, Record<string, string[]>> = {}
  for (const r of rows) {
    ;(byMsg[r.message_id] ??= {})[r.emoji] ??= []
    byMsg[r.message_id][r.emoji].push(r.user_id)
  }
  const out: Record<string, RxSummary[]> = {}
  for (const mid in byMsg) {
    out[mid] = Object.entries(byMsg[mid]).map(([emoji, users]) => ({ emoji, count: users.length, users }))
  }
  return out
}

export type PinTable = 'messages' | 'dm_messages'
export async function setPin(table: PinTable, id: string, pinned: boolean) {
  await supabase.from(table).update({ pinned }).eq('id', id)
}
export async function deleteMessage(table: PinTable, id: string) {
  await supabase.from(table).delete().eq('id', id)
}

export async function editMessage(table: PinTable, id: string, content: string) {
  await supabase.from(table).update({ content, edited: true }).eq('id', id)
}
