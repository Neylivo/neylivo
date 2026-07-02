
import { useEffect, useRef, useState } from 'react'

// A floating desktop-style pet that wanders along the bottom of the screen,
// reacts to clicks, and can be customized (species emoji + name). Config in localStorage.
const KEY = 'ponoi_pet_v1'
const SPECIES = ['🐱', '🐶', '🦊', '🐸', '🐧', '🐹', '🐢', '🦄', '🐉', '👾']
interface PetCfg { on: boolean; emoji: string; name: string }
function load(): PetCfg { try { return { on: true, emoji: '🐱', name: 'Поной', ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { on: true, emoji: '🐱', name: 'Поной' } } }
function save(c: PetCfg) { localStorage.setItem(KEY, JSON.stringify(c)) }

export function Pet() {
  const [cfg, setCfg] = useState<PetCfg>(load)
  const [x, setX] = useState(() => Math.random() * (window.innerWidth - 80))
  const [dir, setDir] = useState(1)
  const [say, setSay] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const dirRef = useRef(dir)
  dirRef.current = dir

  useEffect(() => { save(cfg) }, [cfg])

  useEffect(() => {
    if (!cfg.on) return
    const t = setInterval(() => {
      setX(prev => {
        let nx = prev + dirRef.current * 2
        if (nx < 0) { nx = 0; setDir(1) }
        else if (nx > window.innerWidth - 70) { nx = window.innerWidth - 70; setDir(-1) }
        else if (Math.random() < 0.01) setDir(d => -d)
        return nx
      })
    }, 50)
    return () => clearInterval(t)
  }, [cfg.on])

  const PHRASES = ['Привет! 👋', 'Мур-мур ❤️', 'Как дела?', 'Ponoi лучший!', '🎵 ля-ля-ля', 'Не скучай!', 'Обними меня 🤗']
  function poke() { setSay(PHRASES[Math.floor(Math.random() * PHRASES.length)]); setTimeout(() => setSay(null), 2500) }

  if (!cfg.on) return (
    <button className="pet-off" title="Показать питомца" onClick={() => setCfg({ ...cfg, on: true })}>🐾</button>
  )

  return (
    <>
      <div className="pet" style={{ left: x, transform: `scaleX(${dir})` }}
        onClick={poke} onContextMenu={e => { e.preventDefault(); setMenu(true) }} title={cfg.name + ' (правый клик — настройки)'}>
        {say && <div className="pet-bubble" style={{ transform: `scaleX(${dir})` }}>{say}</div>}
        <div className="pet-emoji">{cfg.emoji}</div>
      </div>
      {menu && <div className="pet-menu-overlay" onClick={() => setMenu(false)}>
        <div className="pet-menu" onClick={e => e.stopPropagation()}>
          <div className="pet-menu-h">Питомец</div>
          <input className="pqs-in" value={cfg.name} onChange={e => setCfg({ ...cfg, name: e.target.value })} placeholder="Имя" />
          <div className="pet-species">
            {SPECIES.map(s => (
              <button key={s} className={'pet-sp' + (cfg.emoji === s ? ' on' : '')} onClick={() => setCfg({ ...cfg, emoji: s })}>{s}</button>
            ))}
          </div>
          <button className="pqs-danger" onClick={() => { setCfg({ ...cfg, on: false }); setMenu(false) }}>Спрятать питомца</button>
        </div>
      </div>}
    </>
  )
}
