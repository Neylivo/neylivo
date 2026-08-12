import { supabase } from './supabase'
import { notifyMessage, msgSound } from './notify'
import { isDmMuted, isDmIgnored } from './userPrefs'
import { shouldNotify } from './srvNotify'
import { chNotifModeOf } from './chNotify'
import { mentionsUser } from './mentions'
import { channelInfo, getOpenChannel, getOpenDmThread } from './openChat'

// v1.409.0: уведомления приходят обо ВСЁМ, а не только об открытом чате.
//
// Что было. Показ уведомления и звук висели внутри подписки открытого
// разговора: в личке — на dm_messages с фильтром по открытому треду, в сервере
// — на сообщениях открытого канала. То есть уведомление приходило ровно про ту
// переписку, которая и так перед глазами (да и то лишь когда окно не в
// фокусе), а про все остальные — не приходило вовсе. Со стороны это и есть
// «уведомления не работают»: пишут в другой чат, а приложение молчит.
//
// Что теперь. Один слушатель на всё приложение. Права доступа никуда не
// делись: realtime отдаёт только те строки, которые человеку и так разрешено
// читать, поэтому подписка без фильтра не показывает чужого.
//
// Открытый чат по-прежнему молчит — но только когда окно в фокусе: человек и
// так смотрит на сообщение. Свернул окно — придёт уведомление и по нему.

export interface NotifyCtx {
  meId: string
  /** Имя человека — по нему считается, упомянули ли тебя. */
  myName: () => string
  /** Аватар автора, если приложение его знает. */
  avatarOf: (userId: string) => string | null | undefined
}

const focused = () => document.visibilityState === 'visible' && document.hasFocus()

/** Системное сообщение (кто-то вошёл в канал, закрепили) — не повод звенеть. */
function isSystem(content: string | null | undefined): boolean {
  return !!content && /^sys:/.test(content)
}

export function startGlobalNotify(ctx: NotifyCtx): () => void {
  const dm = supabase.channel('notify:dm')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, p => {
      const m: any = p.new
      if (!m || m.author === ctx.meId || isSystem(m.content)) return
      if (isDmMuted(m.author) || isDmIgnored(m.author)) return
      if (focused() && getOpenDmThread() === m.thread_id) return
      msgSound()
      notifyMessage({
        author: m.author_name || 'Личное сообщение',
        text: m.content ?? '',
        hasAttach: !!m.attach_url,
        icon: ctx.avatarOf(m.author),
        tag: 'dm:' + m.thread_id,
        // v1.440.0: нажатие открывает именно этот разговор.
        route: 'neylivo://msg/d/' + m.thread_id + '/' + m.id,
      })
    })
    .subscribe()

  const srv = supabase.channel('notify:srv')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
      const m: any = p.new
      if (!m || m.author === ctx.meId || isSystem(m.content)) return
      if (focused() && getOpenChannel() === m.channel_id) return
      // Имя канала спрашиваем у базы (с кэшем): писать могут в любой сервер, а
      // не только в открытый, и заголовок «сообщение неизвестно откуда» никому
      // не нужен. Заодно узнаём сервер — по нему считаются правила заглушения.
      void channelInfo(m.channel_id).then(where => {
        if (!where) return
        const me = ctx.myName()
        const mentioned = !!me && !!m.content && mentionsUser(m.content, me)
        // Режим канала важнее режима сервера — как в самом приложении:
        // заглушённый канал молчит, даже если сервер звучит.
        if (!shouldNotify(chNotifModeOf(m.channel_id, where.serverId), mentioned)) return
        msgSound()
        notifyMessage({
          author: m.author_name || 'Сообщение',
          channel: where.channel,
          text: m.content ?? '',
          hasAttach: !!m.attach_url,
          mention: mentioned,
          icon: ctx.avatarOf(m.author),
          tag: 'ch:' + m.channel_id,
          route: 'neylivo://msg/s/' + where.serverId + '/' + m.channel_id + '/' + m.id,
        })
      })
    })
    .subscribe()

  return () => { supabase.removeChannel(dm); supabase.removeChannel(srv) }
}
