import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useAuth } from '../auth/AuthProvider'
import { parsePlugin } from '../lib/plugins/manifest'
import { installPlugin } from '../lib/plugins/install'
import { getPlugin, loadPlugins } from '../lib/plugins/store'
import { OFFICIAL_PLUGINS } from '../lib/plugins/official'
import { PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type Permission, type PluginManifest } from '../lib/plugins/types'
import { PermissionGate } from './PluginPermissionGate'
import { PicField } from './PicField'
import {
  fetchPluginCatalog, publishPlugin, unpublishPlugin, countInstall, fetchInstallCounts, shorten,
  SUMMARY_MAX, DESC_MAX, type CatalogPlugin,
} from '../lib/catalog'

// v1.333.0: каталог плагинов — общее место, куда любой выкладывает своё и откуда
// любой ставит чужое. Раньше поделиться плагином можно было только файлом в чат.
//
// В списке намеренно мало: картинка, название, автор и КОРОТКОЕ описание. Полное
// живёт в карточке — иначе десяток плагинов не помещается на экран и выбирать
// приходится не глядя.

/** Одна строка каталога — и для официальных, и для выложенных людьми. */
interface Card {
  id: string
  name: string
  author: string
  summary: string
  description: string | null
  emoji?: string
  iconUrl?: string | null
  bannerUrl?: string | null
  permissions: Permission[]
  installs?: number
  official: boolean
  code: string
  version: string
  authorId?: string
}

function officialCards(): Card[] {
  return OFFICIAL_PLUGINS.map(p => {
    const m = parsePlugin(p.code)
    return {
      id: m.id, name: m.name, author: m.author, summary: p.summary, description: m.description,
      emoji: p.emoji, permissions: m.permissions, official: true, code: p.code, version: m.version,
      iconUrl: m.icon, bannerUrl: m.banner, installs: 0,
    }
  })
}

function toCard(r: CatalogPlugin): Card {
  return {
    id: r.id, name: r.name, author: r.author_name, summary: r.summary, description: r.description,
    iconUrl: r.icon_url, bannerUrl: r.banner_url, permissions: (r.permissions ?? []) as Permission[], installs: r.installs,
    official: false, code: r.code, version: r.version, authorId: r.author_id,
  }
}

/**
 * Каталог всегда встроен в страницу настроек: окно поверх окна было лишним
 * шагом, и с v1.336.0 раздел показывает каталог сразу. Параметр inline остался
 * для читаемости вызывающего кода.
 */
