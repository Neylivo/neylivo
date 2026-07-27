// v1.268.0: ветки (Threads) — см. supabase/70_threads.sql. Сообщения веток живут
// в обычной таблице messages (thread_id вместо null) — свои закреп/реакции/правка
// не нужны, работают те же функции, что и у обычных сообщений (reactions.ts).
//
// v1.320.0: на том же устроены форумы (supabase/81_forums.sql). Обсуждение форума
// — это ветка: у неё появились теги, счётчик ответов, время последней активности,
// закрепление и закрытие. Отдельной таблицы «постов» нет намеренно — иначе
// пришлось бы заново делать закреп, реакции, правку и вложения, которые у веток
// уже работают.
import { supabase } from './supabase'

export interface Thread {
  id: string
  channel_id: string
  server_id: string
  name: string
  created_by: string
  created_by_name: string
  origin_message_id: string | null
  archived: boolean
  created_at: string
  // Поля из 81_forums.sql. Необязательные: пока миграция не применена, колонок
  // нет и с сервера они не приходят.
  tags?: string[]
  pinned?: boolean
  locked?: boolean
  reply_count?: number
  last_activity?: string
}

/** Тег форума. Список тегов канала лежит в channels.settings.forum_tags. */
export interface ForumTag {
  id: string
  name: string
  emoji?: string
}

export function forumTagsOf(channel: { settings?: any } | null | undefined): ForumTag[] {
  const raw = (channel as any)?.settings?.forum_tags
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t: any) => t && typeof t.id === 'string' && typeof t.name === 'string')
    .map((t: any) => ({ id: t.id, name: t.name, emoji: typeof t.emoji === 'string' ? t.emoji : undefined }))
}

export function isForum(channel: { kind?: string | null; settings?: any } | null | undefined): boolean {
  return (channel as any)?.kind === 'forum'
}

export type ForumSort = 'activity' | 'new' | 'replies'

export async function fetchThreads(channelId: string): Promise<Thread[]> {
  const { data, error } = await supabase.from('threads').select('*')
    .eq('channel_id', channelId).order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []) as Thread[]
}

/**
 * Обсуждения форума. Сортировка идёт на сервере, потому что закрытых обсуждений
 * в старом канале могут быть сотни, а показываем мы верхушку.
 * Закреплённые всегда впереди — их доклеиваем порядком уже здесь.
 */
export async function fetchForumPosts(channelId: string, sort: ForumSort = 'activity'): Promise<Thread[]> {
  const col = sort === 'new' ? 'created_at' : sort === 'replies' ? 'reply_count' : 'last_activity'
  let { data, error } = await supabase.from('threads').select('*')
    .eq('channel_id', channelId).order(col, { ascending: false }).limit(200)
  if (error && /column|does not exist/i.test(error.message)) {
    // Миграция 81 ещё не применена — колонок нет. Показать хоть что-то лучше,
    // чем пустой экран: порядок будет по времени создания.
    const fb = await supabase.from('threads').select('*')
      .eq('channel_id', channelId).order('created_at', { ascending: false }).limit(200)
    data = fb.data; error = fb.error
  }
  if (error) throw new Error(forumErr(error.message))
  const list = (data ?? []) as Thread[]
  return list.slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
}

export async function createThread(
  channelId: string, serverId: string, name: string, createdBy: string, createdByName: string,
  originMessageId?: string | null, tags?: string[],
): Promise<Thread> {
  const base = {
    channel_id: channelId, server_id: serverId, name: name.trim().slice(0, 100),
    created_by: createdBy, created_by_name: createdByName,
    origin_message_id: originMessageId ?? null,
  }
  const row = tags?.length ? { ...base, tags } : base
  let { data, error } = await supabase.from('threads').insert(row).select().single()
  if (error && tags?.length && /tags|column/i.test(error.message)) {
    // Без миграции 81 колонки tags нет. Обсуждение важнее тегов — создаём без них.
    const fb = await supabase.from('threads').insert(base).select().single()
    data = fb.data; error = fb.error
  }
  if (error) throw new Error(forumErr(error.message))
  return data as Thread
}

export async function archiveThread(id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from('threads').update({ archived }).eq('id', id).select('id')
  if (error) throw new Error(forumErr(error.message))
  if (!data || data.length === 0) throw new Error('Не удалось изменить ветку — нет прав')
}

/**
 * Правка обсуждения. Что именно разрешено — решает база (81_forums.sql):
 * автору название, теги и «свернуть», модератору ещё закрепление и закрытие.
 * Поля, которые правщику не положены, триггер молча возвращает на место,
 * поэтому проверяем результат и говорим об отказе вслух.
 */
export async function updateThread(
  id: string, patch: { name?: string; tags?: string[]; pinned?: boolean; locked?: boolean; archived?: boolean },
): Promise<Thread> {
  // Без .single(): когда правило доступа не пускает, строк приходит ноль, и
  // .single() превратил бы понятный отказ в «JSON object requested».
  const { data, error } = await supabase.from('threads').update(patch).eq('id', id).select()
  if (error) throw new Error(forumErr(error.message))
  if (!data || data.length === 0) throw new Error('Не удалось изменить обсуждение — нет прав')
  const got = data[0] as Thread
  const refused = (Object.keys(patch) as (keyof typeof patch)[]).filter(k => {
    const want = patch[k]; const has = (got as any)[k]
    if (Array.isArray(want)) return JSON.stringify(want) !== JSON.stringify(has ?? [])
    return want !== has
  })
  if (refused.includes('pinned') || refused.includes('locked')) {
    throw new Error('Закреплять и закрывать обсуждения могут владелец сервера и модераторы')
  }
  if (refused.length) throw new Error('Не удалось изменить обсуждение — нет прав')
  return got
}

export async function deleteThread(id: string): Promise<void> {
  const { data, error } = await supabase.from('threads').delete().eq('id', id).select('id')
  if (error) throw new Error(forumErr(error.message))
  if (!data || data.length === 0) throw new Error('Не удалось удалить обсуждение — нет прав')
}

function forumErr(msg: string): string {
  if (/thread_can_post|threads_guard|thread_is_moderator/i.test(msg)) {
    return 'Форумы пока не включены — примени миграцию supabase/81_forums.sql'
  }
  if (/column .*(tags|pinned|locked|reply_count|last_activity)/i.test(msg)) {
    return 'Форумы пока не включены — примени миграцию supabase/81_forums.sql'
  }
  if (/row-level security|permission denied/i.test(msg)) {
    return 'Нет прав на это действие в канале'
  }
  return msg
}
