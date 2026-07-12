
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { Icon } from './icons'
import { resolveGif, TENOR_KEY, TENOR_V2 } from '../lib/gifUrl'
import { getUserPrefs, patchUserPrefs } from '../lib/userPrefs'
import { loadStickers, serverNameOf, type ServerSticker } from '../lib/serverEmoji'

// GIF-пикер как в Discord: вкладки «Гифки» (поиск), «По ссылке», «Мои GIF»
// (общая коллекция + избранное), «Стикеры» (серверов, где я состою) и «Эмодзи»
// (переключает на пикер эмодзи).
// Поиск и «популярные» работают через Tenor API v2 (нужен VITE_TENOR_KEY —
// Tenor v1 отключён Google). Без ключа вкладка «Гифки» показывает подсказку,
// но «По ссылке»/«Мои GIF»/«Стикеры» работают без него, ключ не требуется.

async function tenorGifs(path: string): Promise<string[]> {
  if (!TENOR_KEY) return []
  try {
    const r = await fetch(TENOR_V2 + '/' + path + '&key=' + TENOR_KEY + '&client_key=ponoi&limit=24&media_filter=tinygif')
    const j = await r.json()
    return ((j.results ?? []) as any[]).map(it => it.media_formats?.tinygif?.url).filter(Boolean)
  } catch { return [] }
}

interface Gif { id: string; url: string }

// Избранные GIF: личный список, синхронизируется через user_prefs (миграция 39).
function loadFavs(): string[] { return getUserPrefs().gif_favs }

