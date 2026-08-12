import { LIMITS_WARNING_SHORT } from '../lib/plugins/limits'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { parsePlugin } from '../lib/plugins/manifest'
import { loadPlugins, removePlugin, setEnabled, subscribePlugins, getPlugin, writeStorage, readStorage } from '../lib/plugins/store'
import { installPlugin } from '../lib/plugins/install'
import { PanelCanvas, AssetImg, KeybindRow } from './PluginPanels'
import { taskList, subscribeTasks, stopTaskByUser } from '../lib/plugins/background'
import { openSockets } from '../lib/plugins/wsHub'
import { appList, subscribeApps, closeAppByUser, updateApp, APP_MODES } from '../lib/plugins/apps'
import { GrantCreate, GrantList, GrantClaimBox } from './PluginGrants'
import { useAuth } from '../auth/AuthProvider'
import { startPlugin, stopPlugin, pluginError, isRunning, subscribePluginState, invokePlugin, emitToPlugin, pluginLogs, clearPluginLog } from '../lib/plugins/host'
import { useSettingsPages, type SettingsRow } from '../lib/plugins/registry'
import { PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type PluginManifest } from '../lib/plugins/types'
import { PermissionGate } from './PluginPermissionGate'
import { PluginCatalog } from './PluginCatalog'
import { PluginGuide } from './PluginGuide'
import { PluginEditor } from './PluginEditor'

// v1.286.0: раздел «Плагины» в настройках. Плагины ставятся на устройство, поэтому
// весь список локальный — ни таблицы, ни синхронизации между устройствами.

/** Страница настроек одного плагина — строки описаны самим плагином (см. registry). */
function PluginSettingsRows({ pluginId, rows }: { pluginId: string; rows: SettingsRow[] }) {
  // Значение, которое видно человеку, держим локально: плагин присылает строки один
  // раз при регистрации и не обязан перерисовывать их на каждое нажатие.
  const [local, setLocal] = useState<Record<string, unknown>>({})
  // v1.337.0: раньше запасным значением было r.value — то, что плагин прислал ОДИН
  // РАЗ при своей загрузке. Выбор сохранялся в хранилище плагина честно, но стоило
  // закрыть и открыть настройки заново, как строка снова показывала старое:
  // выглядело это ровно как «не сохраняется». Читаем текущее из хранилища.
  const valueOf = (r: SettingsRow & { value?: unknown }) => {
    if (r.key in local) return local[r.key]
    const saved = readStorage(pluginId, r.key)
    return saved === undefined ? r.value : saved
  }

  function change(key: string, value: unknown) {
    setLocal(v => ({ ...v, [key]: value }))
    writeStorage(pluginId, key, value)
    // Плагин узнаёт об изменении сразу, а не только когда сам заглянет в storage.
    emitToPlugin(pluginId, 'settings', { key, value })
  }

  return <>
    {rows.map(r => {
      switch (r.type) {
        case 'toggle': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <button className={'pqs-toggle' + (valueOf(r) ? ' on' : '')} onClick={() => change(r.key, !valueOf(r))}><span /></button>
          </div>
        )
        case 'text': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <input className="modal-in" style={{ maxWidth: 220 }} placeholder={r.placeholder}
              value={String(valueOf(r) ?? '')} onChange={e => change(r.key, e.target.value)} />
          </div>
        )
        case 'select': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <select className="modal-in" style={{ maxWidth: 220 }} value={String(valueOf(r) ?? '')} onChange={e => change(r.key, e.target.value)}>
              {r.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )
        case 'button': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <button className="pqs2-btn ghost" onClick={() => { void invokePlugin(pluginId, r.onClick, []) }}>Выполнить</button>
          </div>
        )
        // v1.419.0: те же строки, что и в панели плагина, — чтобы «показать
        // что-нибудь» он мог и на своей странице настроек, а не только всплывашкой.
        case 'label': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <b className="plugpanel-val notr" translate="no">{r.value}</b>
          </div>
        )
        case 'progress': return (
          <div key={r.key} className="pqs-optrow plug-optcol">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <div className="plugpanel-bar"><i style={{ width: Math.max(0, Math.min(100, r.value)) + '%' }} /></div>
          </div>
        )
        case 'slider': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <div className="plug-slider">
              <input type="range" className="plugpanel-range" min={r.min} max={r.max} step={r.step}
                value={Number(valueOf(r) ?? r.value)} onChange={e => change(r.key, Number(e.target.value))} />
              <b className="plugpanel-val">{String(valueOf(r) ?? r.value)}</b>
            </div>
          </div>
        )
        case 'color': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <input type="color" className="plugpanel-color" value={String(valueOf(r) ?? r.value)}
              onChange={e => change(r.key, e.target.value)} />
          </div>
        )
        case 'image': return (
          <div key={r.key} className="pqs-optrow plug-optcol">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <AssetImg pluginId={pluginId} className="plugpanel-img" src={r.value} alt={r.label} />
          </div>
        )
        // v1.467.0: выбор сочетания клавиш. Человек нажимает кнопку и жмёт
        // сочетание — приложение его запоминает И РЕГИСТРИРУЕТ (см. setKeybind).
        case 'keybind': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <KeybindRow pluginId={pluginId} rowKey={r.key} value={String(valueOf(r) ?? '')} onSet={v => change(r.key, v)} />
          </div>
        )
        // v1.465.0: холст рисуется и здесь. Объявить его на своей странице и не
        // увидеть было бы тем самым расхождением «показ против действия».
        case 'canvas': return (
          <div key={r.key} className="pqs-optrow plug-optcol">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <PanelCanvas pluginId={pluginId} row={r} />
          </div>
        )
      }
    })}
  </>
}

