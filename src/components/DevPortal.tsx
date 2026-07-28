import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import {
  myBots, setBotWebhook, deleteBot, fetchBotCommands, saveBotCommand, deleteBotCommand,
  addBotToServer, removeBotFromServer, setBotProfile, fetchBotProfile, type BotApp, type BotCommand,
} from '../lib/botApi'
import { Avatar } from './Avatar'
import { setMemberNickname } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { BotCatalog } from './BotCatalog'
import { BotHelp } from './BotHelp'
import { BotWizard } from './BotWizard'
import { BUILTIN_BOTS } from '../lib/builtinBots'

// v1.193.0: платформа ботов (Настройки пользователя, раздел «Боты» — до
// v1.335.0 назывался «Мои приложения»). Токен
// и webhook-секрет видны только один раз, сразу после создания (как у Discord) —
// дальше в БД хранится только их хэш. Если токен потерян — проще удалить бота
// и создать нового, чем городить отдельный «перегенерировать» эндпоинт для v1.
export function DevPortal() {
  const [bots, setBots] = useState<BotApp[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [tab, setTab] = useState<'catalog' | 'used' | 'mine'>('catalog')
  const [wizard, setWizard] = useState(false)

  const load = () => { myBots().then(b => { setBots(b); setLoading(false) }) }
  useEffect(load, [])

  /** Удалить готового бота целиком: он сам заведён нами, чинить в нём нечего. */
  async function removeReady(b: BotApp) {
    if (!await confirmUi('Удалить бота «' + b.name + '»? Он пропадёт со всех серверов, куда его добавляли.', { okText: 'Удалить', danger: true })) return
    try { await deleteBot(b.id); toastOk('Бот удалён'); load() }
    catch (e: any) { toastErr(e.message ?? String(e)) }
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
        {/* v1.341.0: создание собрано в один мастер. Раньше это было размазано:
            поле с кнопкой здесь, каталог готовых во вкладке рядом, токен в плашке
            сверху, вебхук и профиль внутри карточки, справка за «?» — начать было
            неоткуда. */}
        <div className="pqs2-desc" style={{ marginTop: 12 }}>
          Свой бот — программа на твоём сервере: Ponoi шлёт ей события и печатает ответы в чат.
          Своего сервера нет — возьми готового, он работает сам.
        </div>
        <div className="modal-inline" style={{ marginTop: 12 }}>
          <button className="modal-primary" onClick={() => setWizard(true)}>
            <Icon name="plus" size={16} /> Создать бота
          </button>
          <button className="pqs2-btn ghost" onClick={() => setHelp(true)}>Как написать бота</button>
        </div>

        {loading && <div className="modal-empty">Загрузка…</div>}
        {!loading && own.length === 0 && <div className="modal-empty">Своих ботов пока нет.</div>}

        <div style={{ marginTop: 16 }}>
          {own.map(b => <BotCard key={b.id} bot={b} open={openId === b.id} onToggle={() => setOpenId(v => v === b.id ? null : b.id)}
            onDeleted={() => { setOpenId(null); load() }} />)}
        </div>
      </>}

      {help && <BotHelp onClose={() => setHelp(false)} />}
      {wizard && <BotWizard onClose={() => setWizard(false)} onDone={() => { setTab('mine'); load() }} />}
    </>
  )
}