export function PluginCatalog({ inline: _inline }: { inline?: boolean }) {
  const { user } = useAuth()
  const [rows, setRows] = useState<CatalogPlugin[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<Card | null>(null)
  const [pending, setPending] = useState<{ manifest: PluginManifest; code: string; card: Card } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [, setVer] = useState(0)

  async function load() {
    const r = await fetchPluginCatalog()
    setRows(r.items)
    setErr(r.error)
    setCounts(await fetchInstallCounts('plugin'))
  }
  useEffect(() => { void load() }, [])

  const withCount = (c: Card): Card => ({ ...c, installs: counts[c.id] ?? c.installs ?? 0 })
  const official = officialCards().map(withCount)
  const community = (rows ?? []).map(toCard).map(withCount)
  const term = q.trim().toLowerCase()
  const match = (c: Card) =>
    !term || c.name.toLowerCase().includes(term) || c.summary.toLowerCase().includes(term) || c.author.toLowerCase().includes(term)

  function beginInstall(c: Card) {
    try {
      setPending({ manifest: parsePlugin(c.code), code: c.code, card: c })
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
  }

  async function doInstall() {
    if (!pending) return
    const { manifest, code, card } = pending
    setPending(null)
    try {
      await installPlugin(manifest, code)
      // Считаем установку и у готовых «от нас»: число под карточкой должно быть
      // у всех, иначе непонятно, чем плитки отличаются.
      void countInstall('plugin', card.id).then(() => void load())
      setVer(v => v + 1)
      toastOk(`Плагин «${manifest.name}» установлен`)
    } catch (e: any) {
      toastErr(`Плагин установлен, но не запустился: ${e?.message ?? e}`)
    }
  }

  const body = <>
        <div className="cat-top">
          <div className="cat-search">
            <span className="cat-si"><Icon name="search" size={16} /></span>
            <input placeholder="Поиск по названию, описанию или автору" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="pqs2-btn ghost" onClick={() => setPublishing(true)}>
            <Icon name="plus" size={15} /> Выложить свой
          </button>
        </div>

        <div className="cat-body">
          <div className="cat-sec">От создателей Ponoi</div>
          <div className="cat-grid">
            {official.filter(match).map(c => (
              <CardView key={c.id} c={c} onOpen={() => setDetail(c)} onInstall={() => beginInstall(c)} />
            ))}
          </div>

          <div className="cat-sec">Выложили люди{community.length > 0 && ` — ${community.length}`}</div>
          {rows === null && <div className="cat-hint">Загружаю…</div>}
          {err && <div className="cat-hint">{err}</div>}
          {rows !== null && !err && community.length === 0 && (
            <div className="cat-hint">Пока никто ничего не выложил. Первым можешь стать ты — кнопка «Выложить свой».</div>
          )}
          <div className="cat-grid">
            {community.filter(match).map(c => (
              <CardView key={c.id} c={c} onOpen={() => setDetail(c)} onInstall={() => beginInstall(c)}
                onRemove={user && c.authorId === user.id ? async () => {
                  if (!await confirmUi(`Убрать «${c.name}» из каталога? Установленный у людей плагин останется у них.`, { okText: 'Убрать', danger: true })) return
                  try { await unpublishPlugin(c.id); toastOk('Убрано из каталога'); void load() }
                  catch (e: any) { toastErr(e?.message ?? String(e)) }
                } : undefined} />
            ))}
          </div>
        </div>

        {detail && <DetailModal c={detail} onClose={() => setDetail(null)} onInstall={() => { beginInstall(detail); setDetail(null) }} />}
        {pending && (
          <PermissionGate code={pending.code} manifest={pending.manifest} existing={getPlugin(pending.manifest.id)}
            onCancel={() => setPending(null)} onConfirm={() => void doInstall()} />
        )}
        {publishing && <PublishModal onClose={() => setPublishing(false)} onDone={() => { setPublishing(false); void load() }} />}
  </>

  return <div className="cat-inline">{body}</div>
}

/** «12 установок» с правильным окончанием — число без подписи ничего не говорит. */
export function fmtInstalls(n: number): string {
  const d = n % 100
  const word = d >= 11 && d <= 14 ? 'установок'
    : n % 10 === 1 ? 'установка'
    : n % 10 >= 2 && n % 10 <= 4 ? 'установки'
    : 'установок'
  return n + ' ' + word
}

/** То же для ботов: их не «ставят», а добавляют на сервер. */
export function fmtAdds(n: number): string {
  const d = n % 100
  const word = d >= 11 && d <= 14 ? 'добавлений'
    : n % 10 === 1 ? 'добавление'
    : n % 10 >= 2 && n % 10 <= 4 ? 'добавления'
    : 'добавлений'
  return n + ' ' + word
}

function CardView({ c, onOpen, onInstall, onRemove }: {
  c: Card; onOpen: () => void; onInstall: () => void; onRemove?: () => void
}) {
  const installed = !!getPlugin(c.id)
  const sensitive = c.permissions.filter(p => SENSITIVE_PERMISSIONS.includes(p))
  return (
    <div className="cat-tile" onClick={onOpen}>
      <div className={'cat-tile-bg' + (c.bannerUrl ? '' : ' plain')}
        style={c.bannerUrl ? { backgroundImage: `url(${c.bannerUrl})` } : undefined} />
      <div className="cat-tile-ic">
        {c.iconUrl ? <img src={c.iconUrl} alt="" /> : <span className="cat-emoji">{c.emoji ?? '🧩'}</span>}
      </div>
      <div className="cat-tile-body">
        <div className="cat-nm">
          {c.name}
          {c.official && <span className="cat-badge">от Ponoi</span>}
          {installed && <span className="cat-badge on">стоит</span>}
        </div>
        <div className="cat-sum">{shorten(c.summary)}</div>
        <div className="cat-meta">
          <span className="cat-author">{c.author}</span>
          <span className="cat-dot" />
          <span title="Сколько раз ставили">{fmtInstalls(c.installs ?? 0)}</span>
          {sensitive.length > 0 && <span className="cat-warn" title={sensitive.map(p => PERMISSION_LABEL[p]).join(', ')}>
            <Icon name="shield" size={12} />
          </span>}
        </div>
        <div className="cat-acts" onClick={e => e.stopPropagation()}>
          <button className="pqs2-btn" onClick={onInstall}>{installed ? 'Переустановить' : 'Установить'}</button>
          {onRemove && <button className="pqs2-btn ghost danger" title="Убрать из каталога" onClick={onRemove}><Icon name="trash" size={14} /></button>}
        </div>
      </div>
    </div>
  )
}

function DetailModal({ c, onClose, onInstall }: { c: Card; onClose: () => void; onInstall: () => void }) {
  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="cat-detail-h">
          <div className="cat-ic big">{c.iconUrl ? <img src={c.iconUrl} alt="" /> : <span className="cat-emoji">{c.emoji ?? '🧩'}</span>}</div>
          <div>
            <div className="modal-title" style={{ margin: 0 }}>{c.name} <span className="plug-ver">{c.version}</span></div>
            <div className="cat-meta"><span>{c.author}</span>{c.official && <span className="cat-badge">от Ponoi</span>}</div>
          </div>
        </div>
        <div className="cat-desc">{c.description || c.summary}</div>
        {c.permissions.length > 0 && <>
          <label className="modal-lbl">Плагин сможет</label>
          {c.permissions.map(p => (
            <div key={p} className={'plug-perm' + (SENSITIVE_PERMISSIONS.includes(p) ? ' warn' : '')}>
              <Icon name={SENSITIVE_PERMISSIONS.includes(p) ? 'shield' : 'check'} size={15} />
              <span>{PERMISSION_LABEL[p]}</span>
            </div>
          ))}
        </>}
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Закрыть</button>
          <button className="modal-primary" onClick={onInstall}>Установить</button>
        </div>
      </div>
    </div></Portal>
  )
}

/** Выложить свой плагин: берём уже установленный — значит он точно запускается. */
function PublishModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth()
  const installed = loadPlugins()
  const [pick, setPick] = useState(installed[0]?.manifest.id ?? '')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [banner, setBanner] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = installed.find(p => p.manifest.id === pick)

  useEffect(() => {
    if (chosen && !summary) setSummary(shorten(chosen.manifest.description, SUMMARY_MAX))
  }, [pick])

  async function go() {
    if (!chosen || !user) return
    if (!summary.trim()) { toastErr('Короткое описание обязательно — по нему выбирают в списке'); return }
    for (const [v, what] of [[icon, 'значок'], [banner, 'фон']] as const) {
      if (v.trim() && !/^https:\/\//i.test(v.trim())) { toastErr('Ссылка на ' + what + ' должна начинаться с https://'); return }
    }
    setBusy(true)
    try {
      await publishPlugin({
        id: chosen.manifest.id, name: chosen.manifest.name, version: chosen.manifest.version,
        summary: summary.trim(), description: description.trim(),
        icon_url: icon.trim() || null, banner_url: banner.trim() || null,
        code: chosen.code, permissions: chosen.manifest.permissions,
      }, user.id)
      toastOk('Плагин в каталоге')
      onDone()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Выложить плагин</div>
        <div className="modal-sub">Выкладывается плагин, установленный у тебя, — так в каталог не попадёт то, что даже не запускается.</div>

        {installed.length === 0
          ? <div className="cat-hint">Сначала установи свой плагин из файла — потом его можно будет выложить.</div>
          : <>
            <label className="modal-lbl">Какой плагин</label>
            <select className="modal-in" value={pick} onChange={e => setPick(e.target.value)}>
              {installed.map(p => <option key={p.manifest.id} value={p.manifest.id}>{p.manifest.name} {p.manifest.version}</option>)}
            </select>

            <label className="modal-lbl">Короткое описание — его видно в списке</label>
            <input className="modal-in" maxLength={SUMMARY_MAX} value={summary} onChange={e => setSummary(e.target.value)}
              placeholder="Одной строкой: что он делает" />
            <div className="cset-hint" style={{ marginTop: 4 }}>{summary.length}/{SUMMARY_MAX}</div>

            <label className="modal-lbl">Полное описание — в карточке</label>
            <textarea className="cset-topic" maxLength={DESC_MAX} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Как пользоваться, какие команды, что настраивается" />

            <PicField label="Значок" value={icon} onChange={setIcon} />
            <PicField label="Фон карточки" value={banner} onChange={setBanner} />
            <div className="cat-preview">
              <div className="cat-tile as-preview">
                <div className={'cat-tile-bg' + (banner.trim() ? '' : ' plain')}
                  style={banner.trim() ? { backgroundImage: 'url(' + banner.trim() + ')' } : undefined} />
                <div className="cat-tile-ic">
                  {icon.trim() ? <img src={icon.trim()} alt="" /> : <span className="cat-emoji">🧩</span>}
                </div>
                <div className="cat-tile-body">
                  <div className="cat-nm">{chosen?.manifest.name ?? 'Плагин'}</div>
                  <div className="cat-sum">{shorten(summary || 'Короткое описание появится здесь')}</div>
                </div>
              </div>
              <div className="cset-hint" style={{ marginTop: 0 }}>Так плитка будет выглядеть в каталоге.</div>
            </div>

            <div className="cset-hint" style={{ marginTop: 10 }}>
              В каталог уходит и код плагина — иначе его нельзя было бы поставить. Не выкладывай то,
              что содержит твои ключи или пароли.
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
