import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk } from '../lib/toast'

// v1.333.0: «как сделать своего бота» — маленькая кнопка «?» рядом с разделом
// ботов. Раньше формат вебхука и заголовок авторизации были описаны только
// комментариями в supabase/functions/*, то есть человеку со стороны — нигде.

const EXAMPLE = `// Простейший бот на любом языке. Ниже — Node.js.
// 1) Заведи бота в «Настройки → Боты → Мои боты», скопируй ID и токен.
// 2) Подними это на своём https-адресе и впиши его в поле Webhook URL.
import crypto from 'node:crypto'
import express from 'express'

const SECRET = process.env.PONOI_WEBHOOK_SECRET   // выдаётся при создании бота
const app = express()

app.post('/ponoi', express.text({ type: '*/*' }), (req, res) => {
  // Подпись обязательна: без неё кто угодно пришлёт боту что угодно.
  const mine = crypto.createHmac('sha256', SECRET).update(req.body).digest('hex')
  if (mine !== req.get('X-Ponoi-Signature')) return res.sendStatus(401)

  const event = JSON.parse(req.body)
  if (event.type === 'INTERACTION_CREATE' && event.command === 'привет') {
    // Ответ на слэш-команду — синхронно, полем content.
    return res.json({ content: 'Привет!' })
  }
  if (event.type === 'MESSAGE_CREATE') {
    // Новое сообщение на сервере, где стоит бот. Отвечать не обязательно.
  }
  res.json({})
})

app.listen(3000)`

export function BotHelp({ onClose }: { onClose: () => void }) {
  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal help-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Как сделать своего бота</div>

        <div className="help-p">
          Бот в Ponoi — это обычный участник сервера с настоящей учётной записью: у него те же
          права, те же каналы и те же запреты, что у людей. Ты пишешь программу, которая живёт
          у тебя, а Ponoi шлёт ей события и передаёт ответы в чат.
        </div>

        <label className="modal-lbl">По шагам</label>
        <div className="help-tbl">
          <div><code>1</code><span>«Настройки → Боты → Мои боты» → создать. Токен и секрет показываются <b>один раз</b> — сохрани их сразу, второй раз их не покажет никто.</span></div>
          <div><code>2</code><span>Подними свой сервис на адресе <code>https://…</code> и впиши его в поле Webhook URL. Адреса вида localhost и внутренние сети не примут — через них можно было бы прощупывать чужую сеть.</span></div>
          <div><code>3</code><span>Заведи слэш-команды: имя и описание. Они появятся в подсказках, когда человек начнёт печатать «/».</span></div>
          <div><code>4</code><span>Отдай ID приложения владельцу сервера — или выложи бота в каталог, чтобы его нашли сами.</span></div>
        </div>

        <label className="modal-lbl">Что приходит на вебхук</label>
        <div className="help-tbl">
          <div><code>INTERACTION_CREATE</code><span>Человек вызвал твою команду. Поля: <code>command</code>, <code>args</code>, <code>channelId</code>, <code>userId</code>. Ответь в течение 5 секунд объектом <code>{'{ content }'}</code> — этот текст и появится в чате.</span></div>
          <div><code>MESSAGE_CREATE</code><span>Новое сообщение в канале сервера, где стоит бот. Приходит только из каналов, к которым у бота есть доступ.</span></div>
          <div><code>X-Ponoi-Signature</code><span>HMAC-SHA256 тела запроса на твоём webhook-секрете. Проверяй его всегда: без проверки боту сможет писать кто угодно.</span></div>
        </div>

        <label className="modal-lbl">Как писать в чат самому</label>
        <div className="help-p">
          Не дожидаясь события: <code>POST /functions/v1/bot-api/messages</code> с заголовком{' '}
          <code>Authorization: Bot ТОКЕН</code> и телом <code>{'{ channelId, content }'}</code>.
          Проверить токен — <code>GET /functions/v1/bot-api/me</code>.
        </div>

        <label className="modal-lbl">Пример</label>
        <pre className="help-code">{EXAMPLE}</pre>
        <button className="pqs2-btn ghost" onClick={() => { navigator.clipboard?.writeText(EXAMPLE); toastOk('Пример скопирован') }}>
          <Icon name="copy" size={15} /> Скопировать пример
        </button>

        <div className="help-p mut">
          Бот не всесилен: он не увидит закрытый канал, куда его не пустили, не напишет в канал
          только для чтения и подчиняется правам ролей — ровно как участник-человек.
        </div>

        <div className="modal-foot">
          <button className="modal-primary" onClick={onClose}>Понятно</button>
        </div>
      </div>
    </div></Portal>
  )
}
