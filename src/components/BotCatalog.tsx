import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useAuth } from '../auth/AuthProvider'
import { createBot, addBotToServer, deleteBot, myBots, botsOnServer, serversForBots, type BotApp } from '../lib/botApi'
import {
  fetchBotCatalog, publishBot, unpublishBot, countInstall, fetchInstallCounts, shorten,
  SUMMARY_MAX, DESC_MAX, type CatalogBot,
} from '../lib/catalog'
import { fmtAdds } from './PluginCatalog'
import { PicField } from './PicField'
import { BUILTIN_BOTS } from '../lib/builtinBots'

// v1.333.0: каталог ботов — то же, что каталог плагинов, только про ботов.
// Готовые боты «от нас» работают без своего сервера: их логика выполняется в
// наших же функциях (supabase/functions/_shared/builtinBots.ts), поэтому кнопка
// «Добавить» ставит рабочего бота, а не заготовку.

interface Card {
  key: string
  name: string
  author: string
  summary: string
  description: string | null
  emoji?: string
  iconUrl?: string | null
  bannerUrl?: string | null
  adds?: number
  official: boolean
  appId?: string        // у выложенных людьми — id приложения
  kind?: string         // у готовых — вид встроенного бота
  authorId?: string
}

/**
 * Каталог всегда встроен в страницу: окно поверх окна убрано в v1.336.0.
 * Параметр inline оставлен, чтобы вызов читался однозначно.
 */
