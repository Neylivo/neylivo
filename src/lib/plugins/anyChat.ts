// v1.481.0: плагин в ЛЮБОМ канале, а не только в открытом.
//
// Зачем. До этой версии плагин видел ровно один чат — тот, что сейчас на
// экране. Значит, самого частого «хочу автоматику» сделать было нельзя: ни
// пересылки из канала в канал, ни ответчика в фоне, ни сбора статистики по
// серверу. Владелец попросил снять границу: «плагины могут что угодно и где
// угодно», а безопасность перенести на установку — там человек и решает.
//
// ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ.
//
// Есть: чтение и отправка в КАНАЛЫ СЕРВЕРОВ по их id. Работает от имени
// человека, через тот же supabase-клиент и те же правила доступа: канал, куда
// человеку нельзя, закрыт и плагину — это решает сервер, а не мы.
//
// НЕТ: личной переписки. И это не «руки не дошли». Личные сообщения в Ponoi
// шифруются на устройствах (src/lib/crypto): ключи чужих людей лежат у экрана
// переписки, а не здесь. Плагин, пишущий в личку отсюда, отправил бы туда
// ОТКРЫТЫЙ текст — то есть тихо сломал бы обещание, ради которого шифрование и
// делалось. Поэтому личка остаётся через ponoi.messages.send, который работает
// с ОТКРЫТЫМ чатом и его настоящим шифрованием.
//
// Проверки: src/lib/plugins/__attack_test.ts (границы) и живая в __api_test.

import { supabase } from '../supabase'

export interface AnyMsg {
  id: string
  author: string
  authorName: string
  content: string
  at: string
}

/** Сколько сообщений можно забрать за раз. */
// v1.489.0: потолка нет — сколько плагин попросил, столько и отдадим.

export class AnyChatError extends Error {}

const проверитьId = (v: unknown): string => {
  const s = String(v ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new AnyChatError('Нужен id канала, а не «' + s.slice(0, 20) + '»')
  return s
}

/**
 * Последние сообщения канала.
 *
 * Правила доступа проверяет сервер: если человеку в этот канал нельзя, вернётся
 * пусто. Мы намеренно НЕ повторяем проверку здесь — вторая копия правил
 * однажды разошлась бы с первой, и это был бы обход.
 */
export async function anyRecent(channelId: unknown, limit: number): Promise<AnyMsg[]> {
  const id = проверитьId(channelId)
  const n = Math.max(1, Math.round(Number(limit) || 50))
  const { data, error } = await supabase
    .from('messages')
    .select('id,author,author_name,content,created_at')
    .eq('channel_id', id)
    .order('created_at', { ascending: false })
    .limit(n)
  if (error) throw new AnyChatError('Не удалось прочитать канал: ' + error.message)
  return (data ?? []).map((r: any) => ({
    id: r.id, author: r.author, authorName: r.author_name ?? '',
    content: r.content ?? '', at: r.created_at,
  })).reverse()
}

/**
 * Отправить в канал от имени человека.
 *
 * Именно от его имени и с его правами: сервер откажет там, где отказал бы и
 * самому человеку. Плагин не получает ни чужого имени, ни обхода запретов.
 */
export async function anySend(channelId: unknown, text: string): Promise<string> {
  const id = проверитьId(channelId)
  const t = String(text ?? '').trim()
  if (!t) throw new AnyChatError('Пустое сообщение отправлять некуда')
  if (t.length > 4000) throw new AnyChatError('Сообщение длиннее 4000 знаков')
  const { data: u } = await supabase.auth.getUser()
  const me = u.user
  if (!me) throw new AnyChatError('Не выполнен вход')
  const имя = (me.user_metadata as any)?.display_name ?? me.email ?? 'плагин'
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: id, author: me.id, author_name: имя, content: t })
    .select('id')
    .single()
  if (error) throw new AnyChatError('Не удалось отправить: ' + error.message)
  return (data as any)?.id ?? ''
}

/**
 * Все каналы, доступные человеку, — чтобы плагину было куда пересылать.
 *
 * ponoi.channels(serverId) уже есть, но он про один сервер и требует знать его
 * id. Здесь — сразу всё, что видно, одним списком.
 */
export async function anyChannels(): Promise<{ id: string; name: string; serverId: string; kind: string }[]> {
  const { data, error } = await supabase
    .from('channels')
    .select('id,name,server_id,kind')
    .order('name')
    .limit(2000)
  if (error) throw new AnyChatError('Не удалось получить список каналов: ' + error.message)
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, serverId: r.server_id, kind: r.kind ?? 'text',
  }))
}
