import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useAuth } from '../auth/AuthProvider'
import { createBot, addBotToServer, myBots, type BotApp } from '../lib/botApi'
import {
  fetchBotCatalog, publishBot, unpublishBot, countBotAdd, shorten,
  SUMMARY_MAX, DESC_MAX, type CatalogBot,
} from '../lib/catalog'
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
  adds?: number
  official: boolean
  appId?: string        // у выложенных людьми — id приложения
  kind?: string         // у готовых — вид встроенного бота
  authorId?: string
}

export function BotCatalog({ serverId, onAdded, onClose }: {
  serverId?: string
  onAdded?: () => void
  onClose: () => void
}) {
  const { user } = useAuth()
  const [rows, setRows] = useState<CatalogBot[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<Card | null>(null)
  const [busy, setBusy] = useState('')
  const [publishing, setPublishing] = useState(false)

  async function load() {
    const r = await fetchBotCatalog()
    setRows(r.items); setErr(r.error)
  }
  useEffect(() => { void load() }, [])

  const official: Card[] = BUILTIN_BOTS.map(b => ({
    key: 'builtin:' + b.kind, name: b.name, author: 'Ponoi', summary: b.summary,
    description: b.description, emoji: b.emoji, official: true, kind: b.kind,
  }))
  const community: Card[] = (rows ?? []).map(r => ({
    key: r.app_id, name: r.name, author: r.author_name, summary: r.summary, description: r.description,
    iconUrl: r.icon_url, adds: r.adds, official: false, appId: r.app_id, authorId: r.author_id,
  }))

  const term = q.trim().toLowerCase()
  const match = (c: Card) =>
    !term || c.name.toLowerCase().includes(term) || c.summary.toLowerCase().includes(term) || c.author.toLowerCase().includes(term)

  /** Готовый бот: заводим его под твоей учётной записью и сразу ставим на сервер. */
  async function addOfficial(c: Card) {
    if (!c.kind || !serverId) return
    setBusy(c.key)
    try {
      const made = await createBot(c.name, c.kind)
      await addBotToServer(made.id, serverId)
      toastOk(`Бот «${c.name}» добавлен на сервер`)
      onAdded?.()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy('') }
  }

  async function addCommunity(c: Card) {
    if (!c.appId || !serverId) return
    setBusy(c.key)
    try {
      await addBotToServer(c.appId, serverId)
      void countBotAdd(c.appId)
      toastOk(`Бот «${c.name}» добавлен на сервер`)
      onAdded?.()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy('') }
  }

  const add = (c: Card) => (c.official ? addOfficial(c) : addCommunity(c))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cat-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Каталог ботов</div>
        <div className="modal-sub">
          {serverId
            ? 'Бот становится обычным участником сервера: права, каналы и запреты у него те же, что у людей.'
            : 'Открой каталог из настроек сервера, чтобы можно было добавить бота сразу туда.'}
        </div>

        <div className="cat-top">
          <div className="cat-search">
            <span className="cat-si"><Icon name="search" size={16} /></span>
            <input placeholder="Поиск по названию, описанию или автору" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="pqs2-btn ghost" onClick={() => setPublishing(true)}>
            <Icon name="plus" size={15} /> Выложить своего
          </button>
        </div>

        <div className="cat-body">
          <div className="cat-sec">От создателей Ponoi</div>
          <div className="cat-grid">
            {official.filter(match).map(c => (
              <BotCardView key={c.key} c={c} busy={busy === c.key} canAdd={!!serverId}
                onOpen={() => setDetail(c)} onAdd={() => void add(c)} />
            ))}
          </div>

          <div className="cat-sec">Выложили люди{community.length > 0 && ` — ${community.length}`}</div>
          {rows === null && <div className="cat-hint">Загружаю…</div>}
          {err && <div className="cat-hint">{err}</div>}
          {rows !== null && !err && community.length === 0 && (
            <div className="cat-hint">Пока никто ничего не выложил. Свой бот из «Мои приложения» выкладывается кнопкой выше.</div>
          )}
          <div className="cat-grid">
            {community.filter(match).map(c => (
              <BotCardView key={c.key} c={c} busy={busy === c.key} canAdd={!!serverId}
                onOpen={() => setDetail(c)} onAdd={() => void add(c)}
                onRemove={user && c.authorId === user.id ? async () => {
                  if (!await confirmUi(`Убрать «${c.name}» из каталога? С серверов, где он уже стоит, бот не пропадёт.`, { okText: 'Убрать', danger: true })) return
                  try { await unpublishBot(c.appId!); toastOk('Убрано из каталога'); void load() }
                  catch (e: any) { toastErr(e?.message ?? String(e)) }
                } : undefined} />
            ))}
          </div>
        </div>

        {detail && <BotDetail c={detail} canAdd={!!serverId} onClose={() => setDetail(null)}
          onAdd={() => { void add(detail); setDetail(null) }} />}
        {publishing && <PublishBotModal onClose={() => setPublishing(false)} onDone={() => { setPublishing(false); void load() }} />}
      </div>
    </div>
  )
}