function BotCard({ bot, open, onToggle, onDeleted }: { bot: BotApp; open: boolean; onToggle: () => void; onDeleted: () => void }) {
  const [webhook, setWebhook] = useState(bot.webhook_url ?? '')
  const [savingWh, setSavingWh] = useState(false)
  const [commands, setCommands] = useState<BotCommand[]>([])
  const [cmdName, setCmdName] = useState('')
  const [cmdDesc, setCmdDesc] = useState('')

  // v1.340.0: профиль бота — аватарка, «о себе» и цвета карточки. Раньше бот
  // выглядел буквой на сером фоне, и поменять это не мог даже его владелец.
  const [avatar, setAvatar] = useState('')
  const [about, setAbout] = useState('')
  const [primary, setPrimary] = useState('#5865f2')
  const [accent, setAccent] = useState('#5865f2')
  const [savingProf, setSavingProf] = useState(false)

  useEffect(() => {
    if (!open) return
    fetchBotCommands(bot.id).then(setCommands)
    fetchBotProfile(bot.bot_user_id).then(p => {
      if (!p) return
      setAvatar(p.avatar_url ?? '')
      setAbout(p.about ?? '')
      setPrimary(p.primary_color || '#5865f2')
      setAccent(p.accent_color || '#5865f2')
    })
  }, [open, bot.id, bot.bot_user_id])

  async function saveProfile() {
    setSavingProf(true)
    try {
      await setBotProfile(bot.id, {
        avatarUrl: avatar.trim() || null, about: about.trim(),
        primary: primary || null, accent: accent || null,
      })
      toastOk('Профиль бота сохранён')
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setSavingProf(false) }
  }

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
        <label className="modal-lbl">Внешний вид</label>
        <div className="cset-hint" style={{ marginTop: 0 }}>
          Так бота увидят в списке участников и в профиле. Писать сам он не умеет — отвечает
          только на то, что ему присылают.
        </div>
        <div className="botp-row">
          <div className="botp-prev" style={{ background: `linear-gradient(160deg, ${primary}, ${accent})` }}>
            <Avatar name={bot.name} url={avatar.trim() || null} userId={bot.bot_user_id} size={48} />
            <div className="botp-prev-nm">{bot.name}<span className="bot-badge">БОТ</span></div>
          </div>
          <div className="botp-fields">
            <input className="modal-in" placeholder="Ссылка на аватарку (https://…)"
              value={avatar} onChange={e => setAvatar(e.target.value)} />
            <textarea className="cset-topic" maxLength={300} placeholder="О себе: что бот умеет"
              value={about} onChange={e => setAbout(e.target.value)} />
            <div className="modal-inline">
              <label className="botp-color">Основной <input type="color" value={primary} onChange={e => setPrimary(e.target.value)} /></label>
              <label className="botp-color">Акцент <input type="color" value={accent} onChange={e => setAccent(e.target.value)} /></label>
              <button className="pqs2-btn ghost" disabled={savingProf} onClick={saveProfile}>
                {savingProf ? 'Сохранение…' : 'Сохранить профиль'}
              </button>
            </div>
          </div>
        </div>

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
  const [nick, setNick] = useState<Record<string, string>>({})

  /** Ник бота на этом сервере — тем же путём, что и ник человека. */
  async function renameBot(b: { bot_user_id: string; name: string }) {
    const v = (nick[b.bot_user_id] ?? '').trim()
    if (!v) return
    try {
      await setMemberNickname(serverId, b.bot_user_id, v, true)
      toastOk('Ник изменён')
      setNick(n => ({ ...n, [b.bot_user_id]: '' }))
      load()
    } catch (e: any) {
      const m = String(e?.message ?? e)
      toastErr(m.includes('permission') ? 'Нужно право «Управление никами»' : m)
    }
  }

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
          <div key={b.id} className="devp-card" style={{ marginBottom: 8 }}>
            <div className="devp-card-h">
              <Icon name="code" size={18} /><b>{b.name}</b><span className="bot-badge">БОТ</span>
              <button className="pqs2-btn ghost" style={{ marginLeft: 'auto' }} onClick={() => remove(b)}>Убрать</button>
            </div>
            {/* v1.340.0: ник бота на ЭТОМ сервере — как у людей. Раньше бота
                можно было переименовать только там, где он заведён, то есть
                у его владельца, и на всех серверах сразу. */}
            <div className="modal-inline" style={{ marginTop: 8 }}>
              <input className="modal-in" style={{ flex: 1 }} placeholder={'Ник на этом сервере — сейчас «' + b.name + '»'}
                value={nick[b.bot_user_id] ?? ''} onChange={e => setNick(n => ({ ...n, [b.bot_user_id]: e.target.value }))} />
              <button className="pqs2-btn ghost" disabled={!(nick[b.bot_user_id] ?? '').trim()}
                onClick={() => void renameBot(b)}>Переименовать</button>
            </div>
          </div>
        ))}
        {installed.length === 0 && <div className="modal-empty">На сервере пока нет ботов. Возьми готового во вкладке «Каталог».</div>}
      </div>}

      {help && <BotHelp onClose={() => setHelp(false)} />}
    </>
  )
}
