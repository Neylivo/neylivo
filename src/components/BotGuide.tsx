import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { copyText } from '../lib/copyMedia'
import { BOT_SPEC, AI_BOT_PROMPT_PREFIX } from '../lib/plugins/spec'

// v1.365.0: большое окно «как сделать бота».
//
// Прежняя справка была одним свитком в обычном модальном окне: текста на
// несколько страниц, окно ограничено высотой экрана, и всё, что ниже, просто
// обрезалось — «Частые ошибки» и «Чего боту нельзя» человек не видел никогда.
// Разделы те же, что у плагинов, и оформление общее: два разных окна про одно
// и то же дело расходились бы со временем.

type Tab = 'start' | 'ai' | 'steps' | 'events' | 'errors'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'start', label: 'С чего начать', icon: 'star' },
  { id: 'ai', label: 'Сделать через ИИ', icon: 'star' },
  { id: 'steps', label: 'По шагам', icon: 'list' },
  { id: 'events', label: 'События и API', icon: 'code' },
  { id: 'errors', label: 'Ошибки и пределы', icon: 'shield' },
]

const EXAMPLE = `// Простейший бот на любом языке. Ниже — Node.js.
// 1) Заведи бота в «Настройки → Боты → Мои боты», скопируй ID и токен.
// 2) Подними это на своём https-адресе и впиши его в поле Webhook URL.
import crypto from 'node:crypto'
import express from 'express'

const SECRET = process.env.NEYLIVO_WEBHOOK_SECRET   // выдаётся при создании бота
const app = express()

app.post('/neylivo', express.text({ type: '*/*' }), (req, res) => {
  // Подпись обязательна: без неё кто угодно пришлёт боту что угодно.
  const mine = crypto.createHmac('sha256', SECRET).update(req.body).digest('hex')
  if (mine !== req.get('X-NeyLivo-Signature')) return res.sendStatus(401)

  const event = JSON.parse(req.body)
  if (event.type === 'INTERACTION_CREATE' && event.command === 'привет') {
    // Ответ на слэш-команду — синхронно, полем content.
    return res.json({ content: 'Привет, ' + (event.args.text || 'мир') + '!' })
  }
  res.json({})
})

app.listen(3000)`

