import { useEffect, useRef, useState } from 'react'
import { fetchGameCatalog, type CatalogGame } from '../lib/activity'
import { resolveCover } from '../lib/gameCovers'
import { Icon } from './icons'

// v1.162.0: пикер «Любимая игра» как в Discord — список игр берём из тех, во что
// реально играли пользователи Ponoi (activity_sessions), с обложкой (Steam/iTunes,
// как в «Недавней активности»), а не свободный ввод текста наугад.
export function GamePickerModal({ title, onPick, onClose }: { title: string; onPick: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<CatalogGame[] | null>(null)
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const inRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => { inRef.current?.focus() }, [])

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(load, q ? 300 : 0)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  async function load() {
    const games = await fetchGameCatalog(q)
    setList(games)
    for (const g of games) {
      if (g.name in covers) continue
      resolveCover(g.name).then(u => setCovers(c => ({ ...c, [g.name]: u })))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const qTrim = q.trim()
  const exact = qTrim && list?.some(g => g.name.toLowerCase() === qTrim.toLowerCase())

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal gpick" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">{title}</div>
        <div className="modal-sub">Игры, в которые играют на Ponoi</div>
        <div className="modal-inline" style={{ marginTop: 14 }}>
          <Icon name="search" size={15} />
          <input ref={inRef} className="modal-in" placeholder="Поиск игры…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="gpick-list">
          {qTrim && !exact && <div className="gpick-row" onClick={() => onPick(qTrim)}>
            <span className="act-cover act-cover-sm act-cover-ph"><Icon name="plus" size={18} /></span>
            <div className="act-info"><div className="act-name">Добавить «{qTrim}»</div></div>
          </div>}
          {list === null
            ? <div className="modal-empty">Загрузка…</div>
            : list.length === 0 && !qTrim
              ? <div className="modal-empty">Пока никто не играл ни во что на этом сервере</div>
              : list.map(g => (
                <div key={g.name} className="gpick-row" onClick={() => onPick(g.name)}>
                  {covers[g.name]
                    ? <img className="act-cover act-cover-sm" src={covers[g.name]!} alt="" />
                    : <span className="act-cover act-cover-sm act-cover-ph"><Icon name="gamepad" size={18} /></span>}
                  <div className="act-info">
                    <div className="act-name">{g.name}</div>
                    <div className="act-meta"><span>{g.players} {g.players === 1 ? 'игрок' : 'игроков'}</span></div>
                  </div>
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
