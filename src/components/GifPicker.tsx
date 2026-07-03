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

export function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const { user } = useAuth()
  const [mine, setMine] = useState<Gif[]>([])

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
        {mine.length > 0 && <>
          <div className="emoji-grp">Общие GIF</div>
          <div className="gif-grid">
            {mine.map(g => (
              <div key={g.id} className="gif-cell" onClick={() => onPick(g.url)}>
                <img src={g.url} alt="gif" />
                <span className="emoji-del" onClick={ev => { ev.stopPropagation(); removeMine(g.id) }}><Icon name="close" size={12} /></span>
              </div>
            ))}
          </div>
        </>}
        <div className="emoji-grp">Популярные</div>
        <div className="gif-grid">
          {BUILTIN.map(u => <div key={u} className="gif-cell" onClick={() => onPick(u)}><img src={u} alt="gif" /></div>)}
        </div>
      </div>
    </div>
  )
}