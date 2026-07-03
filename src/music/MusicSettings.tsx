import { useEffect, useState } from 'react'
import type { GifCfg, BgCfg, GifPos } from './types'
import { GIF_KEY, BG_KEY, BG_IDB_KEY } from './types'
import { idbSet, idbDel } from '../lib/idb'
import { videoDuration } from './videoDuration'
import { Icon } from '../components/icons'

export function loadGif(): GifCfg { try { return JSON.parse(localStorage.getItem(GIF_KEY) || '') } catch { return { url: '', pos: 'both' } } }
export function loadBg(): BgCfg { try { return JSON.parse(localStorage.getItem(BG_KEY) || '') } catch { return { type: 'none', mode: 'url', url: '', dim: 40, ver: 0 } } }

export function MusicSettings({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const [gif, setGif] = useState<GifCfg>(loadGif())
  const [bg, setBg] = useState<BgCfg>(loadBg())
  const [msg, setMsg] = useState('')

  useEffect(() => { localStorage.setItem(GIF_KEY, JSON.stringify(gif)); onChange() }, [gif])
  useEffect(() => { localStorage.setItem(BG_KEY, JSON.stringify(bg)); onChange() }, [bg])

  async function pickBgFile(e: React.ChangeEvent<HTMLInputElement>, type: 'photo' | 'video') {
    const f = e.target.files?.[0]; if (!f) return
    if (type === 'video') {
      try { const d = await videoDuration(f); if (d > 15) { setMsg(`Видео ${d.toFixed(1)}с — дольше 15с нельзя`); return } }
      catch { setMsg('Не удалось прочитать видео'); return }
    }
    await idbSet(BG_IDB_KEY, f)
    setBg({ ...bg, type, mode: 'file', url: '', ver: bg.ver + 1 }); setMsg('Сохранено ✓')
  }

  async function clearBg() { await idbDel(BG_IDB_KEY); setBg({ type: 'none', mode: 'url', url: '', dim: bg.dim, ver: bg.ver + 1 }) }

  return (
    <div className="ms-overlay" onClick={onClose}>
      <div className="ms-modal" onClick={e => e.stopPropagation()}>
        <div className="ms-head"><b>Настройки Ponoi Music</b><button onClick={onClose}><Icon name="close" size={16} /></button></div>

        <div className="ms-sec"><Icon name="film" size={15} /> Гифки по бокам</div>
        <input className="ms-in" placeholder="URL гифки" value={gif.url} onChange={e => setGif({ ...gif, url: e.target.value })} />
        <div className="ms-row">
          {(['left', 'right', 'both'] as GifPos[]).map(p => (
            <button key={p} className={'ms-chip' + (gif.pos === p ? ' on' : '')} onClick={() => setGif({ ...gif, pos: p })}>
              {p === 'left' ? 'Слева' : p === 'right' ? 'Справа' : 'С обеих'}</button>
          ))}
        </div>
        {gif.url && <img className="ms-prev" src={gif.url} alt="gif" />}

        <div className="ms-sec"><Icon name="image" size={15} /> Фон плеера</div>
        <div className="ms-row">
          <button className={'ms-chip' + (bg.type === 'none' ? ' on' : '')} onClick={() => setBg({ ...bg, type: 'none' })}>Нет</button>
          <button className={'ms-chip' + (bg.type === 'photo' ? ' on' : '')} onClick={() => setBg({ ...bg, type: 'photo' })}>Фото</button>
          <button className={'ms-chip' + (bg.type === 'video' ? ' on' : '')} onClick={() => setBg({ ...bg, type: 'video' })}>Видео ≤15с</button>
        </div>
        {bg.type !== 'none' && <>
          <div className="ms-row">
            <button className={'ms-chip' + (bg.mode === 'url' ? ' on' : '')} onClick={() => setBg({ ...bg, mode: 'url' })}>По ссылке</button>
            <label className={'ms-chip' + (bg.mode === 'file' ? ' on' : '')}>
              Загрузить файл
              <input type="file" hidden accept={bg.type === 'video' ? 'video/*' : 'image/*'} onChange={e => pickBgFile(e, bg.type as 'photo' | 'video')} />
            </label>
          </div>
          {bg.mode === 'url' && <input className="ms-in" placeholder={'URL ' + (bg.type === 'video' ? 'видео' : 'фото')}
            value={bg.url} onChange={e => setBg({ ...bg, url: e.target.value, ver: bg.ver + 1 })} />}
          <div className="ms-dim">Затемнение: {bg.dim}%
            <input type="range" min={0} max={80} value={bg.dim} onChange={e => setBg({ ...bg, dim: +e.target.value })} />
          </div>
          <button className="ms-clear" onClick={clearBg}>Убрать фон</button>
        </>}
        {msg && <div className="ms-msg">{msg}</div>}
      </div>
    </div>
  )
}