function BotCardView({ c, busy, canAdd, onOpen, onAdd, onRemove }: {
  c: Card; busy: boolean; canAdd: boolean; onOpen: () => void; onAdd: () => void; onRemove?: () => void
}) {
  return (
    <div className="cat-card" onClick={onOpen}>
      <div className="cat-ic">
        {c.iconUrl ? <img src={c.iconUrl} alt="" /> : <span className="cat-emoji">{c.emoji ?? '🤖'}</span>}
      </div>
      <div className="cat-tx">
        <div className="cat-nm">{c.name}{c.official && <span className="cat-badge">от Ponoi</span>}</div>
        <div className="cat-sum">{shorten(c.summary)}</div>
        <div className="cat-meta">
          <span>{c.author}</span>
          {typeof c.adds === 'number' && <><span className="cat-dot" />{c.adds} добавлений</>}
        </div>
      </div>
      <div className="cat-acts" onClick={e => e.stopPropagation()}>
        <button className="pqs2-btn" disabled={busy || !canAdd}
          title={canAdd ? undefined : 'Открой каталог из настроек сервера'}
          onClick={onAdd}>{busy ? 'Добавляю…' : 'Добавить'}</button>
        {onRemove && <button className="pqs2-btn ghost danger" title="Убрать из каталога" onClick={onRemove}><Icon name="trash" size={14} /></button>}
      </div>
    </div>
  )
}

function BotDetail({ c, canAdd, onClose, onAdd }: { c: Card; canAdd: boolean; onClose: () => void; onAdd: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
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
          Он заводится под твоей учётной записью — удалить его можно в «Мои приложения».
        </div>}
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Закрыть</button>
          <button className="modal-primary" disabled={!canAdd} onClick={onAdd}>Добавить на сервер</button>
        </div>
      </div>
    </div>
  )
}

function PublishBotModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth()
  const [bots, setBots] = useState<BotApp[] | null>(null)
  const [pick, setPick] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { myBots().then(b => { setBots(b); setPick(b[0]?.id ?? '') }) }, [])
  const chosen = (bots ?? []).find(b => b.id === pick)

  async function go() {
    if (!chosen || !user) return
    if (!summary.trim()) { toastErr('Короткое описание обязательно — по нему выбирают в списке'); return }
    if (icon.trim() && !/^https:\/\//i.test(icon.trim())) { toastErr('Ссылка на картинку должна начинаться с https://'); return }
    setBusy(true)
    try {
      await publishBot({
        app_id: chosen.id, name: chosen.name, summary: summary.trim(),
        description: description.trim(), icon_url: icon.trim() || null,
      }, user.id)
      toastOk('Бот в каталоге')
      onDone()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Выложить бота</div>
        <div className="modal-sub">В каталог попадает только id приложения и описание — токен и секрет не уходят никуда.</div>

        {bots === null ? <div className="cat-hint">Загружаю…</div>
          : bots.length === 0 ? <div className="cat-hint">Сначала заведи бота в «Мои приложения» — потом его можно будет выложить.</div>
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

            <label className="modal-lbl">Картинка (ссылка https, необязательно)</label>
            <input className="modal-in" value={icon} onChange={e => setIcon(e.target.value)} placeholder="https://…/icon.png" />

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
    </div>
  )
}
