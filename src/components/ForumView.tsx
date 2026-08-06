// v1.320.0: форум — канал, в котором вместо общей ленты список обсуждений.
// Раньше тип «Форум» в модалке создания канала был серой кнопкой с тостом
// «Форумы скоро появятся»; это была последняя такая заглушка.
//
// Само обсуждение — это ветка (lib/threads.ts, supabase/70_threads.sql), поэтому
// открывается оно уже существующим ThreadPanel: закреп, реакции, правка и
// вложения там работают, дублировать их не пришлось. Здесь только список,
// сортировка, теги и создание обсуждения.
import { useEffect, useMemo, useRef, useState } from 'react'
import { humanText } from '../lib/humanFail'
import { supabase } from '../lib/supabase'
import { toastErr, toastOk } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import type { Server, Channel, Message } from '../types'
import {
  fetchForumPosts, createThread, updateThread, deleteThread, forumTagsOf,
  type Thread, type ForumTag, type ForumSort,
} from '../lib/threads'
import { uploadWithProgress } from '../lib/storage'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { Icon } from './icons'

// «5 мин назад» — как в MiniProfile.tsx, но с «только что»: в форуме
// последняя активность часто идёт секундами.
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'только что'
  const m = Math.floor(s / 60); if (m < 60) return m + ' мин назад'
  const h = Math.floor(m / 60); if (h < 24) return h + ' ч назад'
  const d = Math.floor(h / 24); if (d < 30) return d + ' дн назад'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function ruReplies(n: number): string {
  const d = n % 100
  if (d > 10 && d < 20) return n + ' ответов'
  const l = n % 10
  if (l === 1) return n + ' ответ'
  if (l >= 2 && l <= 4) return n + ' ответа'
  return n + ' ответов'
}

const SORTS: { k: ForumSort; t: string }[] = [
  { k: 'activity', t: 'По активности' },
  { k: 'new', t: 'Сначала новые' },
  { k: 'replies', t: 'Больше ответов' },
]

