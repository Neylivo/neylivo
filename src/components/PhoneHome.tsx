import { Icon } from './icons'
import type { Server } from '../types'

// v1.546.0: «Главная» на телефоне — список серверов экраном.
//
// Владелец прислал макет: на телефоне слева стоит рейка разделов (Главная,
// Друзья, Открыть, Трекотека, Приложения), а не значки серверов. Значки при
// этом деваться никуда не должны — иначе на телефоне пропадёт доступ к
// серверам. Они переезжают сюда, в «Главную», и становятся списком: на узком
// экране список читается лучше столбика кружков, потому что рядом с картинкой
// помещается название.
export function PhoneHome({ servers, onOpen, onCreate, onFind }: {
  servers: Server[]
  onOpen: (s: Server) => void
  onCreate: () => void
  onFind: () => void
}) {
  return (
    <main className="chat ph-home">
      <header className="chat-head ph-head">
        <span className="pfr-title">Главная</span>
        <button className="pfr-addfriend" title="Создать сервер" onClick={onCreate}>
          <Icon name="plus" size={18} />
        </button>
      </header>
      <div className="ph-body">
        <div className="ph-sec">СЕРВЕРЫ</div>
        {servers.length === 0 && <div className="ph-empty">
          Пока ни одного сервера. Создай свой или найди чужой — обе кнопки ниже.
        </div>}
        <div className="ph-list">
          {servers.map(s => (
            <button key={s.id} className="ph-row" onClick={() => onOpen(s)}>
              <span className="ph-av" style={s.avatar_url
                ? { backgroundImage: `url(${s.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : undefined}>{s.avatar_url ? '' : s.name.slice(0, 2).toUpperCase()}</span>
              <span className="ph-meta">
                <span className="ph-nm">{s.name}</span>
                <span className="ph-sub">Сервер</span>
              </span>
              <Icon name="chevron-right" size={18} />
            </button>
          ))}
        </div>
        <div className="ph-acts">
          <button className="pqs2-btn primary" onClick={onCreate}><Icon name="plus" size={15} /> Создать сервер</button>
          <button className="pqs2-btn" onClick={onFind}><Icon name="compass" size={15} /> Найти сервер</button>
        </div>
      </div>
    </main>
  )
}
