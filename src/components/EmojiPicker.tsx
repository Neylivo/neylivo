
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { EMOJI_GROUPS, loadCustom, addCustom, removeCustom } from '../lib/emoji'
import { uploadTo } from '../lib/storage'
import { toastErr } from '../lib/toast'
import { Icon } from './icons'
import { Em } from '../lib/twemoji'

// Пикер эмодзи в стиле Discord: поиск сверху, слева рейка категорий,
// секция «СВОИ ЭМОДЗИ» — общая коллекция (таблица custom_emoji): плюс-плитка
// создаёт эмодзи из любой картинки, правый клик по эмодзи — удаляет.
export function EmojiPicker({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const { user } = useAuth()
  const [custom, setCustom] = useState(loadCustom())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState(-1)   // -1 = свои эмодзи, 0..N — группы
  const fileRef = useRef<HTMLInputElement>(null)
  // Счётчик использования эмодзи — самые частые показываются отдельной группой сверху.
  const [freq, setFreq] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('ponoi_emoji_freq') || '{}') } catch { return {} }
  })

  // Refresh the grid whenever the shared emoji cache changes (realtime sync).
  useEffect(() => {
    const h = () => setCustom({ ...loadCustom() })
    window.addEventListener('ponoi-custom-emoji', h)
    return () => window.removeEventListener('ponoi-custom-emoji', h)
  }, [])

  function pick(e: string) {
    const f = { ...freq, [e]: (freq[e] ?? 0) + 1 }
    setFreq(f)
    try { localStorage.setItem('ponoi_emoji_freq', JSON.stringify(f)) } catch {}
    onPick(e)
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e]) => e)

  // Создание своего эмодзи из картинки: файл -> хранилище -> общая таблица.
  async function addFromFile(f: File) {
    if (!user) return
    const name = prompt('Название эмодзи (латиница/цифры), напр. ponoi')?.trim()
    if (!name) return
    try {
      const url = await uploadTo('attachments', user.id, f)
      setCustom({ ...(await addCustom(name, url, user.id)) })
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  const entries = Object.entries(custom)
  const found = q.trim() ? entries.filter(([n]) => n.toLowerCase().includes(q.trim().toLowerCase())) : entries

  const customCell = ([n, u]: [string, string]) => (
    <button key={n} className="ep2-cell" title={':' + n + ':  (правый клик — удалить)'}
      onClick={() => onPick(':' + n + ':')}
      onContextMenu={e => { e.preventDefault(); removeCustom(n).then(m => setCustom({ ...m })) }}>
      <img src={u} alt={n} />
    </button>
  )

  return (
    <div className="emoji-pop ep2" onClick={e => e.stopPropagation()}>
      <div className="ep2-search">
        <input placeholder="Поиск (свои эмодзи — по названию)" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <button className="emoji-x" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="ep2-body">
        <div className="ep2-rail">
          <button className={cat === -1 ? 'on' : ''} title="Свои эмодзи" onClick={() => { setCat(-1); setQ('') }}><Icon name="star" size={18} /></button>
          {EMOJI_GROUPS.map((g, i) => (
            <button key={g.title} className={cat === i ? 'on' : ''} title={g.title} onClick={() => { setCat(i); setQ('') }}><Em>{g.emojis[0]}</Em></button>
          ))}
        </div>
        <div className="emoji-scroll ep2-scroll">
          {q.trim() ? <>
            <div className="emoji-grp">СВОИ ЭМОДЗИ</div>
            {found.length === 0 && <div className="ep2-hint">Ничего не нашлось — свои эмодзи ищутся по названию.</div>}
            <div className="ep2-grid">{found.map(customCell)}</div>
          </> : cat === -1 ? <>
            <div className="emoji-grp">СВОИ ЭМОДЗИ</div>
            <div className="ep2-grid">
              <button className="ep2-cell ep2-add" title="Создать эмодзи из картинки" onClick={() => fileRef.current?.click()}><Icon name="plus" size={20} /></button>
              {entries.map(customCell)}
            </div>
            {entries.length === 0 && <div className="ep2-hint">Нажми +, чтобы сделать свои эмодзи из любой картинки. Правый клик по эмодзи — удалить.</div>}
          </> : <>
            {cat === 0 && top.length > 0 && <>
              <div className="emoji-grp">Часто используемые</div>
              <div className="ep2-grid">{top.map(e => <button key={'t' + e} className="ep2-cell" onClick={() => pick(e)}><Em>{e}</Em></button>)}</div>
            </>}
            <div className="emoji-grp">{EMOJI_GROUPS[cat].title}</div>
            <div className="ep2-grid">
              {EMOJI_GROUPS[cat].emojis.map(e => <button key={e} className="ep2-cell" onClick={() => pick(e)}><Em>{e}</Em></button>)}
            </div>
          </>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addFromFile(f) }} />
    </div>
  )
}
