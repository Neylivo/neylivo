import { Icon } from './icons'
import { toastOk } from '../lib/toast'
import { ALL_PERMISSIONS, PERMISSION_LABEL, SENSITIVE_PERMISSIONS } from '../lib/plugins/types'

// v1.333.0: «как написать свой плагин» — маленькая кнопка «?» рядом с меню
// плагинов. Раньше формат .ponoi-файла был описан только комментарием в исходниках
// (src/lib/plugins/manifest.ts): узнать его человек, не читающий наш код, не мог
// ниоткуда.
//
// Пример ниже — не выдумка: ровно он проверяется в npm run test:plugins вместе с
// официальными плагинами, поэтому инструкция не может разойтись с приложением
// незаметно.

const EXAMPLE = `/**
 * @name Мой первый плагин
 * @id my-first-plugin
 * @version 1.0.0
 * @author твой ник
 * @description Здоровается по команде /привет
 * @permissions commands, messages.write, notify
 */
function onLoad(ponoi) {
  ponoi.commands.register('привет', 'Поздороваться', async (arg) => {
    await ponoi.messages.send('Привет' + (arg ? ', ' + arg : '') + '!')
  })
  ponoi.notify('Плагин загрузился')
}`

export function PluginHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal help-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Как сделать свой плагин</div>

        <div className="help-p">
          Плагин — это один текстовый файл <code>.ponoi</code> (обычный JavaScript). В начале —
          шапка с полями, дальше функция <code>onLoad</code>, которой приложение передаёт объект{' '}
          <code>ponoi</code>. Через него плагин и делает всё, что умеет.
        </div>

        <label className="modal-lbl">Пример целиком</label>
        <pre className="help-code">{EXAMPLE}</pre>
        <button className="pqs2-btn ghost" onClick={() => { navigator.clipboard?.writeText(EXAMPLE); toastOk('Пример скопирован') }}>
          <Icon name="copy" size={15} /> Скопировать пример
        </button>

        <label className="modal-lbl">Поля шапки</label>
        <div className="help-tbl">
          <div><code>@id</code><span>Обязательно. Латиница, цифры и дефис. По нему плагин обновляется — у двух разных плагинов id совпадать не должны.</span></div>
          <div><code>@name</code><span>Обязательно. Как называется в списке.</span></div>
          <div><code>@version</code><span>Обязательно. Например 1.0.0 — по нему видно, что обновление новее.</span></div>
          <div><code>@author</code><span>Твоё имя.</span></div>
          <div><code>@description</code><span>Одна-две строки о том, что он делает.</span></div>
          <div><code>@permissions</code><span>Через запятую — что плагину нужно. Всё, чего нет в списке, ему откажут.</span></div>
          <div><code>@hosts</code><span>Домены для разрешения <code>net</code>. Без них сеть не работает, к другим сайтам плагин не пустят.</span></div>
        </div>

        <label className="modal-lbl">Что можно попросить</label>
        {ALL_PERMISSIONS.map(p => (
          <div key={p} className={'plug-perm' + (SENSITIVE_PERMISSIONS.includes(p) ? ' warn' : '')}>
            <Icon name={SENSITIVE_PERMISSIONS.includes(p) ? 'shield' : 'check'} size={15} />
            <span><code>{p}</code> — {PERMISSION_LABEL[p]}</span>
          </div>
        ))}

        <label className="modal-lbl">Что даёт объект ponoi</label>
        <div className="help-tbl">
          <div><code>ponoi.commands.register(имя, описание, обработчик)</code><span>Своя команда в чате. Обработчик получает строкой всё, что человек написал после команды.</span></div>
          <div><code>ponoi.messages.send(текст)</code><span>Отправить сообщение в открытый канал от имени человека.</span></div>
          <div><code>ponoi.on('message', обработчик)</code><span>Новое сообщение в открытом канале: <code>id</code>, <code>author</code>, <code>authorName</code>, <code>content</code>, <code>mine</code>, <code>mentionsMe</code>.</span></div>
          <div><code>ponoi.notify(текст)</code><span>Всплывающее уведомление внутри приложения.</span></div>
          <div><code>ponoi.storage.get / set / remove</code><span>Своё хранилище на этом устройстве.</span></div>
          <div><code>ponoi.ui.addComposerButton / addMessageAction</code><span>Своя кнопка у поля ввода и свой пункт в меню сообщения.</span></div>
          <div><code>ponoi.ui.addSettingsPage({'{'} title, rows {'}'})</code><span>Своя страница настроек: строки типов <code>toggle</code>, <code>text</code>, <code>select</code>, <code>button</code>. Изменения приходят событием <code>settings</code>.</span></div>
          <div><code>ponoi.css(текст)</code><span>Свои стили поверх приложения.</span></div>
          <div><code>ponoi.net.fetch(url, init)</code><span>Запрос к сайту из <code>@hosts</code>. Только https, только GET и POST, без куки.</span></div>
          <div><code>ponoi.voice.list / current / setEffect</code><span>Эффект твоего голоса в звонке. Сам звук плагину недоступен — обработка целиком в приложении.</span></div>
        </div>

        <label className="modal-lbl">Как проверить</label>
        <div className="help-p">
          Сохрани файл с расширением <code>.ponoi</code> и поставь его кнопкой «Установить из файла».
          Если плагин не запустится, причина будет написана прямо на его карточке — красной строкой.
          Дальше можно выложить его в каталог, чтобы поставили другие.
        </div>

        <div className="help-p mut">
          Плагин выполняется в песочнице (Web Worker): у него нет доступа ни к твоей сессии, ни к
          файлам, ни к странице приложения — только то, что ты разрешил в <code>@permissions</code>.
          Поэтому чужой плагин не может увести аккаунт, даже если написан ровно для этого.
        </div>

        <div className="modal-foot">
          <button className="modal-primary" onClick={onClose}>Понятно</button>
        </div>
      </div>
    </div>
  )
}