/**
 * Что плагин делает в фоне (v1.465.0).
 *
 * Смысл этого блока — не украшение. Разрешение background само по себе не даёт
 * плагину ничего такого, чего он не мог бы сделать обычным setInterval внутри
 * себя. Разница ровно здесь: заведённую через neylivo.background задачу ВИДНО —
 * с её сроком, с числом срабатываний и с кнопкой «остановить». Без этого блока
 * всё разрешение было бы пустой пометкой на карточке.
 *
 * Показываем и открытые соединения: плагин, который висит на чужом сервере,
 * тоже должен быть виден там, где его выключают.
 *
 * v1.488.0: и ОКНА — включая спрятанные. Повод прямой: в v1.487.0 у плагина
 * появилось право спрятать своё окно (apps.hide). Спрятанное окно живо: оно
 * считает, рисует, держит холст — а увидеть его человеку было негде вообще.
 * Право прятаться без строчки «спрятано, показать» — это способ работать
 * незаметно, и давать его молча нельзя.
 */
function PluginBackground({ pluginId }: { pluginId: string }) {
  const [, bump] = useState(0)
  useEffect(() => subscribeTasks(() => bump(v => v + 1)), [])
  useEffect(() => subscribeApps(() => bump(v => v + 1)), [])
  const tasks = taskList(pluginId)
  const socks = openSockets().filter(s => s.pluginId === pluginId)
  const окна = appList(pluginId)
  if (tasks.length === 0 && socks.length === 0 && окна.length === 0) return null
  return (
    <div className="plug-bg">
      {tasks.map(t => (
        <div key={t.id} className="plug-bg-row">
          <Icon name="clock" size={13} />
          <span className="plug-bg-t">{t.label}</span>
          <span className="plug-bg-d">раз в {Math.round(t.everyMs / 1000)} с · сработала {t.runs} раз</span>
          <button className="pqs2-btn ghost" onClick={() => { stopTaskByUser(t.id); bump(v => v + 1) }}>Остановить</button>
        </div>
      ))}
      {socks.map(s => (
        <div key={s.id} className="plug-bg-row">
          <Icon name="link" size={13} />
          <span className="plug-bg-t">Соединение</span>
          <span className="plug-bg-d notr" translate="no">{s.url.slice(0, 60)}</span>
        </div>
      ))}
      {окна.map(a => (
        <div key={a.id} className="plug-bg-row">
          <Icon name={a.hidden ? 'moon' : 'expand'} size={13} />
          <span className="plug-bg-t notr" translate="no">{a.title}</span>
          <span className="plug-bg-d">
            {APP_MODES[a.mode].split(',')[0].toLowerCase()}{a.hidden ? ' · спрятано' : ''}
          </span>
          {a.hidden && (
            <button className="pqs2-btn ghost" onClick={() => { updateApp(pluginId, a.id, { hidden: false }); bump(v => v + 1) }}>
              Показать
            </button>
          )}
          <button className="pqs2-btn ghost" onClick={() => { closeAppByUser(a.id); bump(v => v + 1) }}>
            Закрыть
          </button>
        </div>
      ))}
    </div>
  )
}

