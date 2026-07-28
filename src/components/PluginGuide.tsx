import { useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { copyText } from '../lib/copyMedia'
import { ALL_PERMISSIONS, PERMISSION_LABEL, SENSITIVE_PERMISSIONS } from '../lib/plugins/types'
import { PLUGIN_SPEC, AI_PROMPT_PREFIX } from '../lib/plugins/spec'

// v1.360.0: большое окно «как сделать плагин».
//
// Прежняя справка была одним свитком в обычном модальном окне: половина текста
// за краем, разделов нет, найти нужное можно было только прокруткой. И главное —
// её нельзя было использовать по назначению, ради которого её чаще всего и
// открывают: отдать описание ИИ и получить готовый плагин. Для этого описание
// должно быть полным и копироваться одним нажатием, а не выковыриваться из
// разметки кусками.
//
// Сам текст живёт в lib/plugins/spec.ts и проверяется тестом на полноту —
// в нём обязаны быть все разрешения и все методы, какие понимает приложение.

type Tab = 'start' | 'ai' | 'api' | 'perms' | 'rules'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'start', label: 'С чего начать', icon: 'star' },
  { id: 'ai', label: 'Сделать через ИИ', icon: 'star' },
  { id: 'api', label: 'Что умеет плагин', icon: 'code' },
  { id: 'perms', label: 'Разрешения', icon: 'shield' },
  { id: 'rules', label: 'Правила и пределы', icon: 'list' },
]