export function BotGuide({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('start')
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <Portal>
      {/* v1.368.0: окно, а не весь экран. Разделы и прокрутка остались, но приложение
          видно вокруг — справку открывают, чтобы свериться, не бросая начатое.
          Щелчок мимо и Esc закрывают, как у остальных окон. */}
      <div className="pg-screen" onClick={onClose}>
        <div className="pg-win" onClick={e => e.stopPropagation()}>
        <div className="pg-head">
          <div className="pg-title"><Icon name="code" size={20} /> Как сделать бота</div>
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
              <h3>Бот — обычный участник сервера</h3>
              <p>
                У него настоящая учётная запись: те же права, те же каналы и те же
                запреты, что у людей. Закрытый канал он не увидит, в канал только для
                чтения не напишет.
              </p>

              <h3>Три вида — выбери по силам</h3>
              <div className="pg-tbl">
                <div><code>готовый</code><span>
                  Кубик, опросы, статистика, встречающий, шар предсказаний. Берётся из
                  каталога одной кнопкой, работает сразу. Ничего писать и нигде
                  размещать не надо.
                </span></div>
                <div><code>без кода</code><span>
                  Ты пишешь: команда — и что на неё отвечать. Например <code>/правила</code> →
                  текст правил. Выполняется внутри NeyLivo, свой сервер не нужен. В ответе
                  можно написать <code>{'{текст}'}</code> — туда подставится то, что человек
                  допишет после команды.
                </span></div>
                <div><code>с программой</code><span>
                  Полная свобода: твоя программа получает события и отвечает что угодно.
                  Нужен https-адрес, где она будет жить, — свой сервер или хостинг.
                </span></div>
              </div>
              <p className="pg-note">
                Всё, что ниже, — только про третий вид. Первые два настраиваются целиком
                в приложении, читать про них нечего.
              </p>
            </>}

            {tab === 'ai' && <>
              <h3>Пусть бота напишет ИИ</h3>
              <p>
                Кода можно не знать. Скопируй полное описание того, как устроены боты
                NeyLivo, отдай любому ИИ и допиши своими словами, чего хочешь. В ответ
                придёт готовый код — уже с проверкой подписи.
              </p>

              <div className="pg-aibox">
                <div className="pg-aihead"><Icon name="star" size={16} /> Что скопируется</div>
                <div className="pg-aitxt">
                  Просьба к ИИ + описание целиком ({Math.round(BOT_SPEC.length / 1024)} КБ):
                  вебхук, формат событий, проверка подписи, адреса API, пределы и правила.
                  В просьбе оставлено место для твоей задумки — ищи квадратные скобки.
                </div>
                <button className="pqs2-btn"
                  onClick={() => void copyText(AI_BOT_PROMPT_PREFIX + BOT_SPEC, 'Инструкция скопирована — вставляй в чат с ИИ')}>
                  <Icon name="copy" size={15} /> Скопировать инструкцию для ИИ
                </button>
                <button className="pqs2-btn ghost"
                  onClick={() => void copyText(BOT_SPEC, 'Описание скопировано')}>
                  Только описание, без просьбы
                </button>
              </div>

              <h3>Что попросить</h3>
              <ul className="pg-list">
                <li>«Бот, который по команде /погода отдаёт погоду в городе из довода»</li>
                <li>«Бот, который на каждое сообщение со словом “баг” отвечает ссылкой на трекер»</li>
                <li>«Бот, который по /напомни 10 минут купить хлеб пишет напоминание в канал»</li>
              </ul>
              <p className="pg-note">
                Не заработало — отдай ИИ ошибку тем же текстом: «вот что отвечает NeyLivo,
                поправь». Список частых ошибок — на соседней вкладке.
              </p>
            </>}

            {tab === 'steps' && <>
              <h3>По шагам</h3>
              <div className="pg-tbl">
                <div><code>1</code><span>«Настройки → Боты → Мои боты» → создать. Токен и секрет показываются <b>один раз</b> — сохрани их сразу, второй раз их не покажет никто.</span></div>
                <div><code>2</code><span>Подними свой сервис на адресе <code>https://…</code> и впиши его в поле Webhook URL. Адреса вида localhost и внутренние сети не примут — через них можно было бы прощупывать чужую сеть.</span></div>
                <div><code>3</code><span>Заведи слэш-команды: имя и описание. Они появятся в подсказках, когда человек начнёт печатать «/».</span></div>
                <div><code>4</code><span>Отдай ID приложения владельцу сервера — или выложи бота в каталог, чтобы его нашли сами.</span></div>
              </div>

              <h3>Пример целиком</h3>
              <pre className="pg-code">{EXAMPLE}</pre>
              <button className="pqs2-btn ghost" onClick={() => void copyText(EXAMPLE, 'Пример скопирован')}>
                <Icon name="copy" size={15} /> Скопировать пример
              </button>
            </>}

            {tab === 'events' && <>
              <h3>Что приходит на вебхук</h3>
              <div className="pg-tbl">
                <div><code>INTERACTION_CREATE</code><span>Человек вызвал твою команду. Поля: <code>command</code>, <code>args</code>, <code>channelId</code>, <code>userId</code>. Ответь в течение 5 секунд объектом <code>{'{ content }'}</code> — этот текст и появится в чате.</span></div>
                <div><code>MESSAGE_CREATE</code><span>Новое сообщение в канале сервера, где стоит бот. Ответа не ждём. Приходит только из каналов, к которым у бота есть доступ.</span></div>
                <div><code>X-NeyLivo-Signature</code><span>HMAC-SHA256 тела запроса на твоём webhook-секрете. Проверяй его всегда: без проверки боту сможет писать кто угодно.</span></div>
              </div>

              <h3>Как писать в чат самому</h3>
              <p>
                Не дожидаясь события: <code>POST /functions/v1/bot-api/messages</code> с заголовком{' '}
                <code>Authorization: Bot ТОКЕН</code> и телом <code>{'{ channelId, content }'}</code>.
                Проверить токен — <code>GET /functions/v1/bot-api/me</code>.
              </p>
              <p className="pg-note">
                Токен даёт право писать от имени бота, но не даёт ничего сверх его
                собственных прав на сервере.
              </p>
            </>}

            {tab === 'errors' && <>
              <h3>Частые ошибки</h3>
              <div className="pg-tbl">
                <div><code>401 от NeyLivo</code><span>Не совпала подпись. Считай HMAC от <b>сырого тела</b> запроса, а не от разобранного JSON: любая перестановка полей меняет подпись.</span></div>
                <div><code>бот молчит</code><span>Не задан Webhook URL, либо адрес не отвечает за 5 секунд, либо ответ без поля <code>content</code>. Пустой ответ — NeyLivo ничего не печатает.</span></div>
                <div><code>bot is not a member</code><span>Бота не добавили на сервер. ID приложения → «Настройки сервера → Боты».</span></div>
                <div><code>no access to this channel</code><span>Канал закрытый, а боту доступ не выдавали. Дай его роли доступ — или пусть бот пишет в другой.</span></div>
                <div><code>channel is read-only</code><span>Канал только для чтения. Это не обходится: у бота ровно те же запреты, что у людей.</span></div>
                <div><code>адрес не приняли</code><span>Только <code>https://</code>. Локальные и внутренние адреса отклоняются — через них можно было бы прощупывать чужую сеть.</span></div>
              </div>

              <h3>Чего боту нельзя</h3>
              <p>
                Не увидит закрытый канал, куда его не пустили. Не напишет в канал только
                для чтения. Подчиняется правам ролей и тайм-ауту — ровно как участник-человек.
                Сообщения из закрытых каналов ему не приходят вовсе, даже если он состоит
                в сервере.
              </p>
              <p className="pg-note">
                Бота нельзя выгнать или забанить как человека — его убирают в настройках
                сервера, по праву «Управление ботами».
              </p>

              <h3>Пределы</h3>
              <div className="pg-tbl">
                <div><code>5 секунд</code><span>Столько ждём синхронный ответ на команду</span></div>
                <div><code>4000</code><span>Символов в ответе, дальше обрезается</span></div>
                <div><code>только https</code><span>Адрес вебхука</span></div>
              </div>
            </>}
          </div></div>
        </div>
        </div>
      </div>
    </Portal>
  )
}