export function PluginsSettings() {
  const [, setVer] = useState(0)
  const [pending, setPending] = useState<{ manifest: PluginManifest; code: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [help, setHelp] = useState(false)
  // v1.336.0: три вкладки вместо одной ленты. Каталог, то что уже стоит, и своё —
  // это три разных дела: чтобы дойти до своих плагинов, раньше надо было
  // пролистать весь каталог.
  const [tab, setTab] = useState<'catalog' | 'installed' | 'mine' | 'grants'>('catalog')
  // v1.468.0: какой плагин передаём лично. Держим весь набор, а не один id:
  // передаче нужен сам файл, а он лежит в записи плагина.
  const [даём, setДаём] = useState<{ id: string; name: string; version: string; code: string } | null>(null)
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const pages = useSettingsPages()

  // Список и состояние запуска меняются не только отсюда (плагин может упасть сам),
  // поэтому перерисовываемся по обоим сигналам.
  useEffect(() => {
    const bump = () => setVer(v => v + 1)
    const a = subscribePlugins(bump)
    const b = subscribePluginState(bump)
    return () => { a(); b() }
  }, [])

  const plugins = loadPlugins()
  // «Свои» — те, что поставлены не из чата и подписаны твоим именем: собранные
  // здесь конструктором. Чужой плагин, скачанный из каталога, своим не считается,
  // даже если ты его правил у себя.
  const { user } = useAuth()
  const myName = (localStorage.getItem('ponoi_username') || '').trim().toLowerCase()
  // v1.363.0: свой — это сделанный в конструкторе, а не совпавший по имени
  // автора. Имя в шапке пишет тот, кто собрал файл: чужой плагин, подписанный
  // твоим ником, оказывался в «Своих» просто так.
  //
  // У плагинов, поставленных до этой версии, пометки нет — для них оставляем
  // прежнее правило, иначе они разом исчезли бы из вкладки.
  const isMine = (p: { manifest: { author: string }; sourceUserId: string | null; authoredHere?: boolean }) =>
    p.authoredHere !== undefined
      ? p.authoredHere
      : !p.sourceUserId && !!myName && p.manifest.author.trim().toLowerCase() === myName
  const mine = plugins.filter(isMine)

  async function pickFile(f: File | null) {
    if (fileRef.current) fileRef.current.value = ''
    if (!f) return
    try {
      const code = await f.text()
      setPending({ manifest: parsePlugin(code), code })
    } catch (err: any) {
      toastErr(err?.message ?? String(err))
    }
  }

  async function install() {
    if (!pending) return
    const { manifest, code } = pending
    setPending(null)
    try {
      // Файл выбрал сам человек: если он подписан его ником — считаем своим, как
      // и раньше. Из каталога так не пройдёт: там автор известен точно.
      const mineByName = !!myName && manifest.author.trim().toLowerCase() === myName
      await installPlugin(manifest, code, null, mineByName)
      toastOk(`Плагин «${manifest.name}» установлен`)
    } catch (err: any) {
      toastErr(`Плагин установлен, но не запустился: ${err?.message ?? err}`)
    }
  }

  async function toggle(id: string, on: boolean) {
    setEnabled(id, on)
    if (!on) { await stopPlugin(id); return }
    const p = getPlugin(id)
    if (p) { try { await startPlugin(p) } catch { /* причина уже в pluginError */ } }
  }

  async function remove(id: string, name: string) {
    if (!await confirmUi(`Удалить плагин «${name}» вместе с его данными?`, { okText: 'Удалить', danger: true })) return
    await stopPlugin(id)
    removePlugin(id)
    // v1.473.0: «вместе с его данными» — это обещание, и до этой версии оно не
    // выполнялось. removePlugin убирает запись и хранилище ключ-значение, а
    // таблицы (v1.472.0) и файлы оставались в IndexedDB навсегда: удалил плагин,
    // а его гигабайт лежит. Хуже того, поставь человек тот же плагин снова — он
    // нашёл бы там свои прежние данные, которые человек считал удалёнными.
    //
    // Грузится по требованию: экран плагинов не должен тянуть базу к себе.
    try {
      const [db, assets] = await Promise.all([import('../lib/plugins/db'), import('../lib/plugins/assets')])
      await db.dbDropAll(id)
      await assets.assetClear(id)
    } catch { /* базы может не быть вовсе — плагин всё равно удалён */ }
    toastOk('Плагин удалён')
  }

  return (
    <>
      <div className="pqs-sec-h">
        Плагины
        {/* v1.333.0: маленький «?» рядом с разделом — формат плагина раньше был
            описан только в исходниках, узнать его человеку было негде. */}
        <button className="help-q" title="Как сделать свой плагин" onClick={() => setHelp(true)}>?</button>
      </div>
      <div className="pqs-optd" style={{ marginBottom: 14 }}>
        Плагины расширяют NeyLivo: свои кнопки, команды и оформление. Выполняются в песочнице —
        доступ к твоему аккаунту и файлам у них закрыт. Ставятся на это устройство.
      </div>

      <div className="sec-tabs">
        <button className={'sec-tab' + (tab === 'catalog' ? ' on' : '')} onClick={() => setTab('catalog')}>
          <Icon name="store" size={15} /> Каталог
        </button>
        <button className={'sec-tab' + (tab === 'installed' ? ' on' : '')} onClick={() => setTab('installed')}>
          <Icon name="cube" size={15} /> Используемые
          {plugins.length > 0 && <span className="sec-tab-n">{plugins.length}</span>}
        </button>
        <button className={'sec-tab' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>
          <Icon name="edit" size={15} /> Свои
          {mine.length > 0 && <span className="sec-tab-n">{mine.length}</span>}
        </button>
        {/* v1.468.0: личные передачи. Отдельной вкладкой, потому что это не про
            установку и не про каталог: тут получают по коду и следят за своими
            выданными кодами. */}
        <button className={'sec-tab' + (tab === 'grants' ? ' on' : '')} onClick={() => setTab('grants')}>
          <Icon name="link" size={15} /> Передачи
        </button>
      </div>

      <input ref={fileRef} type="file" accept=".neylivo,.ponoi,.js,text/javascript" hidden
        onChange={e => void pickFile(e.target.files?.[0] ?? null)} />

      {tab === 'catalog' && <PluginCatalog inline />}


      {tab === 'grants' && <>
        <div className="pqs-sec-t">Получить по коду</div>
        <div className="pqs-optd" style={{ margin: '4px 0 10px' }}>
          Автор плагина может передать его лично — кодом, минуя каталог. Введи код,
          который он тебе дал: разрешения плагин попросит те же, что и любой другой.
        </div>
        <GrantClaimBox onInstalled={() => { setVer(v => v + 1); setTab('installed') }} />
        <div className="pqs-sec-t" style={{ marginTop: 18 }}>Мои передачи</div>
        <GrantList />
      </>}

      {tab === 'mine' && <>
        <div className="pqs-optd" style={{ margin: '12px 0' }}>
          Плагин собирается прямо здесь: форма пишет шапку файла, ты — только код.
          Готовые заготовки дают рабочий пример с первой секунды, а выложить его в
          каталог можно из того же окна — уходить никуда не надо.
        </div>
        <div className="modal-inline" style={{ gap: 8 }}>
          <button className="pqs2-btn" onClick={() => setEditing({})}>
            <Icon name="plus" size={16} /> Создать плагин
          </button>
          <button className="pqs2-btn ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="download" size={16} /> Поставить из файла
          </button>
        </div>
        {mine.length === 0 && <div className="modal-empty">Своих плагинов пока нет.</div>}
      </>}

      {tab === 'installed' && plugins.length === 0 && (
        <div className="modal-empty">Ни одного плагина не установлено. Загляни в каталог.</div>
      )}

      {(tab === 'installed' ? plugins : tab === 'mine' ? mine : []).map(p => {
        const err = pluginError(p.manifest.id)
        const page = pages.find(x => x.pluginId === p.manifest.id)
        const isOpen = open === p.manifest.id
        return (
          <div key={p.manifest.id} className="plug-card">
            <div className="plug-head">
              <div className="plug-name">
                {/* Своя картинка плагина, если он её задал (v1.349.0). */}
                {p.manifest.icon
                  ? <img className="plug-ic" src={p.manifest.icon} alt="" />
                  : <span className="plug-ic ph">🧩</span>}
                {p.manifest.name}
                <span className="plug-ver">{p.manifest.version}</span>
                {p.enabled && isRunning(p.manifest.id) && <span className="plug-dot on" title="Работает" />}
                {p.enabled && !isRunning(p.manifest.id) && <span className="plug-dot off" title="Не запустился" />}
              </div>
              <div className="plug-actions">
                {page && p.enabled && (
                  <button className="pqs2-btn ghost" onClick={() => setOpen(isOpen ? null : p.manifest.id)}>
                    <Icon name="gear" size={15} /> Настройки
                  </button>
                )}
                {/* v1.397.0: журнал плагина. В документации было написано, что
                    neylivo.log «видно в настройках плагина», — а видно его не было
                    нигде, кроме консоли браузера, которой в приложении нет. */}
                <button className={'pqs2-btn ghost' + (logOpen === p.manifest.id ? ' on' : '')}
                  title="Журнал плагина" onClick={() => setLogOpen(logOpen === p.manifest.id ? null : p.manifest.id)}>
                  <Icon name="code" size={15} />
                </button>
                {isMine(p) && (
                  <button className="pqs2-btn ghost" title="Изменить код" onClick={() => setEditing({ id: p.manifest.id })}>
                    <Icon name="edit" size={15} />
                  </button>
                )}
                <button className="pqs2-btn ghost danger" title="Удалить" onClick={() => void remove(p.manifest.id, p.manifest.name)}>
                  <Icon name="trash" size={15} />
                </button>
                <button className={'pqs-toggle' + (p.enabled ? ' on' : '')} onClick={() => void toggle(p.manifest.id, !p.enabled)}><span /></button>
              </div>
            </div>
            <div className="plug-sub">
              {p.manifest.description || 'без описания'} · автор: {p.manifest.author}
            </div>
            {p.manifest.permissions.length > 0 && (
              <div className="plug-perms-row">
                {p.manifest.permissions.map(perm => (
                  <span key={perm} className={'plug-chip' + (SENSITIVE_PERMISSIONS.includes(perm) ? ' warn' : '')}>{PERMISSION_LABEL[perm]}</span>
                ))}
              </div>
            )}
            {/* v1.446.0: у включённого плагина пределы по частоте почти сняты —
                напоминаем об этом там, где человек его выключает. */}
            {p.enabled && <div className="plug-note"><Icon name="shield" size={13} /> {LIMITS_WARNING_SHORT}</div>}
            {/* v1.465.0: что плагин делает, когда на него никто не смотрит.
                Ровно это и отличает разрешение background от обычного таймера
                внутри плагина: таймер не видно ниоткуда, а эти строки — видно,
                и рядом с каждой кнопка «остановить». */}
            <PluginBackground pluginId={p.manifest.id} />
            {/* v1.468.0: отдать свой плагин одному человеку, минуя каталог.
                Только для своих: передавать чужую работу нельзя. */}
            {isMine(p) && <div className="plug-give">
              <button className="pqs2-btn ghost" onClick={() => setДаём({
                id: p.manifest.id, name: p.manifest.name, version: p.manifest.version, code: p.code,
              })}><Icon name="link" size={14} /> Передать лично</button>
            </div>}
            {err && <div className="plug-err"><Icon name="flag" size={14} /> {err}</div>}
            {logOpen === p.manifest.id && (() => {
              const lines = pluginLogs(p.manifest.id)
              return (
                <div className="plug-log">
                  <div className="plug-log-head">
                    <b>Журнал</b>
                    <span>{lines.length ? 'строк: ' + lines.length : 'пусто'}</span>
                    <button className="pqs2-btn ghost" disabled={!lines.length}
                      onClick={() => { clearPluginLog(p.manifest.id); setVer(v => v + 1) }}>Очистить</button>
                  </div>
                  {lines.length === 0
                    ? <div className="plug-log-empty">Плагин ничего не писал. Вывод делается через neylivo.log, neylivo.warn и neylivo.error.</div>
                    : <div className="plug-log-body">
                        {lines.map((l, i) => (
                          <div key={i} className={'plug-log-l ' + l.level}>
                            <span className="plug-log-t">{new Date(l.at).toLocaleTimeString()}</span>
                            {l.text}
                          </div>
                        ))}
                      </div>}
                </div>
              )
            })()}
            {isOpen && page && (
              <div className="plug-settings">
                <PluginSettingsRows pluginId={p.manifest.id} rows={page.rows} />
              </div>
            )}
          </div>
        )
      })}

      {help && <PluginGuide onClose={() => setHelp(false)} />}
      {editing && (
        <PluginEditor editId={editing.id} onClose={() => setEditing(null)}
          onSaved={() => { setVer(v => v + 1); setTab('installed') }} />
      )}

      {/* v1.468.0: окно личной передачи — поверх всего, как и прочие окна. */}
      {даём && user && <GrantCreate meId={user.id} pluginId={даём.id} name={даём.name}
        version={даём.version} code={даём.code} onClose={() => setДаём(null)} />}

      {pending && (
        <PermissionGate
          code={pending.code}
          manifest={pending.manifest}
          existing={getPlugin(pending.manifest.id)}
          onCancel={() => setPending(null)}
          onConfirm={() => void install()}
        />
      )}
    </>
  )
}
