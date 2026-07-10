import { useEffect, useRef, useState } from 'react'
import { fetchGameCatalog, type CatalogGame } from '../lib/activity'
import { resolveCover } from '../lib/gameCovers'
import { Icon } from './icons'

// v1.171.0: «Мои любимые игры» / «Хочу поиграть» — как в Discord, одно окошко:
// список игр с поиском, клик добавляет или убирает (галочка = выбрана), сверху —
// чипы уже выбранных с крестиком. Не закрывается после каждого выбора — можно
// набрать и почистить список за один заход, до `max` игр.
export function WidgetGamesModal({ title, games, max, onToggle, onClose }:
  { title: string; games: string[]; max: number; onToggle: (name: string) => void; onClose: () => void }) {
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
    const gs = await fetchGameCatalog(q)
    setList(gs)
    for (const g of gs) if (!(g.name in covers)) resolveCover(g.name).then(u => setCovers(c => ({ ...c, [g.name]: u })))
  }

  useEffect(() => {
    for (const g of games) if (!(g in covers)) resolveCover(g).then(u => setCovers(c => ({ ...c, [g]: u })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.join('|')])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const qTrim = q.trim()
  const exact = qTrim && list?.some(g => g.name.toLowerCase() === qTrim.toLowerCase())
  const atMax = games.length >= max

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal gpick wgm" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">{title}</div>
        <div className="modal-sub">{games.length} / {max} — нажми на игру, чтобы добавить или убрать</div>
        {games.length > 0 && <div className="wgm-chips">
          {games.map(g => (
            <div key={g} className="wgm-chip" title="Убрать" onClick={() => onToggle(g)}>
              {covers[g] ? <img src={covers[g]!} alt="" /> : <span className="wgm-chip-ph"><Icon name="gamepad" size={13} /></span>}
              <span className="wgm-chip-nm">{g}</span>
              <Icon name="close" size={11} />
            </div>
          ))}
        </div>}
        <div className="modal-inline" style={{ marginTop: 14 }}>
          <Icon name="search" size={15} />
          <input ref={inRef} className="modal-in" placeholder="Поиск игры…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="gpick-list">
          {qTrim && !exact && !atMax && <div className="gpick-row" onClick={() => onToggle(qTrim)}>
            <span className="act-cover act-cover-sm act-cover-ph"><Icon name="plus" size={18} /></span>
            <div className="act-info"><div className="act-name">Добавить «{qTrim}»</div></div>
          </div>}
          {list === null
            ? <div className="modal-empty">Загрузка…</div>
            : list.length === 0 && !qTrim
              ? <div className="modal-empty">Пока никто не играл ни во что на этом сервере</div>
              : list.map(g => {
                const on = games.includes(g.name)
                return (
                  <div key={g.name} className={'gpick-row' + (on ? ' on' : '') + (!on && atMax ? ' disabled' : '')}
                    onClick={() => { if (on || !atMax) onToggle(g.name) }}>
                    {covers[g.name]
                      ? <img className="act-cover act-cover-sm" src={covers[g.name]!} alt="" />
                      : <span className="act-cover act-cover-sm act-cover-ph"><Icon name="gamepad" size={18} /></span>}
                    <div className="act-info">
                      <div className="act-name">{g.name}</div>
                      <div className="act-meta"><span>{g.players} {g.players === 1 ? 'игрок' : 'игроков'}</span></div>
                    </div>
                    {on && <span className="gpick-check"><Icon name="check" size={16} /></span>}
                  </div>
                )
              })}
        </div>
      </div>
    </div>
  )
}
