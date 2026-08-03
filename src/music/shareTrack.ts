// v1.440.0: поделиться треком с другом.
//
// До сих пор отдать кому-то песню можно было только руками: скопировать ссылку
// из меню карточки, открыть переписку, вставить. Причём копировалась голая
// ссылка — собеседник получал «https://soundcloud.com/…?si=…» без единого слова
// о том, что это и зачем ему прислали.
//
// Здесь — текст сообщения и сама отправка. Текст отдельной функцией, потому что
// именно он виден человеку, и проверять надо его.

import { supabase } from '../lib/supabase'
import { openThread } from '../lib/friends'
import { shareTrackText, type ShareTrackInfo } from './shareText'

/**
 * Отправить трек в личку. Возвращает id диалога — вызывающий может сразу его
 * открыть, как это делает Discord после «Поделиться».
 */
export async function sendTrackToFriend(
  meId: string, meName: string, friendId: string, t: ShareTrackInfo, note?: string,
): Promise<string> {
  const thread = await openThread(meId, friendId)
  if (!thread?.id) throw new Error('Не удалось открыть переписку')
  const { error } = await supabase.from('dm_messages').insert({
    thread_id: thread.id, author: meId, author_name: meName, content: shareTrackText(t, note),
  })
  // Отказ базы — это почти всегда приватность собеседника («принимаю сообщения
  // только от друзей»). Говорим словами, а не кодом ошибки.
  if (error) {
    throw new Error(/row-level security|permission denied/i.test(String(error.message ?? ''))
      ? 'Этот человек не принимает от тебя сообщения'
      : (error.message ?? 'Не удалось отправить'))
  }
  return thread.id
}
