import { useState } from 'react'
import { Icon } from './icons'
import { loadFolders, moveToFolder, folderOf } from '../lib/folders'
import type { Server } from '../types'

const COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c']

// Модалка «Переместить в папку»: выбрать существующую, создать новую или убрать.
export function FolderModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const folders = loadFolders()
  const cur = folderOf(folders, server.id)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])

  function go(folderId: string | null) {
    moveToFolder(server.id, folderId, name.trim() || 'Папка', color)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Папка для «{server.name}»</div>
        {folders.length > 0 && <>
          <div className="modal-sect">Существующие папки</div>
          <div className="fold-list">
            {folders.map(f => (
              <div key={f.id} className={'fold-row' + (cur?.id === f.id ? ' on' : '')} onClick={() => go(f.id)}>
                <span className="fold-dot" style={{ background: f.color }}><Icon name="folder" size={13} /></span>
                {f.name} <span className="fold-n">{f.servers.length}</span>
              </div>
            ))}
          </div>
        </>}
        <div className="modal-sect">Новая папка</div>
        <div className="modal-inline">
          <input className="modal-in" placeholder="Название папки" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') go('new') }} />
          <button className="modal-primary" onClick={() => go('new')}>Создать</button>
        </div>
        <div className="fold-colors">
          {COLORS.map(c => (
            <button key={c} className={'fold-color' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        {cur && <div className="modal-foot">
          <button className="modal-ghost" onClick={() => go(null)}>Убрать из папки «{cur.name}»</button>
        </div>}
      </div>
    </div>
  )
}
