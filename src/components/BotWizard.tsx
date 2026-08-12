import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { Avatar } from './Avatar'
import { PicField } from './PicField'
import { toastOk, toastErr } from '../lib/toast'
import { createBot, addBotToServer, setBotWebhook, setBotProfile, saveBotCommand, serversForBots } from '../lib/botApi'
import { BUILTIN_BOTS } from '../lib/builtinBots'
import { countInstall } from '../lib/catalog'

// v1.341.0: создание бота одним мастером.
//
// Раньше это было размазано по всей странице: поле «название» с кнопкой в одном
// месте, каталог готовых — во вкладке рядом, токен и что с ним делать — в
// плашке сверху, вебхук и профиль — внутри карточки бота, справка — за «?».
// Человек, впервые открывший раздел, не понимал, с чего начать и чем всё
// кончится. Здесь один путь: выбрал, каким будет бот, — получил рабочего.

type Kind = 'ready' | 'simple' | 'own'

/** Одна пара «команда — ответ» в боте без программирования. */
interface Pair { name: string; reply: string }

export function BotWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind | null>(null)
  // v1.355.0: только серверы, куда я вправе ставить ботов — как и в каталоге.
  const [servers, setServers] = useState<{ id: string; name: string }[] | null>(null)
  const [server, setServer] = useState('')
  const [busy, setBusy] = useState('')

  // Готовый
  const [pick, setPick] = useState(BUILTIN_BOTS[0]?.kind ?? '')

  // Без программирования
  const [simpleName, setSimpleName] = useState('')
  const [pairs, setPairs] = useState<Pair[]>([{ name: 'привет', reply: 'Привет! Я бот этого сервера.' }])

  // Свой
  const [name, setName] = useState('')
  const [made, setMade] = useState<{ id: string; token: string; webhookSecret: string; botUserId: string } | null>(null)
  const [webhook, setWebhook] = useState('')
  const [avatar, setAvatar] = useState('')
  const [banner, setBanner] = useState('')
  const [about, setAbout] = useState('')
  const [cmdName, setCmdName] = useState('')
  const [cmdDesc, setCmdDesc] = useState('')

  useEffect(() => {
    serversForBots().then(list => { setServers(list); setServer(prev => prev || (list[0]?.id ?? '')) }).catch(() => setServers([]))
  }, [])

  async function createReady() {
    const b = BUILTIN_BOTS.find(x => x.kind === pick)
    if (!b || !server) return
    setBusy('ready')
    let created: string | null = null
    try {
      const r = await createBot(b.name, b.kind)
      created = r.id
      await addBotToServer(r.id, server)
      void countInstall('bot', 'builtin:' + b.kind)
      toastOk(`«${b.name}» добавлен на сервер`)
      onDone(); onClose()
    } catch (e: any) {
      // Разделяем два разных отказа: не смогли завести бота вообще и завели, но
      // не поставили (например, нет права «Управление ботами» на этом сервере).
      // Во втором случае бот уже существует, и молчать об этом нельзя.
      onDone()
      toastErr(created
        ? `Бот «${b.name}» создан, но на сервер не встал: ${e?.message ?? e}. Он в разделе «Используемые» — попробуй добавить из «Настройки сервера → Боты».`
        : (e?.message ?? String(e)))
    }
    finally { setBusy('') }
  }

  /**
   * Бот без программирования: команда — заранее написанный ответ.
   *
   * v1.344.0. До этого «свой бот» означал «напиши программу и подними её на
   * своём сервере» — то есть для большинства был недоступен вовсе. А хотят чаще
   * всего простого: чтобы по /правила бот прислал правила. Выполняется он нашей
   * же функцией, никакого «снаружи» ему не нужно.
   */
  async function createSimple() {
    const n = simpleName.trim()
    const list = pairs.map(p => ({ name: p.name.trim().toLowerCase(), reply: p.reply.trim() }))
                      .filter(p => p.name && p.reply)
    if (!n || list.length === 0) return
    setBusy('simple')
    const failed: string[] = []
    try {
      const r = await createBot(n, 'simple')
      for (const p of list) {
        try {
          await saveBotCommand(r.id, {
            name: p.name,
            description: p.reply.slice(0, 90),
            options: [],
            reply: p.reply,
          })
        } catch (e: any) { failed.push('/' + p.name + ': ' + (e?.message ?? e)) }
      }
      if (server) {
        try { await addBotToServer(r.id, server) }
        catch (e: any) { failed.push('добавление на сервер: ' + (e?.message ?? e)) }
      }
      onDone()
      if (failed.length === 0) { toastOk(`«${n}» готов и отвечает`); onClose() }
      else toastErr('Бот создан, но не всё получилось — ' + failed.join('; '))
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy('') }
  }

  async function createOwn() {
    const n = name.trim()
    if (!n) return
    setBusy('own')
    try {
      setMade(await createBot(n))
      onDone()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy('') }
  }

  /**
   * Настройки применяются ПОШАГОВО и независимо.
   *
   * Раньше это был один try: если спотыкался, скажем, профиль (а он споткнётся у
   * всех, пока не применена миграция 91), то команда не заводилась и бот не
   * вставал на сервер — при том что сам бот уже создан. Человек видел ошибку про
   * аватарку и не понимал, почему бота нет на сервере. Теперь каждый шаг сам за
   * себя, а в конце честно перечисляется, что именно не получилось.
   */
  async function finishOwn() {
    if (!made) return
    setBusy('finish')
    const failed: string[] = []
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try { await fn() } catch (e: any) { failed.push(what + ': ' + (e?.message ?? String(e))) }
    }

    if (webhook.trim()) await step('адрес вебхука', () => setBotWebhook(made.id, webhook.trim()))
    if (avatar.trim() || about.trim() || banner.trim()) {
      await step('внешний вид', () => setBotProfile(made.id, {
        avatarUrl: avatar.trim() || null, about: about.trim(), primary: null, accent: null,
        bannerUrl: banner.trim() || null,
      }))
    }
    if (cmdName.trim() && cmdDesc.trim()) {
      await step('команда', () => saveBotCommand(made.id, {
        name: cmdName.trim().toLowerCase(), description: cmdDesc.trim(), options: [],
      }))
    }
    if (server) await step('добавление на сервер', () => addBotToServer(made.id, server))

    setBusy('')
    onDone()
    if (failed.length === 0) { toastOk('Бот готов'); onClose(); return }
    // Бот создан в любом случае — говорим и это, иначе человек решит, что всё зря.
    toastErr('Бот создан, но не всё применилось — ' + failed.join('; '))
  }

  const copy = (v: string, what: string) => { navigator.clipboard?.writeText(v); toastOk(what + ' скопирован') }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal bw-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>

        {/* ── Шаг 1: каким будет бот ─────────────────────────────────────── */}
        {!kind && <>
          <div className="modal-title">Создать бота</div>
          <div className="modal-sub">Два пути. Первый — на пять минут, второй — если хочешь свою логику.</div>
          <div className="bw-choice three">
            <button className="bw-card" onClick={() => setKind('ready')}>
              <span className="bw-card-e">⚡</span>
              <span className="bw-card-t">Готовый</span>
              <span className="bw-card-d">
                Кубик, опросы, статистика, встречающий, шар предсказаний.
                Работает сразу, настраивать нечего.
              </span>
              <span className="bw-card-tag easy">проще всего</span>
            </button>
            <button className="bw-card" onClick={() => setKind('simple')}>
              <span className="bw-card-e">💬</span>
              <span className="bw-card-t">Свой, без кода</span>
              <span className="bw-card-d">
                Ты пишешь: команда — и что на неё отвечать. Например /правила → текст правил.
                Программировать не надо, сервер не нужен.
              </span>
              <span className="bw-card-tag easy">без программирования</span>
            </button>
            <button className="bw-card" onClick={() => setKind('own')}>
              <span className="bw-card-e">🛠️</span>
              <span className="bw-card-t">Свой, с программой</span>
              <span className="bw-card-d">
                Ты пишешь программу, она живёт на твоём https-адресе. Полная свобода,
                но нужен свой сервер.
              </span>
              <span className="bw-card-tag hard">для программистов</span>
            </button>
          </div>
        </>}

        {/* ── Готовый ────────────────────────────────────────────────────── */}
        {kind === 'ready' && <>
          <div className="modal-title">Готовый бот</div>
          <div className="modal-sub">Заведётся под твоей учётной записью и сразу встанет на сервер.</div>
          <div className="bw-list">
            {BUILTIN_BOTS.map(b => (
              <button key={b.kind} className={'bw-item' + (pick === b.kind ? ' on' : '')} onClick={() => setPick(b.kind)}>
                <span className="bw-item-e">{b.emoji}</span>
                <span className="bw-item-tx">
                  <span className="bw-item-n">{b.name}</span>
                  <span className="bw-item-d">{b.summary}</span>
                  {b.commands.length > 0 && (
                    <span className="bw-item-c">{b.commands.map(c => '/' + c.name).join('  ')}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <label className="modal-lbl">Куда добавить</label>
          <select className="modal-in" value={server} onChange={e => setServer(e.target.value)}>
            {(servers ?? []).length === 0 && <option value="">Некуда добавлять</option>}
            {(servers ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="modal-foot">
            <button className="modal-ghost" onClick={() => setKind(null)}>Назад</button>
            <button className="modal-primary" disabled={!server || !!busy} onClick={() => void createReady()}>
              {busy ? 'Добавляю…' : 'Добавить'}
            </button>
          </div>
        </>}

        {/* ── Без кода: команда и ответ ──────────────────────────────────── */}
        {kind === 'simple' && <>
          <div className="modal-title">Бот, который отвечает</div>
          <div className="modal-sub">Напиши, на какую команду что отвечать. Всё остальное сделаем мы.</div>

          <label className="modal-lbl">Как его назвать</label>
          <input className="modal-in" autoFocus placeholder="Например: Справочная" value={simpleName}
            onChange={e => setSimpleName(e.target.value)} />

          <label className="modal-lbl">Что он умеет</label>
          {pairs.map((p, i) => (
            <div key={i} className="bw-pair">
              <div className="bw-pair-cmd">
                <span>/</span>
                <input placeholder="правила" value={p.name}
                  onChange={e => setPairs(list => list.map((x, n) => n === i
                    ? { ...x, name: e.target.value.replace(/[^a-zа-яё0-9_-]/gi, '').toLowerCase() } : x))} />
              </div>
              <textarea placeholder="Что бот ответит на эту команду" value={p.reply}
                onChange={e => setPairs(list => list.map((x, n) => n === i ? { ...x, reply: e.target.value } : x))} />
              {pairs.length > 1 && (
                <button className="bw-pair-x" title="Убрать"
                  onClick={() => setPairs(list => list.filter((_, n) => n !== i))}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          ))}
          {pairs.length < 15 && (
            <button className="pqs2-btn ghost" onClick={() => setPairs(list => [...list, { name: '', reply: '' }])}>
              <Icon name="plus" size={15} /> Ещё команда
            </button>
          )}
          <div className="cset-hint" style={{ marginTop: 8 }}>
            В ответе можно написать <code>{'{текст}'}</code> — туда подставится то, что человек
            допишет после команды. Например ответ «Привет, {'{текст}'}!» на <code>/привет Аня</code>
            даст «Привет, Аня!».
          </div>

          <label className="modal-lbl">Сразу поставить на сервер</label>
          <select className="modal-in" value={server} onChange={e => setServer(e.target.value)}>
            <option value="">Не ставить пока</option>
            {(servers ?? []).map(sv => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
          </select>

          <div className="modal-foot">
            <button className="modal-ghost" onClick={() => setKind(null)}>Назад</button>
            <button className="modal-primary" disabled={!!busy || !simpleName.trim() || !pairs.some(p => p.name.trim() && p.reply.trim())}
              onClick={() => void createSimple()}>
              {busy ? 'Создаю…' : 'Создать'}
            </button>
          </div>
        </>}

        {/* ── Свой: имя ──────────────────────────────────────────────────── */}
        {kind === 'own' && !made && <>
          <div className="modal-title">Свой бот</div>
          <div className="modal-sub">Сначала имя — остальное настроим сразу после создания, здесь же.</div>
          <label className="modal-lbl">Как назвать</label>
          <input className="modal-in" autoFocus placeholder="Например: Сторож" value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createOwn() }} />
          <div className="cset-hint" style={{ marginTop: 6 }}>
            Под этим именем бот появится в списке участников. Переименовать его на конкретном
            сервере можно будет в «Настройки сервера → Боты».
          </div>
          <div className="modal-foot">
            <button className="modal-ghost" onClick={() => setKind(null)}>Назад</button>
            <button className="modal-primary" disabled={!name.trim() || !!busy} onClick={() => void createOwn()}>
              {busy ? 'Создаю…' : 'Создать'}
            </button>
          </div>
        </>}

        {/* ── Свой: всё остальное на одном экране ────────────────────────── */}
        {kind === 'own' && made && <>
          <div className="modal-title">{name.trim()} готов</div>
          <div className="modal-sub">Осталось настроить. Всё можно поменять и потом, в списке своих ботов.</div>

          <div className="sset-info" style={{ marginTop: 12, alignItems: 'flex-start' }}>
            <Icon name="shield" size={16} />
            <div style={{ minWidth: 0 }}>
              <b>Токен и секрет видны только сейчас</b>
              <div className="cset-hint" style={{ marginTop: 2 }}>Второй раз их не покажет никто — сохрани в надёжном месте.</div>
              <div className="bw-secret"><code>{made.token}</code>
                <button className="pqs2-btn ghost" onClick={() => copy(made.token, 'Токен')}>Копировать</button></div>
              <div className="bw-secret"><code>{made.webhookSecret}</code>
                <button className="pqs2-btn ghost" onClick={() => copy(made.webhookSecret, 'Секрет')}>Копировать</button></div>
              <div className="bw-secret"><code>{made.id}</code>
                <button className="pqs2-btn ghost" onClick={() => copy(made.id, 'ID приложения')}>Копировать</button></div>
            </div>
          </div>

          <label className="modal-lbl">Куда NeyLivo будет слать события</label>
          <input className="modal-in" placeholder="https://твой-адрес/neylivo" value={webhook} onChange={e => setWebhook(e.target.value)} />
          <div className="cset-hint" style={{ marginTop: 4 }}>
            Можно оставить пустым и вписать позже. Без адреса бот просто молчит.
          </div>

          <label className="modal-lbl">Как он будет выглядеть</label>
          <div className="botp-row">
            <div className="botp-prev" style={banner.trim()
              ? { backgroundImage: `url(${banner.trim()})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: 'linear-gradient(160deg, #5865f2, #5865f2)' }}>
              <Avatar name={name.trim() || 'Бот'} url={avatar.trim() || null} userId={made.botUserId} size={48} />
              <div className="botp-prev-nm">{name.trim() || 'Бот'}<span className="bot-badge">БОТ</span></div>
            </div>
            <div className="botp-fields">
              <PicField label="Аватарка" value={avatar} onChange={setAvatar} />
              <PicField label="Шапка профиля" value={banner} onChange={setBanner} />
              <textarea className="cset-topic" maxLength={300} placeholder="О себе: что бот умеет" value={about} onChange={e => setAbout(e.target.value)} />
            </div>
          </div>

          <label className="modal-lbl">Первая команда (необязательно)</label>
          <div className="modal-inline">
            <input className="modal-in" style={{ flex: 1 }} placeholder="имя" value={cmdName}
              onChange={e => setCmdName(e.target.value.replace(/[^a-zа-яё0-9_-]/gi, ''))} />
            <input className="modal-in" style={{ flex: 2 }} placeholder="что делает" value={cmdDesc} onChange={e => setCmdDesc(e.target.value)} />
          </div>

          <label className="modal-lbl">Сразу поставить на сервер</label>
          <select className="modal-in" value={server} onChange={e => setServer(e.target.value)}>
            <option value="">Не ставить пока</option>
            {(servers ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="modal-foot">
            <button className="modal-ghost" onClick={onClose}>Закончу позже</button>
            <button className="modal-primary" disabled={!!busy} onClick={() => void finishOwn()}>
              {busy ? 'Сохраняю…' : 'Готово'}
            </button>
          </div>
        </>}
      </div>
    </div></Portal>
  )
}
