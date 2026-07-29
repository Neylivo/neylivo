import { useEffect } from 'react'
import { useSettings } from '../lib/settings'
import { useHotkeys } from '../lib/plugins/registry'

// Окно-шпаргалка горячих клавиш (Ctrl+/), как в Discord.
// Настраиваемые комбо подтягиваются из настроек.

export function HotkeysModal({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // v1.358.0: окно перестало быть правдой — половина того, что приложение
  // умеет, тут не значилась вовсе, и узнать об этом было неоткуда. Список
  // пополняется вместе с самими клавишами, иначе шпаргалка врёт умолчанием.
  const rows: Array<[string, string]> = [
    ['Ctrl + K', 'Быстрый переход (серверы, ЛС, музыка)'],
    ['Ctrl + F', 'Поиск по сообщениям канала'],
    ['Ctrl + /', 'Это окно — список горячих клавиш'],
    ['Alt + ↑', 'Предыдущий канал'],
    ['Alt + ↓', 'Следующий канал'],
    ['↑', 'Редактировать своё последнее сообщение'],
    ['Esc', 'Закрыть окно / отменить ответ или правку'],
    ['Enter', 'Отправить сообщение'],
    ['Shift + Enter', 'Новая строка в сообщении'],
    ['Двойной щелчок', 'Ответить на сообщение'],
    ['Shift + удалить', 'Удалить сообщение без подтверждения'],
    [': + буквы', 'Подсказка эмодзи прямо в поле ввода'],
    ['@ + буквы', 'Упомянуть участника или роль'],
    ['/ + буквы', 'Команда бота или плагина'],
  ]
  if (settings.keyHome) rows.push([settings.keyHome, 'Перейти в личные сообщения'])
  if (settings.keyMusic) rows.push([settings.keyMusic, 'Открыть Ponoi Music'])
  // v1.419.0: клавиши, которые завели плагины. Без этой строки шпаргалка снова
  // врала бы умолчанием: сочетание работает, а откуда оно взялось — неизвестно.
  // Помечаем, чей это плагин: это не клавиша Ponoi, и убирается она вместе с ним.
  const plugKeys = useHotkeys()

  // v1.389.0: было modal-back — класса с таким именем в стилях нет вовсе, и окно
  // выпадало в общий поток: без затемнения, без середины экрана, поверх списка
  // сообщений. Все остальные окна приложения закрываются modal-overlay.
  return (
    <div className="modal-overlay" onClick={onClose}>
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
        {plugKeys.length > 0 && <>
          <h3 style={{ marginTop: 14 }}>От плагинов</h3>
          <div className="hk-list">
            {plugKeys.map(h => (
              <div key={h.pluginId + h.combo} className="hk-row">
                <span className="hk-what">{h.description} <span className="plugpanel-tag">плагин</span></span>
                <span className="hk-keys">{h.combo.split('+').map((k, i, a) => (
                  <span key={i}><kbd>{k}</kbd>{i < a.length - 1 ? ' + ' : ''}</span>
                ))}</span>
              </div>
            ))}
          </div>
        </>}
        <div className="hk-hint">Комбо «ЛС» и «Музыка» настраиваются в Настройках</div>
      </div>
    </div>
  )
}
