import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import {
  myBots, createBot, setBotWebhook, deleteBot, fetchBotCommands, saveBotCommand, deleteBotCommand,
  addBotToServer, removeBotFromServer, type BotApp, type BotCommand,
} from '../lib/botApi'
import { supabase } from '../lib/supabase'

// v1.193.0: «Мои приложения» — платформа ботов (Настройки пользователя). Токен
// и webhook-секрет видны только один раз, сразу после создания (как у Discord) —
// дальше в БД хранится только их хэш. Если токен потерян — проще удалить бота
// и создать нового, чем городить отдельный «перегенерировать» эндпоинт для v1.
export function DevPortal() {
  const [bots, setBots] = useState<BotApp[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [justCreated, setJustCreated] = useState<{ id: string; token: string; webhookSecret: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = () => { myBots().then(b => { setBots(b); setLoading(false) }) }
  useEffect(load, [])

  async function create() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const r = await createBot(name)
      setJustCreated(r)
      setNewName('')
      load()
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setBusy(false) }
  }

  return (
    <>
      <h2>Мои приложения</h2>
      <div className="pqs2-desc">Свои боты для серверов — как в Discord: приложение получает токен для API и (по желанию) вебхук, куда Ponoi шлёт события сообщений и вызовы слэш-команд.</div>

      {justCreated && <div className="sset-info" style={{ marginTop: 12 }}>
        <Icon name="shield" size={16} />
        <div>
          <b>Бот создан — токен виден только сейчас, сохрани его.</b>
          <div className="devp-secret">{justCreated.token}</div>
          <div className="cset-hint" style={{ marginTop: 6 }}>Заголовок для API-запросов бота: <code>Authorization: Bot {'{токен}'}</code></div>
          <button className="pqs2-btn ghost" style={{ marginTop: 8 }} onClick={() => setJustCreated(null)}>Понятно, спрятать</button>
        </div>
      </div>}

      <div className="modal-inline" style={{ marginTop: 16 }}>
        <input className="modal-in" placeholder="Название бота" value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ flex: 1 }} />
        <button className="modal-primary" disabled={!newName.trim() || busy} onClick={create}>{busy ? 'Создание…' : 'Создать'}</button>
      </div>

      {loading && <div className="modal-empty">Загрузка…</div>}
      {!loading && bots.length === 0 && <div className="cset-hint" style={{ marginTop: 12 }}>Пока нет ни одного приложения.</div>}

      <div style={{ marginTop: 16 }}>
        {bots.map(b => <BotCard key={b.id} bot={b} open={openId === b.id} onToggle={() => setOpenId(v => v === b.id ? null : b.id)}
          onDeleted={() => { setOpenId(null); load() }} />)}
      </div>
    </>
  )
}