export function GifPicker({ onPick, onPickSticker, onClose, onEmojiTab }:
  { onPick: (url: string) => void
    // v1.250.0: стикер — отдельный колбэк (не onPick): отправляется как вложение
    // attach_type='sticker' (см. Composer.tsx), а не как обычная картинка/GIF.
    onPickSticker?: (url: string, name: string) => void
    onClose: () => void; onEmojiTab?: () => void }) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'gifs' | 'url' | 'mine' | 'stickers'>('gifs')
  const [stickers, setStickers] = useState<ServerSticker[]>(loadStickers())
  useEffect(() => {
    const h = () => setStickers([...loadStickers()])
    window.addEventListener('ponoi-stickers', h)
    return () => window.removeEventListener('ponoi-stickers', h)
  }, [])
  const [q, setQ] = useState('')
  const [list, setList] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [mine, setMine] = useState<Gif[]>([])
  const [favs, setFavs] = useState<string[]>(loadFavs)
  const [urlIn, setUrlIn] = useState('')
  const [urlGif, setUrlGif] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const debRef = useRef(0)
  const markBroken = (u: string) => setBroken(b => (b.has(u) ? b : new Set(b).add(u)))

  // v1.89.0: в «По ссылке» можно вставить не только прямой .gif, но и страницу
  // Tenor/Giphy (например, «Копировать ссылку» на гифке в Discord) — резолвим её.
  useEffect(() => {
    const u = urlIn.trim()
    setUrlGif(null)
    if (!u) return
    let on = true
    resolveGif(u).then(r => { if (on && r) setUrlGif(r) })
    return () => { on = false }
  }, [urlIn])

  function toggleFav(url: string) {
    setFavs(f => {
      const next = f.includes(url) ? f.filter(u => u !== url) : [url, ...f].slice(0, 24)
      patchUserPrefs({ gif_favs: next })
      return next
    })
  }
  // Избранное могло догрузиться с сети уже после открытия пикера.
  useEffect(() => {
    const onSync = () => setFavs(loadFavs())
    window.addEventListener('ponoi-uprefs', onSync)
    return () => window.removeEventListener('ponoi-uprefs', onSync)
  }, [])

  // «Гифки»: без запроса — популярные (featured), с запросом — поиск (с задержкой при вводе).
  useEffect(() => {
    if (tab !== 'gifs' || !TENOR_KEY) return
    setLoading(true)
    window.clearTimeout(debRef.current)
    debRef.current = window.setTimeout(async () => {
      const res = await tenorGifs(q.trim() ? 'search?q=' + encodeURIComponent(q.trim()) : 'featured?')
      setList(res)
      setLoading(false)
    }, q.trim() ? 350 : 0)
    return () => window.clearTimeout(debRef.current)
  }, [q, tab])

  async function refresh() {
    const { data } = await supabase.from('gifs').select('id, url').order('created_at', { ascending: false })
    setMine((data ?? []) as Gif[])
  }
  useEffect(() => {
    refresh()
    const ch = supabase.channel('gifs_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gifs' }, () => { refresh() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  async function removeMine(id: string) {
    await supabase.from('gifs').delete().eq('id', id)
    refresh()
  }

  const cell = (u: string, del?: string) => broken.has(u) ? null : (
    <div key={(del ?? '') + u} className="gif-cell" onClick={() => onPick(u)}>
      <img src={u} alt="gif" loading="lazy" onError={() => markBroken(u)} />
      <span className={'gif-fav' + (favs.includes(u) ? ' on' : '')}
        title={favs.includes(u) ? 'Убрать из избранного' : 'В избранное'}
        onClick={ev => { ev.stopPropagation(); toggleFav(u) }}>★</span>
      {del && <span className="emoji-del" onClick={ev => { ev.stopPropagation(); removeMine(del) }}><Icon name="close" size={12} /></span>}
    </div>
  )

  return (
    <div className="emoji-pop gif-pop" onClick={e => e.stopPropagation()}>
      <div className="gp2-tabs">
        <button type="button" className={tab === 'gifs' ? 'on' : ''} onClick={() => setTab('gifs')}>Гифки</button>
        <button type="button" className={tab === 'url' ? 'on' : ''} onClick={() => setTab('url')}>По ссылке</button>
        <button type="button" className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Мои GIF</button>
        {stickers.length > 0 && <button type="button" className={tab === 'stickers' ? 'on' : ''} onClick={() => setTab('stickers')}>Стикеры</button>}
        <button type="button" onClick={() => onEmojiTab?.()}>Эмодзи</button>
        <button type="button" className="emoji-x" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      {tab === 'gifs' && <>
        <div className="gp2-search"><input placeholder="Поиск гифок…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} autoFocus /></div>
        <div className="emoji-scroll">
          {!TENOR_KEY
            ? <div className="ep2-hint">Поиск гифок пока не настроен. Добавь свою на вкладке «По ссылке» — вставится любая ссылка на .gif, Tenor или Giphy.</div>
            : loading
            ? <div className="ep2-hint">Ищу гифки…</div>
            : list.length === 0 && q.trim()
            ? <div className="ep2-hint">Ничего не найдено по «{q.trim()}»</div>
            : null}
          <div className="gif-grid">{list.map(u => cell(u))}</div>
        </div>
      </>}
      {tab === 'url' && <div className="gp2-url">
        <input placeholder="Вставь ссылку на гифку — хоть из Discord" value={urlIn} onChange={e => setUrlIn(e.target.value)}
          onKeyDown={e => { if (e.key !== 'Enter') return; e.preventDefault(); if (urlIn.trim()) { const u = urlGif ?? urlIn.trim(); setUrlIn(''); onPick(u) } }} autoFocus />
        {urlIn.trim() && !broken.has(urlGif ?? urlIn.trim()) && <img className="gp2-preview" src={urlGif ?? urlIn.trim()} alt="предпросмотр" onError={() => markBroken(urlGif ?? urlIn.trim())} />}
        {urlIn.trim() && broken.has(urlGif ?? urlIn.trim()) && <div className="ep2-hint">Не удалось загрузить превью — проверь ссылку</div>}
        <div className="gp2-url-btns">
          <button type="button" disabled={!urlIn.trim()} onClick={() => { const u = urlGif ?? urlIn.trim(); setUrlIn(''); onPick(u) }}>Отправить</button>
          <button type="button" disabled={!urlIn.trim() || !user} onClick={async () => { await supabase.from('gifs').insert({ url: urlGif ?? urlIn.trim(), owner: user!.id }); setUrlIn(''); refresh(); setTab('mine') }}>В «Мои GIF»</button>
        </div>
      </div>}
      {tab === 'mine' && <div className="emoji-scroll">
        {favs.length > 0 && <>
          <div className="emoji-grp">Избранное</div>
          <div className="gif-grid">{favs.map(u => cell(u))}</div>
        </>}
        <div className="emoji-grp">Общие GIF</div>
        {mine.length === 0 && <div className="ep2-hint">Пока пусто — добавь GIF на вкладке «По ссылке».</div>}
        <div className="gif-grid">{mine.map(g => cell(g.url, g.id))}</div>
      </div>}
      {tab === 'stickers' && <div className="emoji-scroll">
        {Object.entries(stickers.reduce((by, s) => { (by[s.server_id] ??= []).push(s); return by }, {} as Record<string, ServerSticker[]>))
          .map(([sid, list]) => (
            <div key={sid}>
              <div className="emoji-grp">{serverNameOf(sid).toUpperCase()}</div>
              <div className="gif-grid">{list.map(s => (
                <div key={s.id} className="gif-cell sticker-cell" title={s.name} onClick={() => onPickSticker?.(s.url, s.name)}>
                  <img src={s.url} alt={s.name} loading="lazy" />
                </div>
              ))}</div>
            </div>
          ))}
      </div>}
    </div>
  )
}
