import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import {
  myBots, createBot, setBotWebhook, deleteBot, fetchBotCommands, saveBotCommand, deleteBotCommand,
  addBotToServer, removeBotFromServer, type BotApp, type BotCommand,
} from '../lib/botApi'
import { supabase } from '../lib/supabase'
import { BotCatalog } from './BotCatalog'
import { BotHelp } from './BotHelp'
import { BUILTIN_BOTS } from '../lib/builtinBots'

// v1.193.0: платформа ботов (Настройки пользователя, раздел «Боты» — до
// v1.335.0 назывался «Мои приложения»). Токен
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
  const [help, setHelp] = useState(false)
  const [tab, setTab] = useState<'catalog' | 'used' | 'mine'>('catalog')

  const load = () => { myBots().then(b => { setBots(b); setLoading(false) }) }
  useEffect(load, [])

  /** Удалить готового бота целиком: он сам заведён нами, чинить в нём нечего. */
  async function removeReady(b: BotApp) {
    if (!await confirmUi('Удалить бота «' + b.name + '»? Он пропадёт со всех серверов, куда его добавляли.', { okText: 'Удалить', danger: true })) return
    try { await deleteBot(b.id); toastOk('Бот удалён'); load() }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }

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

  // Готовые боты «от нас» заводятся под твоей учётной записью, но своими их
  // считать неправильно: код у них наш. Поэтому «Свои» — те, что ты сделал сам.
  const own = bots.filter(b => !b.builtin)
  const ready = bots.filter(b => !!b.builtin)

  return (
    <>
      <h2>Боты
        <button className="help-q" title="Как сделать своего бота" onClick={() => setHelp(true)}>?</button>
      </h2>
      <div className="pqs2-desc">Готовые боты работают сразу. Свой — это программа у тебя, которой Ponoi шлёт события.</div>

      <div className="sec-tabs">
        <button className={'sec-tab' + (tab === 'catalog' ? ' on' : '')} onClick={() => setTab('catalog')}>
          <Icon name="store" size={15} /> Каталог
        </button>
        <button className={'sec-tab' + (tab === 'used' ? ' on' : '')} onClick={() => setTab('used')}>
          <Icon name="check" size={15} /> Используемые
          {ready.length > 0 && <span className="sec-tab-n">{ready.length}</span>}
        </button>
        <button className={'sec-tab' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>
          <Icon name="code" size={15} /> Свои
          {own.length > 0 && <span className="sec-tab-n">{own.length}</span>}
        </button>
      </div>

      {tab === 'catalog' && <BotCatalog inline />}

      {tab === 'used' && <>
        <div className="pqs2-desc" style={{ marginTop: 12 }}>
          Готовые боты, которых ты добавил из каталога. Они работают без своего сервера — всё
          считается внутри Ponoi. Убрать бота с конкретного сервера можно в «Настройки сервера → Боты».
        </div>
        {loading && <div className="modal-empty">Загрузка…</div>}
        {!loading && ready.length === 0 && <div className="modal-empty">Пока ни одного. Возьми готового в каталоге.</div>}
        <div style={{ marginTop: 12 }}>
          {ready.map(b => (
            <div key={b.id} className="devp-card">
              <div className="devp-card-h">
                <span className="cat-emoji">{BUILTIN_BOTS.find(x => x.kind === b.builtin)?.emoji ?? '🤖'}</span>
                <b>{b.name}</b>
                <span className="cat-badge">от Ponoi</span>
                <button className="pqs2-btn ghost danger" style={{ marginLeft: 'auto' }}
                  onClick={() => void removeReady(b)}>Удалить</button>
              </div>
              <div className="plug-sub">{BUILTIN_BOTS.find(x => x.kind === b.builtin)?.summary ?? ''}</div>
            </div>
          ))}
        </div>
      </>}

      {tab === 'mine' && <>
        {justCreated && <div className="sset-info" style={{ marginTop: 12 }}>
          <Icon name="shield" size={16} />
          <div>
            <b>Бот создан. Токен виден только сейчас — сохрани его.</b>
            <div className="devp-secret">{justCreated.token}</div>
            {/* v1.336.0: раньше здесь показывался токен и всё. Что делать дальше,
                человек не знал — отсюда «непонятно, как создавать ботов». */}
            <div className="bot-steps">
              <div className="bot-step"><span>Сохрани токен и секрет вебхука: второй раз их не покажет никто.</span></div>
              <div className="bot-step"><span>Подними свою программу на адресе https:// и впиши его ниже, в поле Webhook URL.</span></div>
              <div className="bot-step"><span>Заведи слэш-команды — они появятся в подсказках у людей.</span></div>
              <div className="bot-step"><span>Добавь бота на сервер: «Настройки сервера → Боты», по ID приложения.</span></div>
            </div>
            <div className="modal-inline" style={{ marginTop: 10 }}>
              <button className="pqs2-btn ghost" onClick={() => setHelp(true)}>Как написать бота</button>
              <button className="pqs2-btn ghost" onClick={() => setJustCreated(null)}>Спрятать токен</button>
            </div>
          </div>
        </div>}

        <div className="pqs2-desc" style={{ marginTop: 12 }}>
          Свой бот — это программа на твоём сервере: Ponoi шлёт ей события и печатает её ответы в чат.
          Если сервера нет, возьми готового в каталоге — те работают сами.
        </div>

        <div className="modal-inline" style={{ marginTop: 12 }}>
          <input className="modal-in" placeholder="Название бота" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ flex: 1 }} />
          <button className="modal-primary" disabled={!newName.trim() || busy} onClick={create}>{busy ? 'Создание…' : 'Создать'}</button>
        </div>

        {loading && <div className="modal-empty">Загрузка…</div>}
        {!loading && own.length === 0 && <div className="modal-empty">Своих ботов пока нет.</div>}

        <div style={{ marginTop: 16 }}>
          {own.map(b => <BotCard key={b.id} bot={b} open={openId === b.id} onToggle={() => setOpenId(v => v === b.id ? null : b.id)}
            onDeleted={() => { setOpenId(null); load() }} />)}
        </div>
      </>}

      {help && <BotHelp onClose={() => setHelp(false)} />}
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
    try {
      await deleteBotCommand(id)
      setCommands(await fetchBotCommands(bot.id))
    } catch (e: any) { toastErr(e.message ?? String(e)) }
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
// по ID приложения (владелец бота делится им из раздела «Боты»), список уже
// добавленных с кнопкой «Удалить» (обычный server_members.delete — доступен тем,
// у кого MANAGE_WEBHOOKS, тот же гейт, что открывает саму вкладку).
export function ServerBotsPanel({ serverId, memberIds }: { serverId: string; memberIds: string[] }) {
  const [installed, setInstalled] = useState<{ id: string; bot_user_id: string; name: string }[]>([])
  const [appId, setAppId] = useState('')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  const [tab, setTab] = useState<'catalog' | 'used'>('catalog')

  const load = () => {
    if (!memberIds.length) { setInstalled([]); return }
    // bot_apps_public — большинство ботов на сервере поставил не сам смотрящий,
    // а обычная RLS на bot_apps пускает только владельца (см. миграцию 53).
    supabase.from('bot_apps_public').select('id, bot_user_id, name').in('bot_user_id', memberIds)
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
      <h2>Боты
        <button className="help-q" title="Как сделать своего бота" onClick={() => setHelp(true)}>?</button>
      </h2>
      <div className="pqs2-desc">Возьми готового из каталога — или добавь по ID приложения, если бота тебе дали лично.</div>

      {/* v1.336.0: две вкладки — что можно взять и что уже стоит. Раньше и то и
          другое лежало одной лентой, и «кто у меня стоит» приходилось искать
          под всем каталогом. */}
      <div className="sec-tabs">
        <button className={'sec-tab' + (tab === 'catalog' ? ' on' : '')} onClick={() => setTab('catalog')}>
          <Icon name="store" size={15} /> Каталог
        </button>
        <button className={'sec-tab' + (tab === 'used' ? ' on' : '')} onClick={() => setTab('used')}>
          <Icon name="check" size={15} /> На этом сервере
          {installed.length > 0 && <span className="sec-tab-n">{installed.length}</span>}
        </button>
      </div>

      {tab === 'catalog' && <>
        <BotCatalog serverId={serverId} onAdded={load} inline />
        <div className="pqs-sec-t" style={{ marginTop: 22 }}>По ID приложения</div>
        <div className="pqs2-desc">Если бота тебе дали лично — вставь сюда его ID.</div>
        <div className="modal-inline" style={{ marginTop: 8 }}>
          <input className="modal-in" placeholder="ID приложения бота" value={appId} onChange={e => setAppId(e.target.value)} style={{ flex: 1 }} />
          <button className="pqs2-btn ghost" disabled={!appId.trim() || busy} onClick={add}>{busy ? 'Добавление…' : 'Добавить по ID'}</button>
        </div>
      </>}

      {tab === 'used' && <div style={{ marginTop: 14 }}>
        {installed.map(b => (
          <div key={b.id} className="devp-card-h" style={{ background: 'var(--bg2)', borderRadius: 8, marginBottom: 8 }}>
            <Icon name="code" size={18} /><b>{b.name}</b>
            <button className="pqs2-btn ghost" style={{ marginLeft: 'auto' }} onClick={() => remove(b)}>Убрать</button>
          </div>
        ))}
        {installed.length === 0 && <div className="modal-empty">На сервере пока нет ботов. Возьми готового во вкладке «Каталог».</div>}
      </div>}

      {help && <BotHelp onClose={() => setHelp(false)} />}
    </>
  )
}