export function ForumView({
  server, channel, user, username, tags, canPost, canModerate, canAttachFiles, automodCheck, avatarOf, onOpen,
}: {
  server: Server
  channel: Channel
  user: { id: string }
  username: string
  tags: ForumTag[]
  /** Право писать в канал: у форума оно же решает, можно ли завести обсуждение. */
  canPost: boolean
  /** Владелец сервера или управление сообщениями/каналами — закрепить, закрыть, удалить чужое. */
  canModerate: boolean
  canAttachFiles?: boolean
  automodCheck?: (text: string) => string | null
  avatarOf?: (userId: string) => string | null | undefined
  onOpen: (t: Thread) => void
}) {
  const [posts, setPosts] = useState<Thread[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<ForumSort>('activity')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])

  // v1.327.0: номер запроса. Без него медленный ответ по одному форуму приходил
  // последним и подменял собой список уже открытого другого — ровно та же гонка,
  // что чинили для ленты канала в v1.260.0.
  const seq = useRef(0)
  const load = useRef<(silent?: boolean) => void>(() => {})
  load.current = (silent?: boolean) => {
    const my = ++seq.current
    const forChannel = channel.id
    if (!silent) setLoading(true)
    fetchForumPosts(forChannel, sort)
      .then(list => { if (my !== seq.current) return; setPosts(list); setErr(null) })
      .catch(e => { if (my === seq.current) setErr(humanText(e)) })
      .finally(() => { if (my === seq.current) setLoading(false) })
  }

  useEffect(() => { load.current() }, [channel.id, sort])

  // Перешли в другой форум — сбрасываем поиск, выбранные теги и незакрытую
  // модалку создания. Компонент при переходе между каналами не размонтируется,
  // поэтому фильтр по тегу чужого канала спрятал бы вообще всё (причём с виду без
  // причины: такой кнопки в новом канале даже нет), а открытая модалка «Новое
  // обсуждение» молча начала бы создавать его уже в другом канале.
  useEffect(() => { setQ(''); setTagFilter([]); setCreating(false); setMenuFor(null) }, [channel.id])

  // Список обновляется и от чужих обсуждений, и от чужих ответов: reply_count с
  // last_activity меняет триггер базы, то есть приходят они как UPDATE строки.
  // Задержка в полсекунды — на оживлённом форуме каждое сообщение в каждом
  // обсуждении иначе перечитывало бы весь список.
  useEffect(() => {
    let timer = 0
    const ch = supabase.channel('forum:' + channel.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads', filter: 'channel_id=eq.' + channel.id },
        () => { window.clearTimeout(timer); timer = window.setTimeout(() => load.current(true), 500) })
      .subscribe()
    return () => { window.clearTimeout(timer); supabase.removeChannel(ch) }
  }, [channel.id])

  // Первое сообщение обсуждения — для строчки-превью под названием. Тянем одним
  // запросом и только для показанных: иначе это запрос на каждую карточку.
  useEffect(() => {
    const ids = posts.map(p => p.origin_message_id).filter((x): x is string => !!x)
      .filter(id => !(id in previews))
    if (ids.length === 0) return
    let ok = true
    supabase.from('messages').select('id, content, attach_url').in('id', ids.slice(0, 100))
      .then(({ data }) => {
        if (!ok || !data) return
        // Заранее помечаем все спрошенные id: сообщение могли удалить, и без
        // отметки мы просили бы его снова при каждом обновлении списка.
        const add: Record<string, string> = Object.fromEntries(ids.map(id => [id, '']))
        for (const m of data as Pick<Message, 'id' | 'content' | 'attach_url'>[]) {
          add[m.id] = (m.content || '').trim() || (m.attach_url ? 'Вложение' : '')
        }
        setPreviews(p => ({ ...p, ...add }))
      })
    return () => { ok = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return posts.filter(p => {
      if (needle && !p.name.toLowerCase().includes(needle)) return false
      if (tagFilter.length && !tagFilter.every(t => (p.tags ?? []).includes(t))) return false
      return true
    })
  }, [posts, q, tagFilter])

  async function toggle(p: Thread, patch: { pinned?: boolean; locked?: boolean; archived?: boolean }) {
    setMenuFor(null)
    try {
      const got = await updateThread(p.id, patch)
      setPosts(list => list.map(x => x.id === p.id ? got : x).slice()
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)))
      if (patch.pinned !== undefined) toastOk(patch.pinned ? 'Обсуждение закреплено' : 'Обсуждение откреплено')
      if (patch.locked !== undefined) toastOk(patch.locked ? 'Обсуждение закрыто' : 'Обсуждение открыто')
      if (patch.archived !== undefined) toastOk(patch.archived ? 'Обсуждение свёрнуто' : 'Обсуждение развёрнуто')
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  async function remove(p: Thread) {
    setMenuFor(null)
    if (!await confirmUi(`Удалить обсуждение «${p.name}»? Вместе с ним исчезнут все ответы.`, { okText: 'Удалить' })) return
    try {
      await deleteThread(p.id)
      setPosts(list => list.filter(x => x.id !== p.id))
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  return (
    <div className="forum" onClick={() => setMenuFor(null)}>
      <div className="forum-top">
        <input className="forum-q" placeholder="Поиск по названию обсуждения" value={q} onChange={e => setQ(e.target.value)} />
        <select className="forum-sort" value={sort} onChange={e => setSort(e.target.value as ForumSort)}>
          {SORTS.map(s => <option key={s.k} value={s.k}>{s.t}</option>)}
        </select>
        {canPost && <button className="forum-new" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} /> Новое обсуждение
        </button>}
      </div>

      {tags.length > 0 && <div className="forum-tags-bar">
        {tags.map(t => (
          <button key={t.id} className={'forum-tag' + (tagFilter.includes(t.id) ? ' on' : '')}
            onClick={() => setTagFilter(f => f.includes(t.id) ? f.filter(x => x !== t.id) : [...f, t.id])}>
            {t.emoji && <span className="forum-tag-e">{t.emoji}</span>}{t.name}
          </button>
        ))}
        {tagFilter.length > 0 && <button className="forum-tag clear" onClick={() => setTagFilter([])}>Сбросить</button>}
      </div>}

      {err && <div className="forum-err">{err}</div>}

      <div className="forum-list">
        {loading && posts.length === 0 && <div className="forum-empty">Загружаем обсуждения…</div>}
        {!loading && !err && shown.length === 0 && (
          posts.length === 0
            ? <div className="forum-empty">
                <div className="forum-empty-ic"><Icon name="threads" size={26} /></div>
                <b>Здесь пока пусто</b>
                <span>Форум — это канал, где у каждой темы своё обсуждение со своим названием{tags.length > 0 ? ' и тегами' : ''}.{canPost ? ' Заведи первое.' : ''}</span>
                {canPost && <button className="forum-new" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> Новое обсуждение</button>}
              </div>
            : <div className="forum-empty"><b>Ничего не нашлось</b><span>Под выбранные теги и запрос не подошло ни одно обсуждение.</span></div>
        )}
        {shown.map(p => {
          const preview = p.origin_message_id ? previews[p.origin_message_id] : undefined
          const mine = p.created_by === user.id
          return (
            <div key={p.id} className={'forum-card' + (p.pinned ? ' pinned' : '') + (p.archived ? ' arch' : '')}
              onClick={() => onOpen(p)}>
              <Avatar name={p.created_by_name} url={avatarOf?.(p.created_by) ?? null} size={40} userId={p.created_by} />
              <div className="forum-card-body">
                <div className="forum-card-h">
                  {p.pinned && <span className="forum-badge pin" title="Закреплено"><Icon name="pin" size={12} /></span>}
                  {p.locked && <span className="forum-badge lock" title="Обсуждение закрыто"><Icon name="lock" size={12} /></span>}
                  <b className="forum-card-t">{p.name}</b>
                </div>
                {(p.tags ?? []).length > 0 && <div className="forum-card-tags">
                  {(p.tags ?? []).map(id => {
                    const t = tagById[id]
                    // Тег могли удалить из настроек канала уже после того, как его
                    // повесили: показываем то, что осталось, а не «undefined».
                    return t ? <span key={id} className="forum-tag sm">{t.emoji && <span className="forum-tag-e">{t.emoji}</span>}{t.name}</span> : null
                  })}
                </div>}
                {preview && <div className="forum-card-prev">{preview.slice(0, 160)}</div>}
                <div className="forum-card-meta">
                  <span>{p.created_by_name}</span>
                  <span className="forum-dot">·</span>
                  <span>{ruReplies(p.reply_count ?? 0)}</span>
                  <span className="forum-dot">·</span>
                  <span>{ago(p.last_activity ?? p.created_at)}</span>
                  {p.archived && <><span className="forum-dot">·</span><span>свёрнуто</span></>}
                </div>
              </div>
              {(mine || canModerate) && <div className="forum-card-act">
                <button className="forum-kebab" title="Действия"
                  onClick={e => { e.stopPropagation(); setMenuFor(m => m === p.id ? null : p.id) }}>⋯</button>
                {menuFor === p.id && <div className="forum-menu" onClick={e => e.stopPropagation()}>
                  {canModerate && <div className="ctx-item" onClick={() => toggle(p, { pinned: !p.pinned })}>
                    <Icon name="pin" size={14} /> {p.pinned ? 'Открепить' : 'Закрепить'}</div>}
                  {canModerate && <div className="ctx-item" onClick={() => toggle(p, { locked: !p.locked })}>
                    <Icon name="lock" size={14} /> {p.locked ? 'Открыть обсуждение' : 'Закрыть обсуждение'}</div>}
                  <div className="ctx-item" onClick={() => toggle(p, { archived: !p.archived })}>
                    <Icon name="threads" size={14} /> {p.archived ? 'Развернуть' : 'Свернуть'}</div>
                  <div className="ctx-item danger" onClick={() => remove(p)}>
                    <Icon name="trash" size={14} /> Удалить</div>
                </div>}
              </div>}
            </div>
          )
        })}
      </div>

      {creating && <NewPostModal server={server} channel={channel} user={user} username={username} tags={tags}
        canAttachFiles={canAttachFiles} automodCheck={automodCheck}
        onClose={() => setCreating(false)}
        onCreated={t => { setCreating(false); setPosts(list => [t, ...list]); onOpen(t) }} />}
    </div>
  )
}

// Создание обсуждения: название, теги и первое сообщение. Первое сообщение —
// обычный Composer, чтобы вложения, эмодзи и упоминания работали здесь так же,
// как в любом другом месте, а не отдельной урезанной формой.
function NewPostModal({ server, channel, user, username, tags, canAttachFiles, automodCheck, onClose, onCreated }: {
  server: Server; channel: Channel; user: { id: string }; username: string
  tags: ForumTag[]
  canAttachFiles?: boolean
  automodCheck?: (text: string) => string | null
  onClose: () => void
  onCreated: (t: Thread) => void
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // Ошибки отсюда уходят наверх намеренно: Composer очищает поле только после
  // успешного onSend, а сам показывает тост с причиной. Проглотить их значило бы
  // стереть человеку уже написанное первое сообщение.
  async function submit(text: string, attach?: { url: string; type: string }, files?: File[]) {
    const nm = name.trim()
    if (!nm) throw new Error('Придумай название обсуждения')
    if (busy) return
    setBusy(true)
    let thread: Thread | null = null
    try {
      thread = await createThread(channel.id, server.id, nm, user.id, username, null, picked)
      // Вложения заливаются ДО отправки: в отличие от ленты канала, здесь нечему
      // показать промежуточное состояние — обсуждения ещё нет на экране.
      let attachUrl = attach?.url ?? null
      if (files?.length && attach) {
        const spoiler = attach.url.split('\n').map(u => u.includes('#spoiler'))
        const urls: string[] = []
        for (let i = 0; i < files.length; i++) {
          let u = await uploadWithProgress('attachments', user.id, files[i], () => {})
          if (spoiler[i]) u += '#spoiler'
          urls.push(u)
        }
        attach.url.split('\n').forEach(u => { const b = u.replace('#spoiler', ''); if (b.startsWith('blob:')) URL.revokeObjectURL(b) })
        attachUrl = urls.join('\n')
      }
      const { data, error } = await supabase.from('messages').insert({
        channel_id: channel.id, thread_id: thread.id, author: user.id, author_name: username,
        content: text, attach_url: attachUrl, attach_type: attach?.type ?? null,
      }).select('id').single()
      if (error) throw new Error(error.message)
      // origin_message_id у обсуждения форума указывает на его же первое
      // сообщение — по нему список тянет строчку-превью одним запросом вместо
      // запроса на каждую карточку.
      const { data: upd } = await supabase.from('threads')
        .update({ origin_message_id: data.id }).eq('id', thread.id).select()
      onCreated((upd?.[0] as Thread) ?? { ...thread, origin_message_id: data.id as string })
    } catch (e: any) {
      // Обсуждение без первого сообщения — пустая строка в списке, которую никто
      // не заводил намеренно. Убираем за собой.
      if (thread) { try { await deleteThread(thread.id) } catch { /* уже нет прав или нет строки */ } }
      setBusy(false)
      throw e instanceof Error ? e : new Error(String(e))
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal forum-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title" style={{ textAlign: 'left' }}>Новое обсуждение</div>
        <div className="modal-sub" style={{ textAlign: 'left' }}>в #{channel.name}</div>
        <label className="modal-lbl">Название</label>
        <input className="modal-in" autoFocus maxLength={100} placeholder="О чём обсуждение"
          value={name} onChange={e => setName(e.target.value)} />
        {tags.length > 0 && <>
          <label className="modal-lbl">Теги</label>
          <div className="forum-tags-bar">
            {tags.map(t => (
              <button key={t.id} className={'forum-tag' + (picked.includes(t.id) ? ' on' : '')}
                onClick={() => setPicked(p => p.includes(t.id) ? p.filter(x => x !== t.id) : [...p, t.id])}>
                {t.emoji && <span className="forum-tag-e">{t.emoji}</span>}{t.name}
              </button>
            ))}
          </div>
        </>}
        <label className="modal-lbl">Первое сообщение</label>
        <Composer placeholder="Напиши, с чего начать" onSend={submit} draftKey={'forumnew_' + channel.id}
          serverId={server.id} channelId={channel.id} canAttachFiles={canAttachFiles} automodCheck={automodCheck} />
        <div className="cset-hint">Обсуждение появится, когда отправишь первое сообщение.</div>
      </div>
    </div>
  )
}
