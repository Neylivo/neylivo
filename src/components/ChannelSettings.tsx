// Полноэкранные настройки канала — 1-в-1 как в Discord (v1.24.0).
// У текстовых каналов вкладки: Обзор / Права доступа / Приглашения / Интеграция.
// У голосовых — те же, но БЕЗ «Интеграции» (прямое указание пользователя),
// а в «Обзоре» дополнительно битрейт, качество видео, лимит пользователей и регион.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { createInvite } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo } from '../lib/storage'
import type { Server, Channel } from '../types'
import { Icon } from './icons'
import { CH_FONTS, CH_COLOR_PRESETS, chNameStyle } from '../lib/chStyle'
import { logAudit } from '../lib/auditLog'
import { fetchRoles, type ServerRole } from '../lib/roles'

const SLOW_OPTS = ['Выкл', '5с', '10с', '15с', '30с', '1м', '2м', '5м', '10м', '15м', '30м', '1ч', '2ч', '6ч']
const HIDE_OPTS = ['1 час', '24 часа', '3 дней', '1 неделя']
const REGIONS = ['Автоматически', 'Россия', 'Европа', 'США Восток', 'США Запад', 'Азия']

type Tri = 'deny' | 'default' | 'allow'
const MAIN_PERMS: { k: string; t: string; d: string }[] = [
  { k: 'view', t: 'Просмотр канала', d: 'Позволяет участникам просматривать этот канал по умолчанию. Отключив у @everyone это право, вы сделаете этот канал приватным.' },
  { k: 'manage', t: 'Управлять каналом', d: 'Позволяет участникам менять название, описание и настройки этого канала. Также даёт право удалить этот канал.' },
  { k: 'perms', t: 'Управлять правами', d: 'Позволяет участникам менять права этого канала.' },
  { k: 'webhooks', t: 'Управлять вебхуками (webhooks)', d: 'Позволяет участникам создавать, редактировать и удалять вебхуки этого канала, которые публикуют сообщения из других приложений и с сайтов.' },
]
const MEMBER_PERMS: { k: string; t: string; d: string }[] = [
  { k: 'invite', t: 'Создание приглашения', d: 'Позволяет участникам приглашать на этот сервер.' },
  { k: 'send', t: 'Отправлять сообщения', d: 'Позволяет участникам отправлять сообщения в этом канале.' },
]

