import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { Icon } from './icons'

// Keyless GIF picker — like the prototype: a built-in list of public GIF URLs,
// add-by-URL, and a SHARED "Мои GIF" collection stored in the Supabase `gifs`
// table (visible to everyone, anyone can add). No Tenor/Giphy API key.
const BUILTIN = [
  'https://media.tenor.com/BeAr7d5A1AsAAAAC/cat.gif',
  'https://media.tenor.com/8Nl6zY0Jd0kAAAAC/thumbs-up.gif',
  'https://media.tenor.com/1B9zC3zVvJcAAAAC/dance.gif',
  'https://media.tenor.com/qtF0oS6t9nkAAAAC/lol.gif',
  'https://media.tenor.com/wZmQ0hqk3zEAAAAC/cry.gif',
  'https://media.tenor.com/gUjT4H8mZk4AAAAC/heart.gif',
]

interface Gif { id: string; url: string }

// Избранные GIF: личный список, хранится локально и переживает перезагрузку.
const FAV_KEY = 'ponoi_fav_gifs'
function loadFavs(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}

export function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const { user } = useAuth()
  const [mine, setMine] = useState<Gif[]>([])
  const [favs, setFavs] = useState<string[]>(loadFavs)

  function toggleFav(url: string) {
    setFavs(f => {
      const next = f.includes(url) ? f.filter(u => u !== url) : [url, ...f].slice(0, 24)
      localStorage.setItem(FAV_KEY, JSON.stringify(next))
      return next
    })
  }

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

  async function addUrl() {
    if (!user) return
    const url = prompt('URL GIF-картинки')?.trim(); if (!url) return
    await supabase.from('gifs').insert({ url, owner: user.id })
    refresh()
  }
  async function removeMine(id: string) {
    await supabase.from('gifs').delete().eq('id', id)
    refresh()
  }

  return (
    <div className="emoji-pop gif-pop" onClick={e => e.stopPropagation()}>
      <div className="emoji-tabs">
        <b style={{ flex: 1, padding: '4px 6px' }}>GIF</b>
        <button className="emoji-add" style={{ margin: 0 }} onClick={addUrl}><Icon name="plus" size={15} /> URL</button>
        <button className="emoji-x" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="emoji-scroll">
        {favs.length > 0 && <>
          <div className="emoji-grp">Избранное</div>
          <div className="gif-grid">
            {favs.map(u => (
              <div key={'f' + u} className="gif-cell" onClick={() => onPick(u)}>
                <img src={u} alt="gif" loading="lazy" />
                <span className="gif-fav on" title="Убрать из избранного" onClick={ev => { ev.stopPropagation(); toggleFav(u) }}>★</span>
              </div>
            ))}
          </div>
        </>}
        {mine.length > 0 && <>
          <div className="emoji-grp">Общие GIF</div>
          <div className="gif-grid">
            {mine.map(g => (
              <div key={g.id} className="gif-cell" onClick={() => onPick(g.url)}>
                <img src={g.url} alt="gif" loading="lazy" />
                <span className={'gif-fav' + (favs.includes(g.url) ? ' on' : '')} title={favs.includes(g.url) ? 'Убрать из избранного' : 'В избранное'} onClick={ev => { ev.stopPropagation(); toggleFav(g.url) }}>★</span>
                <span className="emoji-del" onClick={ev => { ev.stopPropagation(); removeMine(g.id) }}><Icon name="close" size={12} /></span>
              </div>
            ))}
          </div>
        </>}
        <div className="emoji-grp">Популярные</div>
        <div className="gif-grid">
          {BUILTIN.map(u => (
            <div key={u} className="gif-cell" onClick={() => onPick(u)}>
              <img src={u} alt="gif" loading="lazy" />
              <span className={'gif-fav' + (favs.includes(u) ? ' on' : '')} title={favs.includes(u) ? 'Убрать из избранного' : 'В избранное'} onClick={ev => { ev.stopPropagation(); toggleFav(u) }}>★</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}