function BotCard({ bot, open, onToggle, onDeleted }: { bot: BotApp; open: boolean; onToggle: () => void; onDeleted: () => void }) {
  const [webhook, setWebhook] = useState(bot.webhook_url ?? '')
  const [savingWh, setSavingWh] = useState(false)
  const [commands, setCommands] = useState<BotCommand[]>([])
  const [cmdName, setCmdName] = useState('')
  const [cmdDesc, setCmdDesc] = useState('')

  useEffect(() => { if (open) fetchBotCommands(bot.id).then(setCommands) }, [open, bot.id])

  async function saveWebhook() {
    setSavingWh(true)
    try { await setBotWebhook(bot.id, webhook.trim() || null); toastOk('Вебхук сохранён') }
    catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setSavingWh(false) }
  }
  async function addCommand() {
    const name = cmdName.trim().toLowerCase(), desc = cmdDesc.trim()
    if (!name || !desc) return
    try {
      await saveBotCommand(bot.id, { name, description: desc, options: [] })
      setCmdName(''); setCmdDesc('')
      setCommands(await fetchBotCommands(bot.id))
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  async function removeCommand(id: string) {
    await deleteBotCommand(id)
    setCommands(await fetchBotCommands(bot.id))
  }
  async function remove() {
    if (!await confirmUi('Удалить бота «' + bot.name + '»? Он будет убран со всех серверов, токен перестанет работать.', { okText: 'Удалить', danger: true })) return
    try { await deleteBot(bot.id); toastOk('Бот удалён'); onDeleted() }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  return (
    <div className="devp-card">
      <div className="devp-card-h" onClick={onToggle}>
        <Icon name="code" size={18} />
        <b>{bot.name}</b>
        <span className="devp-card-id" title="ID приложения — им делишься с владельцем сервера">{bot.id}</span>
        <Icon name="chevron-right" size={14} style={open ? { transform: 'rotate(90deg)' } : undefined} />
      </div>
      {open && <div className="devp-card-body">
        <label className="modal-lbl">ID приложения (для добавления на сервер)</label>
        <div className="modal-inline">
          <input className="modal-in" value={bot.id} readOnly style={{ flex: 1 }} />
          <button className="pqs2-btn ghost" onClick={() => { navigator.clipboard?.writeText(bot.id); toastOk('ID скопирован') }}>Копировать</button>
        </div>
        <label className="modal-lbl">Webhook URL</label>
        <div className="cset-hint" style={{ marginTop: 0 }}>Сюда Ponoi шлёт подписанные POST-запросы: новое сообщение на серверах, где состоит бот, и вызовы слэш-команд.</div>
        <div className="modal-inline">
          <input className="modal-in" placeholder="https://..." value={webhook} onChange={e => setWebhook(e.target.value)} style={{ flex: 1 }} />
          <button className="pqs2-btn ghost" disabled={savingWh} onClick={saveWebhook}>{savingWh ? 'Сохранение…' : 'Сохранить'}</button>
        </div>

        <label className="modal-lbl" style={{ marginTop: 14 }}>Слэш-команды</label>
        {commands.map(c => (
          <div key={c.id} className="devp-cmd">
            <span>/{c.name}</span><span className="mut">{c.description}</span>
            <span className="devp-cmd-x" onClick={() => removeCommand(c.id)}><Icon name="trash" size={13} /></span>
          </div>
        ))}
        <div className="modal-inline" style={{ marginTop: 6 }}>
          <input className="modal-in" placeholder="имя" value={cmdName} onChange={e => setCmdName(e.target.value.replace(/[^a-z0-9_]/gi, ''))} style={{ flex: 1 }} />
          <input className="modal-in" placeholder="описание" value={cmdDesc} onChange={e => setCmdDesc(e.target.value)} style={{ flex: 2 }} />
          <button className="pqs2-btn ghost" onClick={addCommand}>Добавить</button>
        </div>

        <button className="pqs-danger" style={{ marginTop: 14 }} onClick={remove}>Удалить бота</button>
      </div>}
    </div>
  )
}

// v1.193.0: вкладка «Боты» в настройках сервера — добавить чужого/своего бота
// по ID приложения (владелец бота делится им из «Мои приложения»), список уже
// добавленных с кнопкой «Удалить» (обычный server_members.delete — доступен тем,
// у кого MANAGE_WEBHOOKS, тот же гейт, что открывает саму вкладку).
export function ServerBotsPanel({ serverId, memberIds }: { serverId: string; memberIds: string[] }) {
  const [installed, setInstalled] = useState<{ id: string; bot_user_id: string; name: string }[]>([])
  const [appId, setAppId] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!memberIds.length) { setInstalled([]); return }
    supabase.from('bot_apps').select('id, bot_user_id, name').in('bot_user_id', memberIds)
      .then(({ data }) => setInstalled((data ?? []) as any[]))
  }
  useEffect(load, [memberIds.join(',')])

  async function add() {
    const id = appId.trim()
    if (!id || busy) return
    setBusy(true)
    try { await addBotToServer(id, serverId); toastOk('Бот добавлен на сервер'); setAppId(''); load() }
    catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setBusy(false) }
  }
  async function remove(b: { bot_user_id: string; name: string }) {
    if (!await confirmUi('Убрать бота «' + b.name + '» с сервера?', { okText: 'Убрать' })) return
    try { await removeBotFromServer(b.bot_user_id, serverId); load() }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  return (
    <>
      <h2>Боты</h2>
      <div className="pqs2-desc">Добавь бота по ID приложения — его владелец найдёт ID в «Мои приложения» (Настройки пользователя).</div>
      <div className="modal-inline" style={{ marginTop: 16 }}>
        <input className="modal-in" placeholder="ID приложения бота" value={appId} onChange={e => setAppId(e.target.value)} style={{ flex: 1 }} />
        <button className="modal-primary" disabled={!appId.trim() || busy} onClick={add}>{busy ? 'Добавление…' : 'Добавить'}</button>
      </div>
      <div style={{ marginTop: 16 }}>
        {installed.map(b => (
          <div key={b.id} className="devp-card-h" style={{ background: 'var(--bg2)', borderRadius: 8, marginBottom: 8 }}>
            <Icon name="code" size={18} /><b>{b.name}</b>
            <button className="pqs2-btn ghost" style={{ marginLeft: 'auto' }} onClick={() => remove(b)}>Удалить</button>
          </div>
        ))}
        {installed.length === 0 && <div className="cset-hint">На сервере пока нет ботов.</div>}
      </div>
    </>
  )
}
