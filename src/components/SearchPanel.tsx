import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from './icons'
import { timeShort } from '../lib/ui'
import { jumpToMessage } from './MessageList'

// Поиск сообщений как в Discord. Понимает фильтры прямо в строке:
//   from:имя        — только от этого автора
//   in:канал        — только в этом канале сервера (по (под)совпадению имени)
//   before:2026-07-01, after:2026-06-01 — по дате
//   has:link / has:file / has:image     — только со ссылками / файлами / картинками
// Остальной текст — поисковая фраза (ILIKE по содержимому).

export interface SearchScope {
  table: 'messages' | 'dm_messages'
  // messages: список id каналов сервера; dm_messages: id диалога
  channelIds?: string[]
  dmId?: string
  channelName?: (channelId: string) => string
  // v1.262.0: фильтр in:канал (как in:#канал в Discord) — только для messages,
  // сужает поиск до одного канала сервера по (под)совпадению имени.
  channelIdByName?: (name: string) => string | null
}

interface Hit {
  id: string; author_name: string; content: string | null; created_at: string
  channel_id?: string; attach_url?: string | null
}

function parseQuery(raw: string) {
  let text = raw
  const take = (re: RegExp) => {
    const m = text.match(re)
    if (m) text = text.replace(re, ' ')
    return m?.[1]
  }
  const from = take(/from:(\S+)/i)
  const inCh = take(/in:#?(\S+)/i)
  const before = take(/before:(\d{4}-\d{2}-\d{2})/i)
  const after = take(/after:(\d{4}-\d{2}-\d{2})/i)
  const has = take(/has:(link|file|image)/i)?.toLowerCase()
  return { text: text.replace(/\s+/g, ' ').trim(), from, inCh, before, after, has }
}

export function SearchPanel({ scope, onClose }: { scope: SearchScope; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const inRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  // v1.262.0: debounce отменяет только несработавший ТАЙМЕР — уже запущенный запрос
  // долетал независимо. Широкий запрос, уточнённый через 350мс более узким, мог
  // ответить ПОЗЖЕ узкого и подменить свежие результаты устаревшими.
  const runSeq = useRef(0)

  useEffect(() => { inRef.current?.focus() }, [])

  // Клик в пустую область чата закрывает панель поиска (клики по шапке не считаются).
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (panelRef.current && !panelRef.current.contains(t) && t.closest('.msgs')) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (!q.trim()) { setHits(null); return }
    timer.current = window.setTimeout(run, 350)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  async function run() {
    const seq = ++runSeq.current
    const p = parseQuery(q)
    if (!p.text && !p.from && !p.inCh && !p.before && !p.after && !p.has) { setHits(null); return }
    setBusy(true)
    try {
      let sel = supabase.from(scope.table).select('*')
      if (scope.table === 'messages') {
        const inId = p.inCh ? scope.channelIdByName?.(p.inCh) : null
        if (p.inCh && !inId) { setHits([]); return }   // указан канал, которого нет — честно «ничего не найдено», а не весь сервер
        sel = inId ? sel.eq('channel_id', inId) : sel.in('channel_id', scope.channelIds ?? [])
      }
      else sel = sel.eq('thread_id', scope.dmId)   // dm_messages.thread_id, не dm_id — такой колонки не существует
      if (p.text) sel = sel.ilike('content', '%' + p.text + '%')
      if (p.from) sel = sel.ilike('author_name', p.from + '%')
      if (p.after) sel = sel.gte('created_at', p.after)
      if (p.before) sel = sel.lte('created_at', p.before + 'T23:59:59')
      if (p.has === 'file' || p.has === 'image') sel = sel.not('attach_url', 'is', null)
      if (p.has === 'link') sel = sel.ilike('content', '%http%')
      const { data } = await sel.order('created_at', { ascending: false }).limit(50)
      if (runSeq.current !== seq) return   // более новый запрос уже в пути/ответил — не подменяем его результат
      let rows = (data ?? []) as Hit[]
      if (p.has === 'image') rows = rows.filter(h => (h as any).attach_type?.startsWith?.('image'))
      if (p.has === 'file') rows = rows.filter(h => !(h as any).attach_type?.startsWith?.('image'))   // «файл» — не картинка, у той свой фильтр
      setHits(rows)
    } finally { if (runSeq.current === seq) setBusy(false) }
  }

  return (
    <div className="search-panel" ref={panelRef}>
      <div className="search-head">
        <Icon name="search" size={15} />
        <input ref={inRef} value={q} onChange={e => setQ(e.target.value)}
          placeholder={scope.table === 'messages' ? 'Поиск…  (from:имя  in:канал  before:2026-01-01  after:…  has:link/file/image)' : 'Поиск…  (from:имя  before:2026-01-01  after:…  has:link/file/image)'}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (q) setQ(''); else onClose() } }} />
        {busy && <span className="search-busy" />}
        <button className="search-x" onClick={onClose} title="Закрыть"><Icon name="close" size={14} /></button>
      </div>
      {hits !== null && <div className="search-res">
        <div className="search-cnt">{hits.length === 0 ? 'Ничего не найдено' : 'Результатов: ' + hits.length + (hits.length === 50 ? '+' : '')}</div>
        {hits.map(h => (
          <div key={h.id} className="search-hit" title="Перейти к сообщению" onClick={() => jumpToMessage(h.id)}>
            <div className="search-hit-top">
              <b>{h.author_name}</b>
              {scope.channelName && h.channel_id && <span className="search-hit-ch">#{scope.channelName(h.channel_id)}</span>}
              <span className="search-hit-t">{new Date(h.created_at).toLocaleDateString()} {timeShort(h.created_at)}</span>
            </div>
            <div className="search-hit-body">{h.content || (h.attach_url ? '📎 вложение' : '')}</div>
          </div>
        ))}
      </div>}
    </div>
  )
}