const FIRST = `/**
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

// v1.363.0: копируем тем же способом, что и всё остальное приложение.
//
// Здесь стоял голый navigator.clipboard — в окне Electron он молча отказывает, и
// кнопка «Скопировать инструкцию для ИИ» не делала ничего, кроме сообщения об
// ошибке. У приложения давно есть copyText с тремя запасными путями: буфер
// самого Electron, Clipboard API и старый execCommand.
const copy = (text: string, ok: string) => { void copyText(text, ok) }

export function PluginGuide({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('start')

  return (
    <Portal>
      <div className="pg-screen">
        <div className="pg-head">
          <div className="pg-title"><Icon name="code" size={20} /> Как сделать плагин</div>
          <button className="pg-x" onClick={onClose} title="Закрыть"><Icon name="close" size={18} /></button>
        </div>

        <div className="pg-body">
          <nav className="pg-nav">
            {TABS.map(t => (
              <button key={t.id} className={'pg-navbtn' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={16} /> {t.label}
              </button>
            ))}
          </nav>

          <div className="pg-main"><div className="pg-inner">
            {tab === 'start' && <>
              <h3>Плагин — это один файл</h3>
              <p>
                Текстовый файл с расширением <code>.ponoi</code>, внутри обычный JavaScript.
                В начале — шапка с полями, дальше функция <code>onLoad</code>, которой
                приложение передаёт объект <code>ponoi</code>. Через него плагин и делает всё,
                что умеет.
              </p>
              <p className="pg-note">
                Писать код руками необязательно. В конструкторе есть режим «Простой» —
                там плагин собирается из готовых кусочков без единой строчки кода.
                А если хочется чего-то своего — соседняя вкладка про ИИ.
              </p>

              <h3>Пример, с которого можно начать</h3>
              <pre className="pg-code">{FIRST}</pre>
              <button className="pqs2-btn" onClick={() => copy(FIRST, 'Пример скопирован')}>
                <Icon name="copy" size={15} /> Скопировать пример
              </button>

              <h3>Куда его девать</h3>
              <ol className="pg-steps">
                <li>Настройки → Другое → Плагины → «Создать плагин».</li>
                <li>Режим «Код», вставить файл целиком.</li>
                <li>«Сохранить» — плагин появится в списке и сразу заработает.</li>
              </ol>
            </>}

            {tab === 'ai' && <>
              <h3>Пусть плагин напишет ИИ</h3>
              <p>
                Кода можно не знать вовсе. Ниже — полное описание формата: что бывает
                в шапке, что умеет объект <code>ponoi</code>, какие есть разрешения и
                пределы. Скопируй его, отправь любому ИИ и допиши своими словами, чего
                ты хочешь. В ответ придёт готовый файл — его останется вставить в
                конструктор.
              </p>

              <div className="pg-aibox">
                <div className="pg-aihead"><Icon name="star" size={16} /> Что скопируется</div>
                <div className="pg-aitxt">
                  Просьба к ИИ + описание формата целиком ({Math.round(PLUGIN_SPEC.length / 1024)} КБ).
                  В просьбе оставлено место, куда вписать свою задумку — ищи квадратные скобки.
                </div>
                <button className="pqs2-btn pg-aibtn"
                  onClick={() => copy(AI_PROMPT_PREFIX + PLUGIN_SPEC, 'Инструкция скопирована — вставляй в чат с ИИ')}>
                  <Icon name="copy" size={15} /> Скопировать инструкцию для ИИ
                </button>
                <button className="pqs2-btn ghost"
                  onClick={() => copy(PLUGIN_SPEC, 'Описание формата скопировано')}>
                  Только описание, без просьбы
                </button>
              </div>

              <h3>Что попросить</h3>
              <ul className="pg-list">
                <li>«Плагин, который по команде /погода берёт погоду с api.open-meteo.com и пишет её в чат»</li>
                <li>«Плагин, который добавляет кнопку рядом с полем ввода и вставляет случайную цитату»</li>
                <li>«Плагин, который считает, сколько сообщений я отправил, и показывает это в своих настройках»</li>
              </ul>
              <p className="pg-note">
                Если готовый плагин не сохраняется — конструктор напишет, что именно не так,
                и это можно отдать ИИ тем же текстом: «вот ошибка, поправь».
              </p>
            </>}

            {tab === 'api' && <>
              <h3>Что умеет объект ponoi</h3>
              <p>
                Полный список — в описании на соседней вкладке. Здесь коротко, чтобы
                прикинуть, из чего вообще можно собрать плагин.
              </p>
              <div className="pg-tbl">
                <div><code>ponoi.commands.register</code><span>Своя команда в чате: <code>/имя</code></span></div>
                <div><code>ponoi.messages.send</code><span>Отправить сообщение в открытый канал</span></div>
                <div><code>ponoi.on('message', …)</code><span>Узнавать о новых сообщениях</span></div>
                <div><code>ponoi.ui.addComposerButton</code><span>Своя кнопка рядом с полем ввода</span></div>
                <div><code>ponoi.ui.addMessageAction</code><span>Свой пункт в меню сообщения</span></div>
                <div><code>ponoi.ui.addSettingsPage</code><span>Своя страница настроек с переключателями</span></div>
                <div><code>ponoi.ui.confirm / prompt</code><span>Спросить у человека «да/нет» или строку</span></div>
                <div><code>ponoi.storage.*</code><span>Своё хранилище: get, set, remove, keys</span></div>
                <div><code>ponoi.me / ponoi.channel</code><span>Кто ты и какой канал открыт</span></div>
                <div><code>ponoi.notify</code><span>Всплывающее уведомление</span></div>
                <div><code>ponoi.clipboard.write</code><span>Положить текст в буфер обмена</span></div>
                <div><code>ponoi.css</code><span>Свои стили оформления</span></div>
                <div><code>ponoi.net.fetch</code><span>Запрос в интернет, только на домены из <code>@hosts</code></span></div>
                <div><code>ponoi.voice.*</code><span>Эффект своего голоса в звонке</span></div>
                <div><code>ponoi.log</code><span>Отладочная запись, видна в настройках плагина</span></div>
              </div>
            </>}

            {tab === 'perms' && <>
              <h3>Разрешения</h3>
              <p>
                Всё, чего нет в <code>@permissions</code>, плагину запрещено — вызов не
                промолчит, а бросит ошибку. Перечисляй ровно то, что используешь: лишнее
                человек видит при установке, и лишнее его отпугнёт.
              </p>
              <div className="pg-tbl">
                {ALL_PERMISSIONS.map(p => (
                  <div key={p}>
                    <code>{p}</code>
                    <span>
                      {PERMISSION_LABEL[p]}
                      {SENSITIVE_PERMISSIONS.includes(p) &&
                        <span className="pg-warn"><Icon name="shield" size={12} /> спрашивается отдельно</span>}
                    </span>
                  </div>
                ))}
              </div>
              <p className="pg-note">
                Отмеченные разрешения приложение показывает человеку крупно и требует
                отдельного согласия — их дают не глядя реже всего.
              </p>
            </>}

            {tab === 'rules' && <>
              <h3>Чего в плагине нет</h3>
              <p>
                Плагин работает в отдельном потоке, без доступа к странице. Ему недоступны{' '}
                <code>window</code>, <code>document</code>, DOM, <code>localStorage</code>,
                cookie, обычный <code>fetch</code>, <code>eval</code>, другие плагины, база
                данных Ponoi и токен твоей сессии. Всё общение с приложением — только через
                объект <code>ponoi</code>.
              </p>
              <p className="pg-note">
                Это не придирка: плагин ставят чужой, и он не должен уметь ни прочитать
                переписку молча, ни выдать себя за окно приложения.{' '}
                <code>setTimeout</code> и <code>setInterval</code> при этом работают.
              </p>

              <h3>Пределы</h3>
              <div className="pg-tbl">
                <div><code>5 / 10 с</code><span>Отправка сообщений</span></div>
                <div><code>10 / 10 с</code><span>Уведомления</span></div>
                <div><code>20 / 10 с</code><span>Запросы в интернет, ответ до 1 МБ, ожидание 10 с</span></div>
                <div><code>5 / 10 с</code><span>Вопросы человеку (confirm, prompt)</span></div>
                <div><code>5</code><span>Кнопок у поля ввода</span></div>
                <div><code>5</code><span>Пунктов в меню сообщения</span></div>
                <div><code>15</code><span>Своих команд</span></div>
                <div><code>64 КБ</code><span>Одно значение в хранилище</span></div>
              </div>

              <h3>Частые ошибки</h3>
              <ul className="pg-list">
                <li><code>export function onLoad</code> — не сработает, нужна обычная <code>function onLoad</code>.</li>
                <li>Забытое разрешение: код верный, а вызов падает. Конструктор подсказывает, чего не хватает.</li>
                <li>Сеть без <code>@hosts</code>: домен обязан быть перечислен в шапке.</li>
                <li>Одинаковый <code>@id</code> у двух плагинов: второй заменит первый.</li>
              </ul>
            </>}
          </div></div>
        </div>
      </div>
    </Portal>
  )
}