export function ChannelSettings({ server, channel, onClose, onChanged, onDeleted }: {
  server: Server; channel: Channel; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const { user } = useAuth()
  const isVoice = (channel as any).kind === 'voice'
  const s0: any = (channel as any).settings ?? {}
  const [tab, setTab] = useState<'overview' | 'perms' | 'invites' | 'integrations'>('overview')
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState<string>((channel as any).topic ?? '')
  const [slow, setSlow] = useState<string>(s0.slow ?? 'Выкл')
  const [nsfw, setNsfw] = useState<boolean>(!!s0.nsfw)
  const [hide, setHide] = useState<string>(s0.hide ?? '3 дней')
  const [bitrate, setBitrate] = useState<number>(s0.bitrate ?? 64)
  const [vq, setVq] = useState<string>(s0.video_quality ?? 'auto')   // v1.128.0: 'auto' | '144p'…'1440p'
  const [limit, setLimit] = useState<number>(s0.user_limit ?? 0)
  const [region, setRegion] = useState<string>(s0.region ?? 'Автоматически')
  const [priv, setPriv] = useState<boolean>(!!s0.private)
  // v1.267.0: какие роли видят приватный канал (RLS can_view_channel, миграция
  // supabase/69_channel_privacy.sql) — раньше переключателя «Приватный» без
  // выбора ролей было физически некому давать доступ, кроме владельца/MANAGE_CHANNELS.
  const [privRoles, setPrivRoles] = useState<string[]>(Array.isArray((channel as any).private_roles) ? (channel as any).private_roles : [])
  const [roles, setRoles] = useState<ServerRole[]>([])
  useEffect(() => { fetchRoles(server.id).then(setRoles) }, [server.id])
  const [perms, setPerms] = useState<Record<string, Tri>>(s0.perms ?? {})
  const [paused, setPaused] = useState<boolean>(!!s0.invites_paused)
  // v1.138.0: шрифт и раскраска названия канала (см. src/lib/chStyle.ts)
  const [nameFont, setNameFont] = useState<string>(s0.name_font ?? '')
  const [nameColors, setNameColors] = useState<string[]>(Array.isArray(s0.name_colors) ? s0.name_colors : [])
  const [nameAnim, setNameAnim] = useState<boolean>(!!s0.name_anim)
  const [nameFontUrl, setNameFontUrl] = useState<string | null>(s0.name_font_url ?? null)   // v1.140.0: свой файл шрифта
  const [invites, setInvites] = useState<any[]>([])
  // v1.128.0: «несохранённые изменения» считаются сравнением с последними
  // сохранёнными значениями — вернул настройку обратно, и плашка пропадает сама.
  const normPerms = (p: Record<string, Tri>) => { const o: Record<string, Tri> = {}; for (const k of Object.keys(p ?? {}).sort()) if (p[k] && p[k] !== 'default') o[k] = p[k]; return o }
  const snapAll = () => JSON.stringify({ name, topic, slow, nsfw, hide, bitrate, vq, limit, region, priv, privRoles: [...privRoles].sort(), perms: normPerms(perms), paused, nameFont, nameColors, nameAnim, nameFontUrl })
  const [base, setBase] = useState(() => JSON.stringify({ name: channel.name, topic: (channel as any).topic ?? '', slow: s0.slow ?? 'Выкл', nsfw: !!s0.nsfw, hide: s0.hide ?? '3 дней', bitrate: s0.bitrate ?? 64, vq: s0.video_quality ?? 'auto', limit: s0.user_limit ?? 0, region: s0.region ?? 'Автоматически', priv: !!s0.private, privRoles: (Array.isArray((channel as any).private_roles) ? [...(channel as any).private_roles] : []).sort(), perms: normPerms(s0.perms ?? {}), paused: !!s0.invites_paused, nameFont: s0.name_font ?? '', nameColors: Array.isArray(s0.name_colors) ? s0.name_colors : [], nameAnim: !!s0.name_anim, nameFontUrl: s0.name_font_url ?? null }))
  const dirty = snapAll() !== base
  const setDirty = (_d: boolean) => {}

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (tab !== 'invites') return
    supabase.from('server_invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false })
      .then(({ data }) => setInvites(data ?? []))
  }, [tab, server.id])

  function setPerm(k: string, v: Tri) { setPerms(p => ({ ...p, [k]: v })); setDirty(true) }

  // v1.140.0: свой файл шрифта для названия канала (.ttf/.otf/.woff/.woff2)
  const chFontFileRef = useRef<HTMLInputElement>(null)
  const [fontBusy, setFontBusy] = useState(false)
  async function pickNameFont(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !user) return
    setFontBusy(true)
    try { setNameFontUrl(await uploadTo('avatars', user.id, f)); setDirty(true) }
    catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setFontBusy(false); e.target.value = '' }
  }

  async function save() {
    const settings = { ...s0, slow, nsfw, hide, bitrate, video_quality: vq, user_limit: limit, region, private: priv, perms, invites_paused: paused, name_font: nameFont || null, name_font_url: nameFontUrl || null, name_colors: nameColors.length ? nameColors : null, name_anim: nameAnim }
    const nm = name.trim() || channel.name
    let { data: upd, error } = await supabase.from('channels').update({ name: nm, topic: topic || null, settings, private_roles: privRoles } as any).eq('id', channel.id).select('id')
    // v1.267.0: private_roles — отдельная колонка (миграция supabase/69_channel_privacy.sql,
    // нужна RLS-политикам can_view_channel), пока не применена — колонки не существует.
    if (error && /private_roles/i.test(error.message ?? '')) {
      const r0 = await supabase.from('channels').update({ name: nm, topic: topic || null, settings } as any).eq('id', channel.id).select('id')
      upd = r0.data; error = r0.error
      if (!error) toastErr('Выбор ролей для приватного канала не сохранён — примени миграцию supabase/69_channel_privacy.sql')
    }
    // v1.140.0: без RLS-политики UPDATE база молча обновляет 0 строк — ловим это и подсказываем миграцию.
    if (!error && (!upd || upd.length === 0)) return toastErr('Не сохранилось: в базе нет права изменять каналы — примени миграцию supabase/29_channels_update_policy.sql')
    if (error) {
      // Скорее всего не применена миграция 16 — сохраняем хотя бы название.
      const r2 = await supabase.from('channels').update({ name: nm }).eq('id', channel.id).select('id')
      if (r2.error) return toastErr(r2.error.message)
      if (!r2.data || r2.data.length === 0) return toastErr('Не сохранилось — нет прав на изменение канала')
      toastErr('Для темы и настроек примени миграцию supabase/16_channel_settings.sql')
    }
    setBase(snapAll())   // v1.128.0: сохранённое становится новой «базой»
    toastOk('Изменения сохранены')
    onChanged()
  }

  function reset() {
    // v1.128.0: сброс к последним сохранённым значениям (из базового снимка)
    const b = JSON.parse(base)
    setName(b.name); setTopic(b.topic); setSlow(b.slow); setNsfw(b.nsfw)
    setHide(b.hide); setBitrate(b.bitrate); setVq(b.vq); setLimit(b.limit)
    setRegion(b.region); setPriv(b.priv); setPrivRoles(b.privRoles ?? []); setPerms(b.perms); setPaused(b.paused); setNameFont(b.nameFont ?? ''); setNameColors(b.nameColors ?? []); setNameAnim(!!b.nameAnim); setNameFontUrl(b.nameFontUrl ?? null)
  }

  async function del() {
    if (!await confirmUi('Удалить канал «' + channel.name + '»? Это действие необратимо.', { okText: 'Удалить канал' })) return
    const { data: deld, error } = await supabase.from('channels').delete().eq('id', channel.id).select('id')
    if (error) return toastErr(error.message)
    if (!deld || deld.length === 0) return toastErr('Канал не удалился: примени миграцию supabase/29_channels_update_policy.sql')
    logAudit(server.id, 'channel_delete', (isVoice ? '🔊 ' : '#') + channel.name)
    toastOk('Канал удалён')
    onDeleted()
  }

  async function makeInvite() {
    if (!user) return
    const res = await createInvite(server.id, user.id)
    if (res.error) return toastErr(res.error.message)
    try { await navigator.clipboard.writeText(res.code!) } catch {}
    toastOk('Код приглашения скопирован: ' + res.code)
    const { data } = await supabase.from('server_invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false })
    setInvites(data ?? [])
  }

  async function revoke(id: string) {
    await supabase.from('server_invites').delete().eq('id', id)
    setInvites(list => list.filter(i => i.id !== id))
  }

  const tri = (k: string) => {
    const v: Tri = perms[k] ?? 'default'
    return (
      <div className="cset-tri">
        <button className={'deny' + (v === 'deny' ? ' on' : '')} title="Запретить" onClick={() => setPerm(k, 'deny')}><Icon name="close" size={13} /></button>
        <button className={'def' + (v === 'default' ? ' on' : '')} title="По умолчанию" onClick={() => setPerm(k, 'default')}>／</button>
        <button className={'allow' + (v === 'allow' ? ' on' : '')} title="Разрешить" onClick={() => setPerm(k, 'allow')}><Icon name="check" size={13} /></button>
      </div>
    )
  }

  // v1.128.0: пузырёк-значение над бегунком ползунка (как в Discord)
  const plural = (n: number, one: string, few: string, many: string) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many }
  const bubble = (val: number, min: number, max: number, label: string) => {
    const p = (val - min) / (max - min)
    return <span className="cset-bubble" style={{ left: `calc(${(p * 100).toFixed(2)}% + ${((0.5 - p) * 18).toFixed(1)}px)` }}>{label}</span>
  }

  return createPortal(
    <div className="cset">
      <div className="cset-side">
        <nav className="cset-nav">
          <div className="cset-cat">{isVoice ? '🔊 ' : '# '}{channel.name} — {isVoice ? 'голосовые каналы' : 'текстовые каналы'}</div>
          <div className={'cset-tab' + (tab === 'overview' ? ' on' : '')} onClick={() => setTab('overview')}>Обзор</div>
          <div className={'cset-tab' + (tab === 'perms' ? ' on' : '')} onClick={() => setTab('perms')}>Права доступа</div>
          <div className={'cset-tab' + (tab === 'invites' ? ' on' : '')} onClick={() => setTab('invites')}>Приглашения</div>
          {!isVoice && <div className={'cset-tab' + (tab === 'integrations' ? ' on' : '')} onClick={() => setTab('integrations')}>Интеграция</div>}
          <div className="cset-sep" />
          <div className="cset-tab danger" onClick={del}>Удалить канал <Icon name="trash" size={15} /></div>
        </nav>
      </div>
      <div className="cset-main">
        {tab === 'overview' && <>
          <div className="cset-h">Обзор</div>
          <label className="cset-lbl">Название канала</label>
          <input className="modal-in" value={name} onChange={e => { setName(e.target.value); setDirty(true) }} />
          <label className="cset-lbl">Шрифт названия</label>
          <select className="modal-in" value={nameFont} onChange={e => { setNameFont(e.target.value); setDirty(true) }}>
            <option value="">Как на сервере</option>
            {CH_FONTS.filter(f => f.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>{/* v1.140.0: свой файл шрифта */}
            <button className="pqs2-btn ghost" onClick={() => chFontFileRef.current?.click()}>{fontBusy ? 'Загрузка…' : (nameFontUrl ? 'Свой шрифт — заменить файл' : 'Загрузить свой шрифт (.ttf/.otf/.woff2)')}</button>
            {nameFontUrl && <button className="pqs2-btn ghost" onClick={() => { setNameFontUrl(null); setDirty(true) }}>Убрать свой шрифт</button>}
          </div>
          <input ref={chFontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={pickNameFont} />
          <div className="cset-hint">Шрифт названия только этого канала. «Как на сервере» — общий шрифт каналов из настроек сервера («Профиль сервера»). Свой загруженный файл важнее выбора из списка.</div>
          <label className="cset-lbl">Раскраска названия</label>
          <div className="cset-chc-row">
            {CH_COLOR_PRESETS.map(p => {
              const on = JSON.stringify(nameColors) === JSON.stringify(p.colors) && nameAnim === !!p.anim
              const stl: any = p.colors.length >= 2 ? { backgroundImage: 'linear-gradient(90deg, ' + (p.anim ? [...p.colors, p.colors[0]] : p.colors).join(', ') + ')' } : p.colors.length === 1 ? { color: p.colors[0] } : undefined
              return <button key={p.name} className={'cset-chc-btn' + (on ? ' on' : '')} onClick={() => { setNameColors(p.colors); setNameAnim(!!p.anim); setDirty(true) }}>
                <span className={p.colors.length >= 2 ? 'ch-grad' + (p.anim ? ' ch-grad-anim' : '') : ''} style={stl}>{p.name}</span>
              </button>
            })}
          </div>
          <div className="cset-chc-custom">
            {nameColors.map((c0, i) => (
              <span key={i} className="cset-chc-swatch">
                <input type="color" value={c0} onChange={e => { const v = e.target.value; setNameColors(cs2 => cs2.map((x, j) => j === i ? v : x)); setDirty(true) }} />
                <button title="Убрать цвет" onClick={() => { setNameColors(cs2 => cs2.filter((_, j) => j !== i)); setDirty(true) }}>×</button>
              </span>
            ))}
            {nameColors.length < 4 && <button className="cset-chc-add" onClick={() => { setNameColors(cs2 => [...cs2, cs2.length ? cs2[cs2.length - 1] : '#f5d76b']); setDirty(true) }}>+ цвет</button>}
          </div>
          <div className="cset-hint">До 4 своих цветов: один — сплошной цвет, два и больше — градиент по буквам.</div>
          <div className="cset-row">
            <div>
              <div className="cset-row-t">Переливание</div>
              <div className="cset-hint">Цвета плавно бегут по названию — особенно красиво для «Золотого». Работает от двух цветов.</div>
            </div>
            <button className={'tgl' + (nameAnim ? ' on' : '')} onClick={() => { setNameAnim(!nameAnim); setDirty(true) }} />
          </div>
          <label className="cset-lbl">Предпросмотр</label>
          <div className="cset-chc-prev">{(() => { const cs2 = chNameStyle({ name_font: nameFont, name_font_url: nameFontUrl, name_colors: nameColors, name_anim: nameAnim }, (server as any).settings ?? {}); return <span className={(cs2.grad ? 'ch-grad' : '') + (cs2.anim ? ' ch-grad-anim' : '')} style={cs2.style}>{isVoice ? '🔊 ' : '# '}{name || channel.name}</span> })()}</div>
          {!isVoice && <>
            <label className="cset-lbl">Тема канала</label>
            <textarea className="cset-topic" maxLength={1024} placeholder="Расскажите участникам, как пользоваться этим каналом!"
              value={topic} onChange={e => { setTopic(e.target.value); setDirty(true) }} />
            <div className="cset-count">{1024 - topic.length}</div>
          </>}
          <label className="cset-lbl">Медленный режим</label>
          <select className="modal-in" value={slow} onChange={e => { setSlow(e.target.value); setDirty(true) }}>{SLOW_OPTS.map(o => <option key={o}>{o}</option>)}</select>
          <div className="cset-hint">Участники не смогут отправлять больше одного сообщения и создавать больше одной ветки в течение этого периода времени, кроме случаев, когда у них есть право обходить медленный режим.</div>
          <div className="cset-row">
            <div>
              <div className="cset-row-t">Канал с возрастным ограничением</div>
              <div className="cset-hint">Для просмотра содержимого этого канала пользователям необходимо подтвердить, что они достигли совершеннолетия. В каналах с возрастными ограничениями отсутствует фильтр нежелательного контента.</div>
            </div>
            <button className={'tgl' + (nsfw ? ' on' : '')} onClick={() => { setNsfw(!nsfw); setDirty(true) }} />
          </div>
          {!isVoice && <>
            <label className="cset-lbl">Скрыть после неактивности</label>
            <select className="modal-in" value={hide} onChange={e => { setHide(e.target.value); setDirty(true) }}>{HIDE_OPTS.map(o => <option key={o}>{o}</option>)}</select>
            <div className="cset-hint">Новые ветки перестанут отображаться в списке каналов после заданного периода неактивности.</div>
          </>}
          {isVoice && <>
            <div className="cset-div" />
            <label className="cset-lbl">Битрейт</label>
            <div className="cset-scale"><span>8kbps</span><span>64kbps</span><span>96kbps</span></div>
            <div className="cset-slidewrap">
              {bubble(bitrate, 8, 96, bitrate + ' kbps')}
              <input type="range" className="cset-slider" min={8} max={96} value={bitrate} onChange={e => { setBitrate(Number(e.target.value)); setDirty(true) }} />
            </div>
            <div className="cset-hint">ВНИМАНИЕ! Не поднимайте битрейт выше 64 кбит/с, чтобы не создать проблемы людям с низкой скоростью соединения.</div>
            <label className="cset-lbl">Качество видео</label>
            {['auto', '144p', '240p', '360p', '480p', '720p', '1080p', '1440p'].map(q => (
              <div key={q} className={'cset-radio' + (vq === q ? ' on' : '')} onClick={() => { setVq(q); setDirty(true) }}><span className="dot" /> {q === 'auto' ? 'Автоматически' : q === '1440p' ? '1440p (2K)' : q}</div>
            ))}
            <div className="cset-hint">Устанавливает качество изображения для всех участников канала. Выберите <b>Автоматически</b> для оптимальной производительности.</div>
            <label className="cset-lbl">Лимит пользователей</label>
            <div className="cset-scale"><span>∞</span><span>99</span></div>
            <div className="cset-slidewrap">
              {bubble(limit, 0, 99, limit === 0 ? '∞' : limit + ' ' + plural(limit, 'пользователь', 'пользователя', 'пользователей'))}
              <input type="range" className="cset-slider" min={0} max={99} value={limit} onChange={e => { setLimit(Number(e.target.value)); setDirty(true) }} />
            </div>
            <div className="cset-hint">Ограничивает количество пользователей, которые могут подключаться к этому голосовому каналу. Пользователи с правом на <b>перемещение участников</b> могут игнорировать это ограничение и перемещать других пользователей в канал.</div>
            <label className="cset-lbl">Назначение региона</label>
            <select className="modal-in" value={region} onChange={e => { setRegion(e.target.value); setDirty(true) }}>{REGIONS.map(o => <option key={o}>{o}</option>)}</select>
            <div className="cset-hint">Для всех пользователей канала независимо от их местонахождения будет предпринята попытка подключения к указанному вами региону. От региона может зависеть качество видео и звука.</div>
          </>}
        </>}
        {tab === 'perms' && <>
          <div className="cset-h">Права канала</div>
          <div className="cset-hint" style={{ marginTop: -12, marginBottom: 14 }}>Используйте права, чтобы настроить возможности пользователей на этом канале.</div>
          {/* v1.267.0: приватность (переключатель + список ролей ниже) теперь
              реально работает — RLS can_view_channel в supabase/69_channel_privacy.sql.
              «Расширенные права» ниже (tri-state @everyone) по-прежнему только
              сохраняются и ни на что не влияют — честно предупреждаем об этом. */}
          <div className="cset-sync"><Icon name="repeat" size={16} /> Права синхронизированы с категорией «{isVoice ? 'Голосовые каналы' : 'Текстовые каналы'}»</div>
          <div className="cset-priv">
            <div><div className="cset-row-t">🔒 Приватный канал</div>
              <div className="cset-hint">Если сделать канал приватным, только выбранные вами роли (плюс владелец и модераторы с правом «Управление каналами») смогут его просматривать.</div></div>
            <button className={'tgl' + (priv ? ' on' : '')} onClick={() => { setPriv(!priv); setDirty(true) }} />
          </div>
          {priv && <div className="cset-priv-roles">
            <label className="cset-lbl">Кому виден канал</label>
            {roles.length === 0 && <div className="cset-hint">На сервере нет ролей — канал увидят только владелец и модераторы с правом «Управление каналами».</div>}
            {roles.map(r => (
              <label key={r.id} className="cset-priv-role">
                <input type="checkbox" checked={privRoles.includes(r.id)}
                  onChange={e => { setPrivRoles(p => e.target.checked ? [...p, r.id] : p.filter(id => id !== r.id)); setDirty(true) }} />
                <span className="role-dot" style={{ background: r.color }} /> {r.name}
              </label>
            ))}
          </div>}
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 17 }}>Расширенные права</div>
          <div className="cset-hint" style={{ background: 'rgba(237,66,69,.12)', border: '1px solid rgba(237,66,69,.35)', borderRadius: 8, padding: '10px 12px', margin: '4px 0 14px' }}>
            ⚠️ Права ниже (по конкретным действиям для @everyone) пока не реализованы технически — сохраняются, но ни на что не влияют. Настоящая приватность канала — переключатель выше.
          </div>
          <div className="cset-cat" style={{ padding: '0 0 6px' }}>Роли/Участники</div>
          <div className="cset-role-chip">@everyone</div>
          <label className="cset-lbl">Основные права канала</label>
          {MAIN_PERMS.map(p => <div key={p.k} className="cset-perm">
            <div className="cset-perm-h">{p.t} {tri(p.k)}</div>
            <div className="cset-hint">{p.d}</div>
          </div>)}
          <label className="cset-lbl">Права участников</label>
          {MEMBER_PERMS.map(p => <div key={p.k} className="cset-perm">
            <div className="cset-perm-h">{p.t} {tri(p.k)}</div>
            <div className="cset-hint">{p.d}</div>
          </div>)}
        </>}
        {tab === 'invites' && <>
          <div className="cset-h">Приглашения</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Вот список всех активных ссылок-приглашений. Вы можете отозвать любое или <a className="cset-link" onClick={makeInvite}>создать ещё</a>.</div>
          <div style={{ margin: '14px 0' }}>
            <button className={'cset-pause' + (paused ? ' off' : '')} onClick={() => { setPaused(!paused); setDirty(true) }}>{paused ? 'Возобновить приглашения' : 'Приостановить приглашения'}</button>
          </div>
          {invites.length === 0 && <div className="cset-inv-empty">
            <b>ПОКА НЕТ ПРИГЛАШЕНИЙ</b>
            Не видите перед собой цели? Вас несёт, словно бумажный самолётик, дрейфующий по небу? Пригласите сюда своих друзей, создав ссылку-приглашение!
          </div>}
          {invites.map(i => <div key={i.id} className="cset-inv">
            <code>{i.code}</code>
            <button className="cset-reset" style={{ color: '#ed4245' }} onClick={() => revoke(i.id)}>Отозвать</button>
          </div>)}
        </>}
        {tab === 'integrations' && !isVoice && <>
          <div className="cset-h">Интеграция</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Персонализируйте свой сервер с помощью интеграций. Управляйте вебхуками и отслеживаемыми каналами, публикации с которых появляются на этом канале.</div>
          <div className="cset-int">
            <Icon name="zap" size={22} />
            <div className="cset-int-t"><b>Вебхуки</b><span>0 вебхуков</span></div>
            <button onClick={() => toastOk('Вебхуки скоро появятся')}>Создать вебхук</button>
          </div>
          <div className="cset-int">
            <Icon name="repeat" size={22} />
            <div className="cset-int-t"><b>Отслеживаемые каналы</b><span>0 каналов</span></div>
          </div>
        </>}
      </div>
      <button className="cset-esc" onClick={onClose}>
        <span className="cset-esc-circle"><Icon name="close" size={16} /></span>
        ESC
      </button>
      <div className={'cset-savebar' + (dirty ? '' : ' bye')}>
        <span>Осторожно — вы не сохранили изменения!</span>
        <button className="cset-reset" onClick={reset}>Сбросить</button>
        <button className="cset-save" onClick={save}>Сохранить изменения</button>
      </div>
    </div>,
    document.body
  )
}