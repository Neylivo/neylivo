import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { EMOJI_GROUPS, loadCustom, addCustom, removeCustom } from '../lib/emoji'

export function EmojiPicker({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'emoji' | 'custom'>('emoji')
  const [custom, setCustom] = useState(loadCustom())
  const [q, setQ] = useState('')

  // Refresh the grid whenever the shared emoji cache changes (realtime sync).
  useEffect(() => {
    const h = () => setCustom({ ...loadCustom() })
    window.addEventListener('ponoi-custom-emoji', h)
    return () => window.removeEventListener('ponoi-custom-emoji', h)
  }, [])

  async function addNew() {
    if (!user) return
    const name = prompt('Имя кастом-эмодзи (латиница/цифры), напр. ponoi')?.trim(); if (!name) return
    const url = prompt('URL картинки (png/gif)')?.trim(); if (!url) return
    setCustom({ ...(await addCustom(name, url, user.id)) })
  }

  return (
    <div className="emoji-pop" onClick={e => e.stopPropagation()}>
      <div className="emoji-tabs">
        <button className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>😊 Эмодзи</button>
        <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>⭐ Свои</button>
        <button className="emoji-x" onClick={onClose}>✕</button>
      </div>
      {tab === 'emoji' && <>
        <input className="emoji-search" placeholder="Поиск…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="emoji-scroll">
          {EMOJI_GROUPS.map(g => {
            const items = g.emojis
            if (!items.length) return null
            return (
              <div key={g.title}>
                <div className="emoji-grp">{g.title}</div>
                <div className="emoji-grid">
                  {items.map((e, i) => <button key={g.title + i} className="emoji-btn" onClick={() => onPick(e)}>{e}</button>)}
                </div>
              </div>
            )
          })}
        </div>
      </>}
      {tab === 'custom' && <div className="emoji-scroll">
        <button className="emoji-add" onClick={addNew}>＋ Добавить свой эмодзи</button>
        <div className="emoji-grid">
          {Object.entries(custom).map(([name, url]) => (
            <button key={name} className="emoji-btn cust" title={':' + name + ':'} onClick={() => onPick(':' + name + ':')}>
              <img src={url} alt={name} />
              <span className="emoji-del" onClick={async ev => { ev.stopPropagation(); setCustom({ ...(await removeCustom(name)) }) }}>✕</span>
            </button>
          ))}
        </div>
        {!Object.keys(custom).length && <div className="mut" style={{ padding: 10, fontSize: 13 }}>Пока нет своих эмодзи. Добавь по URL — их увидят все. Вставляются как :имя:</div>}
      </div>}
    </div>
  )
}