export function BotCatalog({ serverId, onAdded, inline: _inline }: {
  serverId?: string
  onAdded?: () => void
  inline?: boolean
}) {
  const { user } = useAuth()
  // Каталог открыт не из сервера (раздел «Боты» в настройках) — тогда сервер
  // выбирается прямо здесь. Иначе половина каталога была бы серой и непонятно
  // почему: «Добавить» есть, а нажать нельзя.
  // v1.355.0: в списке только серверы, куда я действительно вправе ставить ботов —
  // свои и те, где моей роли выдали «Управление ботами». Раньше тут были все
  // подряд, и на чужом сервере «Добавить» просто падало отказом: выглядело как
  // поломка, а не как отсутствие права.
  const [servers, setServers] = useState<{ id: string; name: string }[] | null>(null)
  const [pickedServer, setPickedServer] = useState('')
  useEffect(() => {
    if (serverId) return
    serversForBots().then(list => {
      setServers(list)
      setPickedServer(prev => prev || (list[0]?.id ?? ''))
    }).catch(() => setServers([]))
  }, [serverId])
  const target = serverId ?? pickedServer

  // Кто уже стоит на выбранном сервере: карточка такого бота показывает
  // «Уже на сервере» вместо «Добавить». Сервер откажет и так, но у готовых ботов
  // отказ приходит уже ПОСЛЕ того, как заведено новое бот-приложение, и каждый
  // промах оставлял бы за собой мусор.
  const [onServer, setOnServer] = useState<{ apps: Set<string>; kinds: Set<string> }>({ apps: new Set(), kinds: new Set() })
  const reloadOnServer = () => {
    if (!target) { setOnServer({ apps: new Set(), kinds: new Set() }); return }
    botsOnServer(target).then(list => setOnServer({
      apps: new Set(list.map(b => b.appId)),
      kinds: new Set(list.map(b => b.builtin).filter(Boolean) as string[]),
    })).catch(() => { /* не смогли узнать — просто не подсвечиваем, сервер всё равно откажет */ })
  }
  useEffect(reloadOnServer, [target])
  const alreadyAdded = (c: Card) => c.official ? (!!c.kind && onServer.kinds.has(c.kind)) : (!!c.appId && onServer.apps.has(c.appId))
  const [rows, setRows] = useState<CatalogBot[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<Card | null>(null)
  const [busy, setBusy] = useState('')
  const [publishing, setPublishing] = useState(false)

  async function load() {
    const r = await fetchBotCatalog()
    setRows(r.items); setErr(r.error)
    setCounts(await fetchInstallCounts('bot'))
  }
  useEffect(() => { void load() }, [])

  const official: Card[] = BUILTIN_BOTS.map(b => ({
    key: 'builtin:' + b.kind, name: b.name, author: 'Ponoi', summary: b.summary,
    description: b.description, emoji: b.emoji, official: true, kind: b.kind,
    adds: counts['builtin:' + b.kind] ?? 0,
  }))
  const community: Card[] = (rows ?? []).map(r => ({
    key: r.app_id, name: r.name, author: r.author_name, summary: r.summary, description: r.description,
    iconUrl: r.icon_url, bannerUrl: r.banner_url, adds: counts[r.app_id] ?? r.adds,
    official: false, appId: r.app_id, authorId: r.author_id,
  }))

  const term = q.trim().toLowerCase()
  const match = (c: Card) =>
    !term || c.name.toLowerCase().includes(term) || c.summary.toLowerCase().includes(term) || c.author.toLowerCase().includes(term)

  /** Готовый бот: заводим его под твоей учётной записью и сразу ставим на сервер. */
  async function addOfficial(c: Card) {
    if (!c.kind || !target) return
    setBusy(c.key)
    try {
      const made = await createBot(c.name, c.kind)
      try {
        await addBotToServer(made.id, target)
      } catch (e) {
        // Готового бота заводим ДО постановки на сервер, поэтому отказ на втором
        // шаге (успели добавить с другого устройства, отобрали право) оставлял бы
        // за собой ничейное бот-приложение. Прибираем за собой и показываем
        // исходную причину, а не «не удалось удалить».
        await deleteBot(made.id).catch(() => { /* не вышло убрать — причина важнее */ })
        throw e
      }
      // Готовых считаем по виду: своего приложения у них каждый раз новое, а
      // «сколько раз брали Кубика» — про самого Кубика.
      void countInstall('bot', 'builtin:' + c.kind).then(() => void load())
      toastOk(`Бот «${c.name}» добавлен на сервер`)
      reloadOnServer()
      onAdded?.()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy('') }
  }

  async function addCommunity(c: Card) {
    if (!c.appId || !target) return
    setBusy(c.key)
    try {
      await addBotToServer(c.appId, target)
      void countInstall('bot', c.appId).then(() => void load())
      toastOk(`Бот «${c.name}» добавлен на сервер`)
      reloadOnServer()
      onAdded?.()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy('') }
  }

  const add = (c: Card) => (c.official ? addOfficial(c) : addCommunity(c))

  const body = <>
        <div className="cat-top">
          <div className="cat-search">
            <span className="cat-si"><Icon name="search" size={16} /></span>
            <input placeholder="Поиск по названию, описанию или автору" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {!serverId && (
            <select className="modal-in cat-srv" value={pickedServer} onChange={e => setPickedServer(e.target.value)}
              title="Куда добавлять бота">
              {(servers ?? []).length === 0 && <option value="">Некуда добавлять</option>}
              {(servers ?? []).map(sv => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
            </select>
          )}
          <button className="pqs2-btn ghost" onClick={() => setPublishing(true)}>
            <Icon name="plus" size={15} /> Выложить своего
          </button>
        </div>

        <div className="cat-body">
          <div className="cat-sec">От создателей Ponoi</div>
          <div className="cat-grid">
            {official.filter(match).map(c => (
              <BotCardView key={c.key} c={c} busy={busy === c.key} canAdd={!!target} added={alreadyAdded(c)}
                onOpen={() => setDetail(c)} onAdd={() => void add(c)} />
            ))}
          </div>

          <div className="cat-sec">Выложили люди{community.length > 0 && ` — ${community.length}`}</div>
          {rows === null && <div className="cat-hint">Загружаю…</div>}
          {err && <div className="cat-hint">{err}</div>}
          {rows !== null && !err && community.length === 0 && (
            <div className="cat-hint">Пока никто ничего не выложил. Своего бота из списка ниже можно выложить кнопкой выше.</div>
          )}
          <div className="cat-grid">
            {community.filter(match).map(c => (
              <BotCardView key={c.key} c={c} busy={busy === c.key} canAdd={!!target} added={alreadyAdded(c)}
                onOpen={() => setDetail(c)} onAdd={() => void add(c)}
                onRemove={user && c.authorId === user.id ? async () => {
                  if (!await confirmUi(`Убрать «${c.name}» из каталога? С серверов, где он уже стоит, бот не пропадёт.`, { okText: 'Убрать', danger: true })) return
                  try { await unpublishBot(c.appId!); toastOk('Убрано из каталога'); void load() }
                  catch (e: any) { toastErr(e?.message ?? String(e)) }
                } : undefined} />
            ))}
          </div>
        </div>

        {detail && <BotDetail c={detail} canAdd={!!target} onClose={() => setDetail(null)}
          onAdd={() => { void add(detail); setDetail(null) }} />}
        {publishing && <PublishBotModal onClose={() => setPublishing(false)} onDone={() => { setPublishing(false); void load() }} />}
  </>

  return <div className="cat-inline">{body}</div>
}

function BotCardView({ c, busy, canAdd, added, onOpen, onAdd, onRemove }: {
  c: Card; busy: boolean; canAdd: boolean; added?: boolean; onOpen: () => void; onAdd: () => void; onRemove?: () => void
}) {
  return (
    <div className="cat-tile" onClick={onOpen}>
      <div className={'cat-tile-bg' + (c.bannerUrl ? '' : ' plain')}
        style={c.bannerUrl ? { backgroundImage: 'url(' + c.bannerUrl + ')' } : undefined} />
      <div className="cat-tile-ic">
        {c.iconUrl ? <img src={c.iconUrl} alt="" /> : <span className="cat-emoji">{c.emoji ?? '🤖'}</span>}
      </div>
      <div className="cat-tile-body">
        <div className="cat-nm">{c.name}{c.official && <span className="cat-badge">от Ponoi</span>}</div>
        <div className="cat-sum">{shorten(c.summary)}</div>
        <div className="cat-meta">
          <span className="cat-author">{c.author}</span>
          <span className="cat-dot" />
          <span title="Сколько раз добавляли на серверы">{fmtAdds(c.adds ?? 0)}</span>
        </div>
        <div className="cat-acts" onClick={e => e.stopPropagation()}>
          <button className="pqs2-btn" disabled={busy || !canAdd || added}
            title={added ? 'Этот бот уже стоит на выбранном сервере'
              : canAdd ? undefined : 'Сначала нужен сервер, куда добавлять'}
            onClick={onAdd}>{added ? 'Уже на сервере' : busy ? 'Добавляю…' : 'Добавить'}</button>
          {onRemove && <button className="pqs2-btn ghost danger" title="Убрать из каталога" onClick={onRemove}><Icon name="trash" size={14} /></button>}
        </div>
      </div>
    </div>
  )
}

function BotDetail({ c, canAdd, onClose, onAdd }: { c: Card; canAdd: boolean; onClose: () => void; onAdd: () => void }) {
  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="cat-detail-h">
          <div className="cat-ic big">{c.iconUrl ? <img src={c.iconUrl} alt="" /> : <span className="cat-emoji">{c.emoji ?? '🤖'}</span>}</div>
          <div>
            <div className="modal-title" style={{ margin: 0 }}>{c.name}</div>
            <div className="cat-meta"><span>{c.author}</span>{c.official && <span className="cat-badge">от Ponoi</span>}</div>
          </div>
        </div>
        <div className="cat-desc">{c.description || c.summary}</div>
        {c.official && <div className="cset-hint">
          Готовый бот работает сразу: свой сервер для него не нужен, всё считается внутри Ponoi.
          Он заводится под твоей учётной записью — удалить его можно в разделе «Боты» (Настройки пользователя).
        </div>}
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Закрыть</button>
          <button className="modal-primary" disabled={!canAdd} onClick={onAdd}>Добавить на сервер</button>
        </div>
      </div>
    </div></Portal>
  )
}

function PublishBotModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth()
  const [bots, setBots] = useState<BotApp[] | null>(null)
  const [pick, setPick] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [banner, setBanner] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { myBots().then(b => { setBots(b); setPick(b[0]?.id ?? '') }) }, [])
  const chosen = (bots ?? []).find(b => b.id === pick)

  async function go() {
    if (!chosen || !user) return
    if (!summary.trim()) { toastErr('Короткое описание обязательно — по нему выбирают в списке'); return }
    for (const [v, what] of [[icon, 'значок'], [banner, 'фон']] as const) {
      if (v.trim() && !/^https:\/\//i.test(v.trim())) { toastErr('Ссылка на ' + what + ' должна начинаться с https://'); return }
    }
    setBusy(true)
    try {
      await publishBot({
        app_id: chosen.id, name: chosen.name, summary: summary.trim(),
        description: description.trim(), icon_url: icon.trim() || null,
        banner_url: banner.trim() || null,
      }, user.id)
      toastOk('Бот в каталоге')
      onDone()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Выложить бота</div>
        <div className="modal-sub">В каталог попадает только id приложения и описание — токен и секрет не уходят никуда.</div>

        {bots === null ? <div className="cat-hint">Загружаю…</div>
          : bots.length === 0 ? <div className="cat-hint">Сначала заведи своего бота ниже, в «Мои боты», — потом его можно будет выложить.</div>
          : <>
            <label className="modal-lbl">Какой бот</label>
            <select className="modal-in" value={pick} onChange={e => setPick(e.target.value)}>
              {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>

            <label className="modal-lbl">Короткое описание — его видно в списке</label>
            <input className="modal-in" maxLength={SUMMARY_MAX} value={summary} onChange={e => setSummary(e.target.value)}
              placeholder="Одной строкой: что он умеет" />
            <div className="cset-hint" style={{ marginTop: 4 }}>{summary.length}/{SUMMARY_MAX}</div>

            <label className="modal-lbl">Полное описание — в карточке</label>
            <textarea className="cset-topic" maxLength={DESC_MAX} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Команды, что настраивается, куда писать, если сломался" />

            <PicField label="Значок" value={icon} onChange={setIcon} />
            <PicField label="Фон карточки" value={banner} onChange={setBanner} />
            <div className="cat-preview">
              <div className="cat-tile as-preview">
                <div className={'cat-tile-bg' + (banner.trim() ? '' : ' plain')}
                  style={banner.trim() ? { backgroundImage: 'url(' + banner.trim() + ')' } : undefined} />
                <div className="cat-tile-ic">
                  {icon.trim() ? <img src={icon.trim()} alt="" /> : <span className="cat-emoji">🤖</span>}
                </div>
                <div className="cat-tile-body">
                  <div className="cat-nm">{chosen?.name ?? 'Бот'}</div>
                  <div className="cat-sum">{shorten(summary || 'Короткое описание появится здесь')}</div>
                </div>
              </div>
              <div className="cset-hint" style={{ marginTop: 0 }}>Так плитка будет выглядеть в каталоге.</div>
            </div>

            <div className="cset-hint" style={{ marginTop: 10 }}>
              Бот в каталоге — твоя ответственность: он ходит по серверам под твоим именем.
              Если его выключить, у людей он просто перестанет отвечать.
            </div>

            <div className="modal-foot">
              <button className="modal-ghost" onClick={onClose}>Отмена</button>
              <button className="modal-primary" disabled={busy || !chosen} onClick={go}>{busy ? 'Выкладываю…' : 'Выложить'}</button>
            </div>
          </>}
      </div>
    </div></Portal>
  )
}
