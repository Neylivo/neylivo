
import { useState } from 'react'

// Keyless GIF picker — like the prototype: a built-in list of public GIF URLs,
// add-by-URL, and a persisted "Мои GIF" store in localStorage. No Tenor/Giphy API key.
const MY_KEY = 'ponoi_my_gifs_v1'
const BUILTIN = [
  'https://media.tenor.com/BeAr7d5A1AsAAAAC/cat.gif',
  'https://media.tenor.com/8Nl6zY0Jd0kAAAAC/thumbs-up.gif',
  'https://media.tenor.com/1B9zC3zVvJcAAAAC/dance.gif',
  'https://media.tenor.com/qtF0oS6t9nkAAAAC/lol.gif',
  'https://media.tenor.com/wZmQ0hqk3zEAAAAC/cry.gif',
  'https://media.tenor.com/gUjT4H8mZk4AAAAC/heart.gif',
]
function loadMine(): string[] { try { return JSON.parse(localStorage.getItem(MY_KEY) || '[]') } catch { return [] } }
function saveMine(l: string[]) { localStorage.setItem(MY_KEY, JSON.stringify(l)) }

export function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [mine, setMine] = useState<string[]>(loadMine)
  function addUrl() {
    const url = prompt('URL GIF-картинки')?.trim(); if (!url) return
    const n = [url, ...mine]; setMine(n); saveMine(n)
  }
  function removeMine(url: string) { const n = mine.filter(u => u !== url); setMine(n); saveMine(n) }

  return (
    <div className="emoji-pop gif-pop" onClick={e => e.stopPropagation()}>
      <div className="emoji-tabs">
        <b style={{ flex: 1, padding: '4px 6px' }}>GIF</b>
        <button className="emoji-add" style={{ margin: 0 }} onClick={addUrl}>＋ URL</button>
        <button className="emoji-x" onClick={onClose}>✕</button>
      </div>
      <div className="emoji-scroll">
        {mine.length > 0 && <>
          <div className="emoji-grp">Мои GIF</div>
          <div className="gif-grid">
            {mine.map(u => (
              <div key={u} className="gif-cell" onClick={() => onPick(u)}>
                <img src={u} alt="gif" />
                <span className="emoji-del" onClick={ev => { ev.stopPropagation(); removeMine(u) }}>✕</span>
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
