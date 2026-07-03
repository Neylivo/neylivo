import { useEffect } from 'react'
import { useSettings } from '../lib/settings'

// Окно-шпаргалка горячих клавиш (Ctrl+/), как в Discord.
// Настраиваемые комбо подтягиваются из настроек.

export function HotkeysModal({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: Array<[string, string]> = [
    ['Ctrl + K', 'Быстрый переход (серверы, ЛС, музыка)'],
    ['Ctrl + /', 'Это окно — список горячих клавиш'],
    ['↑', 'Редактировать своё последнее сообщение'],
    ['Esc', 'Закрыть окно / отменить редактирование'],
    ['Enter', 'Отправить сообщение'],
    ['Shift + Enter', 'Новая строка в сообщении'],
  ]
  if (settings.keyHome) rows.push([settings.keyHome, 'Перейти в личные сообщения'])
  if (settings.keyMusic) rows.push([settings.keyMusic, 'Открыть Ponoi Music'])

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal hk-modal" onClick={e => e.stopPropagation()}>
        <h3>Горячие клавиши</h3>
        <div className="hk-list">
          {rows.map(([combo, what]) => (
            <div key={combo + what} className="hk-row">
              <span className="hk-what">{what}</span>
              <span className="hk-keys">{combo.split(/\s*\+\s*/).map((k, i) => (
                <span key={i}><kbd>{k}</kbd>{i < combo.split('+').length - 1 ? ' + ' : ''}</span>
              ))}</span>
            </div>
          ))}
        </div>
        <div className="hk-hint">Комбо «ЛС» и «Музыка» настраиваются в Настройках</div>
      </div>
    </div>
  )
}
