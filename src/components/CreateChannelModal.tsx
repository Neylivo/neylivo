// Модалка «Создать канал» — 1-в-1 как в Discord (v1.24.0).
// Типы: Текст / Голос / Форум (форум пока в разработке), название с # и toggle «Приватный канал».
import { useState } from 'react'
import { toastOk } from '../lib/toast'
import { Icon } from './icons'

export function CreateChannelModal({ initialKind, onClose, onCreate }: {
  initialKind: 'text' | 'voice'
  onClose: () => void
  onCreate: (name: string, kind: 'text' | 'voice', priv: boolean) => void
}) {
  const [kind, setKind] = useState<'text' | 'voice'>(initialKind)
  const [name, setName] = useState('')
  const [priv, setPriv] = useState(false)
  function submit() {
    const nm = kind === 'text' ? name.trim().toLowerCase().replace(/\s+/g, '-') : name.trim()
    if (nm) onCreate(nm, kind, priv)
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title" style={{ textAlign: 'left' }}>Создать канал</div>
        <div className="modal-sub" style={{ textAlign: 'left' }}>в {kind === 'voice' ? 'Голосовые каналы' : 'Текстовые каналы'}</div>
        <label className="modal-lbl">Тип канала</label>
        <button className={'cch-type' + (kind === 'text' ? ' on' : '')} onClick={() => setKind('text')}>
          <span className="dot" /><Icon name="hash" size={20} />
          <span className="cch-t"><b>Текст</b><span>Отправляйте сообщения, изображения, GIF, эмодзи, мнения и приколы</span></span>
        </button>
        <button className={'cch-type' + (kind === 'voice' ? ' on' : '')} onClick={() => setKind('voice')}>
          <span className="dot" /><Icon name="volume" size={20} />
          <span className="cch-t"><b>Голос</b><span>Общайтесь голосом или в видеочате и пользуйтесь функцией показа экрана</span></span>
        </button>
        <button className="cch-type dis" onClick={() => toastOk('Форумы скоро появятся')}>
          <span className="dot" /><Icon name="message" size={20} />
          <span className="cch-t"><b>Форум</b><span>Создайте площадку для обсуждений</span></span>
        </button>
        <label className="modal-lbl">Название канала</label>
        <div className="cch-name">
          <Icon name={kind === 'voice' ? 'volume' : 'hash'} size={16} />
          <input autoFocus placeholder="новый-канал" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        </div>
        <div className="cch-priv"><span>🔒</span> Приватный канал<button className={'tgl' + (priv ? ' on' : '')} onClick={() => setPriv(!priv)} /></div>
        <div className="cset-hint">Только выбранные участники и участники с выбранными ролями смогут просматривать этот канал.</div>
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Отмена</button>
          <button className="modal-primary" disabled={!name.trim()} onClick={submit}>Создать канал</button>
        </div>
      </div>
    </div>
  )
}