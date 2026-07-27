import { useEffect } from 'react'
import { Icon } from './icons'
import type { Channel, Server } from '../types'

// v1.317.0: «Путеводитель по серверу» — раньше пункт меню показывал заглушку.
//
// Смысл тот же, что у Server Guide в Discord: человек, впервые попавший на
// сервер, видит список из десятка каналов и не понимает, с чего начинать и куда
// вообще можно писать. Путеводитель — это короткая записка от владельца плюс
// несколько отмеченных каналов с пояснением, зачем каждый нужен.
//
// Собирается он в настройках сервера, вкладка «Вовлечённость». Если там ничего не
// заполнено, экран честно говорит об этом, а тем, кто может настроить, показывает
// куда идти, — вместо пустой красивой страницы, из которой непонятно, сломалось
// что-то или так и задумано.

export interface GuideItem { channelId: string; desc: string }
export interface ServerGuide { text?: string; items?: GuideItem[] }

export function ServerGuideModal({ server, channels, canEdit, onClose, onOpenChannel, onOpenSettings }: {
  server: Server
  channels: Channel[]
  canEdit: boolean
  onClose: () => void
  onOpenChannel?: (c: Channel) => void
  onOpenSettings?: () => void
}) {
  const guide: ServerGuide = (server as any).settings?.guide ?? {}
  const text = (guide.text ?? '').trim()
  // Каналы могли удалить уже после того, как их отметили в путеводителе, —
  // такие строки просто пропускаем, а не показываем ссылку в никуда.
  const items = (guide.items ?? [])
    .map(i => ({ item: i, ch: channels.find(c => c.id === i.channelId) }))
    .filter((x): x is { item: GuideItem; ch: Channel } => !!x.ch)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const empty = !text && items.length === 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal guide-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Путеводитель по серверу</div>
        <div className="modal-sub">С чего начать на «{server.name}»</div>

        {empty && <div className="guide-empty">
          <div className="guide-empty-ico"><Icon name="flag" size={30} /></div>
          <div>Путеводитель ещё не заполнен.</div>
          {canEdit
            ? <>
                <div className="chr-note" style={{ textAlign: 'center' }}>
                  Напиши пару слов новичкам и отметь каналы, с которых стоит начать, —
                  в настройках сервера, вкладка «Вовлечённость».
                </div>
                {onOpenSettings && <button className="modal-primary" style={{ marginTop: 12 }}
                  onClick={() => { onOpenSettings(); onClose() }}>Открыть настройки</button>}
              </>
            : <div className="chr-note" style={{ textAlign: 'center' }}>
                Его заполняет владелец сервера.
              </div>}
        </div>}

        {!empty && <div className="guide-body">
          {text && <div className="guide-text">{text}</div>}
          {items.length > 0 && <>
            <div className="chr-cat">С чего начать</div>
            {items.map(({ item, ch }) => (
              <div key={ch.id} className="guide-item"
                onClick={() => { if (onOpenChannel) { onOpenChannel(ch); onClose() } }}>
                <Icon name={ch.kind === 'voice' ? 'volume' : 'hash'} size={16} />
                <div className="guide-item-b">
                  <div className="chr-name">{ch.name}</div>
                  {item.desc && <div className="guide-item-d">{item.desc}</div>}
                </div>
                <Icon name="chevron-right" size={16} />
              </div>
            ))}
          </>}
        </div>}
      </div>
    </div>
  )
}
