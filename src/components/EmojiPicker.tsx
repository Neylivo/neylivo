
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import {
  EMOJI_GROUPS, loadCustom, addCustom, removeCustom, emojiOwner,
  loadFavs, fetchFavs, toggleFav, addFavs,
  loadPacks, fetchPacks, createPack, deletePack,
} from '../lib/emoji'
import { uploadTo } from '../lib/storage'
import { toastErr, toastOk } from '../lib/toast'
import { promptUi, confirmUi } from '../lib/confirm'
import { Icon } from './icons'
import { Em } from '../lib/twemoji'
import { useClampToViewport } from '../lib/clampPos'

// Пикер эмодзи в стиле Discord: поиск сверху, слева рейка категорий.
// v1.88.0: ⭐ «Избранные» (любые кастом-эмодзи, в т.ч. чужие — правый клик),
// 📁 паки эмодзи (создаются из своих/избранных, пак можно добавить в избранное),
// создание своих эмодзи чинит кириллицу (транслитерация) и показывает ошибки.
// cat: -3 паки, -2 избранные, -1 свои эмодзи, 0..N — юникод-группы.
export function EmojiPicker({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const { user } = useAuth()
  const [custom, setCustom] = useState(loadCustom())
  const [favs, setFavs] = useState<Set<string>>(new Set(loadFavs()))
  const [packs, setPacks] = useState(loadPacks())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState(-1)
  const [ctx, setCtx] = useState<{ x: number; y: number; name: string } | null>(null)
  const ctxClamp = useClampToViewport(ctx?.x ?? 0, ctx?.y ?? 0)
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  // Счётчик использования эмодзи — самые частые показываются отдельной группой сверху.
  const [freq, setFreq] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('ponoi_emoji_freq') || '{}') } catch { return {} }
  })

  // Refresh whenever shared caches change (realtime sync).
  useEffect(() => {
    const h1 = () => setCustom({ ...loadCustom() })
    const h2 = () => setFavs(new Set(loadFavs()))
    const h3 = () => setPacks([...loadPacks()])
    window.addEventListener('ponoi-custom-emoji', h1)
    window.addEventListener('ponoi-emoji-favs', h2)
    window.addEventListener('ponoi-emoji-packs', h3)
    if (user) fetchFavs(user.id)
    fetchPacks()
    return () => {
      window.removeEventListener('ponoi-custom-emoji', h1)
      window.removeEventListener('ponoi-emoji-favs', h2)
      window.removeEventListener('ponoi-emoji-packs', h3)
    }
    // eslint-disable-next-line
  }, [user?.id])

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
    const name = (await promptUi('Название эмодзи', { placeholder: 'напр. ponoi (кириллица станет латиницей)', okText: 'Создать' }))?.trim()
    if (!name) return
    try {
      const url = await uploadTo('attachments', user.id, f)
      setCustom({ ...(await addCustom(name, url, user.id)) })
      toastOk('Эмодзи создан — он личный и виден в пикере только тебе')
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
  }

  async function doCreatePack() {
    if (!user || sel.size === 0) return
    const name = (await promptUi('Название пака', { placeholder: 'напр. мемы', okText: 'Создать' }))?.trim()
    if (!name) return
    try {
      await createPack(user.id, name, Array.from(sel))
      setSelecting(false); setSel(new Set())
      toastOk('Пак «' + name + '» создан')
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
  }

  const entries = Object.entries(custom)
  // v1.137.0: эмодзи персональные — в пикере видны только СВОИ и избранные.
  // Чужие больше не показываются общим списком (но в сообщениях рендерятся,
  // и правым кликом по чужому эмодзи в сообщении его можно забрать в избранное).
  const mine = entries.filter(([n]) => (user ? emojiOwner(n) === user.id : false))
  const favEntries = entries.filter(([n]) => favs.has(n))
  const mineOrFav = entries.filter(([n]) => favs.has(n) || (user ? emojiOwner(n) === user.id : false))
  const found = q.trim() ? mineOrFav.filter(([n]) => n.toLowerCase().includes(q.trim().toLowerCase())) : mineOrFav

  const cell = ([n, u]: [string, string]) => selecting ? (
    <button type="button" key={n} className={'ep2-cell ep2-selcell' + (sel.has(n) ? ' sel' : '')} title={':' + n + ':'}
      onClick={() => setSel(s => { const t = new Set(s); if (t.has(n)) t.delete(n); else t.add(n); return t })}>
      <img src={u} alt={n} />
      {sel.has(n) && <span className="ep2-selmark"><Icon name="check" size={9} /></span>}
    </button>
  ) : (
    <button type="button" key={n} className="ep2-cell" title={':' + n + ':  (правый клик — меню)'}
      onClick={() => onPick(':' + n + ':')}
      onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, name: n }) }}>
      <img src={u} alt={n} />
    </button>
  )

  const packBlock = (p: { id: string; name: string; owner: string | null; items: string[] }) => (
    <div key={p.id}>
      <div className="emoji-grp ep2-packhdr">
        <span>{p.name}</span>
        <span className="ep2-pack-acts">
          <button type="button" title="Добавить пак в избранное"
            onClick={() => { if (user) addFavs(user.id, p.items).then(() => toastOk('Пак «' + p.name + '» добавлен в избранное')) }}>
            <Icon name="star" size={13} />
          </button>
          {user && p.owner === user.id && (
            <button type="button" title="Удалить пак" onClick={async () => {
              if (await confirmUi('Удалить пак «' + p.name + '»?', { danger: true, okText: 'Удалить' })) deletePack(p.id)
            }}><Icon name="trash" size={13} /></button>
          )}
        </span>
      </div>
      <div className="ep2-grid">{p.items.filter(n => custom[n]).map(n => cell([n, custom[n]]))}</div>
    </div>
  )

  return (
    <div className="emoji-pop ep2" onClick={e => e.stopPropagation()}>
      <div className="ep2-search">
        <input placeholder="Поиск (свои эмодзи — по названию)" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} autoFocus />
        <button type="button" className="emoji-x" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="ep2-body">
        <div className="ep2-rail">
          <button type="button" className={cat === -2 ? 'on' : ''} title="Избранные" onClick={() => { setCat(-2); setQ('') }}><Icon name="star" size={18} /></button>
          <button type="button" className={cat === -1 ? 'on' : ''} title="Свои эмодзи" onClick={() => { setCat(-1); setQ('') }}><Icon name="smile" size={18} /></button>
          <button type="button" className={cat === -3 ? 'on' : ''} title="Паки эмодзи" onClick={() => { setCat(-3); setQ('') }}><Icon name="folder" size={18} /></button>
          {EMOJI_GROUPS.map((g, i) => (
            <button type="button" key={g.title} className={cat === i ? 'on' : ''} title={g.title} onClick={() => { setCat(i); setQ('') }}><Em>{g.emojis[0]}</Em></button>
          ))}
        </div>
        <div className="emoji-scroll ep2-scroll">
          {q.trim() ? <>
            <div className="emoji-grp">СВОИ ЭМОДЗИ</div>
            {found.length === 0 && <div className="ep2-hint">Ничего не нашлось — свои эмодзи ищутся по названию.</div>}
            <div className="ep2-grid">{found.map(cell)}</div>
          </> : cat === -2 ? <>
            <div className="emoji-grp">ИЗБРАННЫЕ</div>
            <div className="ep2-grid">{favEntries.map(cell)}</div>
            {favEntries.length === 0 && <div className="ep2-hint">Пока пусто. Правый клик по кастом-эмодзи — в пикере или прямо по чужому эмодзи в сообщении — «В избранное». Можно добавить и целый пак — звёздочка у названия пака.</div>}
          </> : cat === -3 ? <>
            <div className="emoji-grp">ПАКИ ЭМОДЗИ</div>
            {!selecting && <div className="ep2-packbar">
              <button type="button" className="ep2-mkpack" onClick={() => { setSelecting(true); setSel(new Set()) }}><Icon name="plus" size={14} /> Создать пак</button>
            </div>}
            {selecting && <>
              <div className="ep2-hint">Выбери эмодзи для пака — из своих и избранных, — затем нажми «Создать».</div>
              <div className="ep2-grid">{mineOrFav.map(cell)}</div>
              {mineOrFav.length === 0 && <div className="ep2-hint">Нет своих или избранных эмодзи — сначала создай эмодзи или добавь чужие в избранное.</div>}
              <div className="ep2-packbar">
                <button type="button" className="ep2-mkpack ok" disabled={sel.size === 0} onClick={doCreatePack}><Icon name="check" size={14} /> Создать ({sel.size})</button>
                <button type="button" className="ep2-mkpack" onClick={() => { setSelecting(false); setSel(new Set()) }}>Отмена</button>
              </div>
            </>}
            {packs.map(packBlock)}
            {packs.length === 0 && !selecting && <div className="ep2-hint">Паков пока нет. Собери свой из своих и избранных эмодзи — его увидят все, и любой сможет добавить его в избранное.</div>}
          </> : cat === -1 ? <>
            <div className="emoji-grp">СВОИ ЭМОДЗИ</div>
            <div className="ep2-grid">
              <button type="button" className="ep2-cell ep2-add" title="Создать эмодзи из картинки" onClick={() => fileRef.current?.click()}><Icon name="plus" size={20} /></button>
              {mine.map(cell)}
            </div>
            {mine.length === 0 && <div className="ep2-hint">Нажми +, чтобы сделать свои эмодзи из любой картинки. Правый клик по эмодзи — меню: в избранное / удалить.</div>}
          </> : <>
            {cat === 0 && top.length > 0 && <>
              <div className="emoji-grp">Часто используемые</div>
              <div className="ep2-grid">{top.map(e => <button type="button" key={'t' + e} className="ep2-cell" onClick={() => pick(e)}><Em>{e}</Em></button>)}</div>
            </>}
            <div className="emoji-grp">{EMOJI_GROUPS[cat].title}</div>
            <div className="ep2-grid">
              {EMOJI_GROUPS[cat].emojis.map(e => <button type="button" key={e} className="ep2-cell" onClick={() => pick(e)}><Em>{e}</Em></button>)}
            </div>
          </>}
        </div>
      </div>
      {ctx && <>
        <div className="ep2-ctx-ov" onClick={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null) }} />
        <div className="ep2-ctx" ref={ctxClamp.ref} style={ctxClamp.style}>
          <button type="button" onClick={async () => { if (user) await toggleFav(user.id, ctx.name); setCtx(null) }}>
            <Icon name="star" size={14} /> {favs.has(ctx.name) ? 'Убрать из избранного' : 'В избранное'}
          </button>
          {user && emojiOwner(ctx.name) === user.id && (
            <button type="button" className="danger" onClick={async () => { setCtx(null); await removeCustom(ctx.name) }}>
              <Icon name="trash" size={14} /> Удалить эмодзи
            </button>
          )}
        </div>
      </>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addFromFile(f) }} />
    </div>
  )
}
