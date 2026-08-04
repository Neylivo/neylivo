// Полноэкранные настройки канала — 1-в-1 как в Discord (v1.24.0).
// У текстовых каналов вкладки: Обзор / Права доступа / Приглашения / Интеграция.
// У голосовых — те же, но БЕЗ «Интеграции» (прямое указание пользователя),
// а в «Обзоре» дополнительно битрейт, качество видео, лимит пользователей и регион.
import { logErr, logWarn } from '../lib/log'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { createInvite, listMembers } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import { listWebhooks, createWebhook, deleteWebhook, type Webhook } from '../lib/webhooks'
import { uploadTo } from '../lib/storage'
import type { Server, Channel } from '../types'
import { Icon } from './icons'
import { CH_FONTS, CH_COLOR_PRESETS, chNameStyle } from '../lib/chStyle'
import { logAudit } from '../lib/auditLog'
import { fetchRoles, type ServerRole } from '../lib/roles'
import { forumTagsOf, type ForumTag } from '../lib/threads'
import {
  PERM_ROWS, parseOverrides, fromNorm, mergeLegacy, legacyFromOverrides, triOf, setTri, normOverrides,
  userKey, isUserKey, keyUserId, type Overrides,
} from '../lib/chanPerms'

const SLOW_OPTS = ['Выкл', '5с', '10с', '15с', '30с', '1м', '2м', '5м', '10м', '15м', '30м', '1ч', '2ч', '6ч']
const HIDE_OPTS = ['1 час', '24 часа', '3 дней', '1 неделя']
const REGIONS = ['Автоматически', 'Россия', 'Европа', 'США Восток', 'США Запад', 'Азия']

type Tri = 'deny' | 'default' | 'allow'
// v1.443.0: прежний список «прав участника» здесь больше не нужен: вкладка
// «Права доступа» показывает перекрытия из src/lib/chanPerms.ts (PERM_ROWS), и
// каждое из них правда исполняется правилами базы (supabase/103_channel_perms.sql).
// До этого тут был один переключатель на @everyone — остальные пять убрали в
// v1.316.0 как декоративные.
export function ChannelSettings({ server, channel, onClose, onChanged, onDeleted }: {
  server: Server; channel: Channel; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const { user } = useAuth()
  const isVoice = (channel as any).kind === 'voice'
  const isForumCh = (channel as any).kind === 'forum'
  const s0: any = (channel as any).settings ?? {}
  const [tab, setTab] = useState<'overview' | 'perms' | 'invites' | 'integrations'>('overview')
  // v1.319.0: вебхуки канала. Список грузится при открытии вкладки «Интеграции» —
  // раньше там стояла заглушка «0 вебхуков» и кнопка с обещанием.
  const [hooks, setHooks] = useState<Webhook[] | null>(null)
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const [whBusy, setWhBusy] = useState(false)
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
  useEffect(() => { fetchRoles(server.id).then(setRoles).catch(e => logErr('roles]', e)) }, [server.id])
  // v1.443.0: перекрытия прав канала — для @everyone, любой роли и отдельного
  // участника (supabase/103_channel_perms.sql). Старая настройка «только для
  // чтения» подхватывается сюда же, иначе вкладка показывала бы «ничего не
  // запрещено» у канала, в который на деле нельзя писать.
  const [ov, setOv] = useState<Overrides>(() => mergeLegacy(parseOverrides((channel as any).perm_overrides), s0.perms))
  const [ovTarget, setOvTarget] = useState('everyone')
  const [members, setMembers] = useState<any[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [perms, setPerms] = useState<Record<string, Tri>>(s0.perms ?? {})
  // v1.320.0: теги форума (см. ForumView.tsx). Живут в settings канала, а не
  // отдельной таблицей: их десяток на канал, и меняет их тот же человек тем же
  // сохранением, что и прочие настройки. У обсуждения хранятся только их id —
  // поэтому id генерируется один раз и не меняется при переименовании тега.
  const [forumTags, setForumTags] = useState<ForumTag[]>(forumTagsOf(channel))
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
  const snapAll = () => JSON.stringify({ name, topic, slow, nsfw, hide, bitrate, vq, limit, region, priv, privRoles: [...privRoles].sort(), perms: normPerms(perms), ov: normOverrides(ov), paused, nameFont, nameColors, nameAnim, nameFontUrl, forumTags })
  const [base, setBase] = useState(() => JSON.stringify({ name: channel.name, topic: (channel as any).topic ?? '', slow: s0.slow ?? 'Выкл', nsfw: !!s0.nsfw, hide: s0.hide ?? '3 дней', bitrate: s0.bitrate ?? 64, vq: s0.video_quality ?? 'auto', limit: s0.user_limit ?? 0, region: s0.region ?? 'Автоматически', priv: !!s0.private, privRoles: (Array.isArray((channel as any).private_roles) ? [...(channel as any).private_roles] : []).sort(), perms: normPerms(s0.perms ?? {}), ov: normOverrides(mergeLegacy(parseOverrides((channel as any).perm_overrides), s0.perms)), paused: !!s0.invites_paused, nameFont: s0.name_font ?? '', nameColors: Array.isArray(s0.name_colors) ? s0.name_colors : [], nameAnim: !!s0.name_anim, nameFontUrl: s0.name_font_url ?? null, forumTags: forumTagsOf(channel) }))
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
    // Тег без названия — пустая кнопка в фильтре, которую не за что нажать:
    // добавили строку и передумали. Такие выкидываем при сохранении.
    const cleanTags = forumTags.map(t => ({ ...t, name: t.name.trim(), emoji: t.emoji?.trim() || undefined })).filter(t => t.name)
    // v1.443.0: «только для чтения» пишется и в перекрытие, и в прежний
    // settings.perms.send — их согласует legacyFromOverrides. Иначе на сервере
    // без миграции 103 (колонки perm_overrides нет) запрет молча пропал бы.
    const perms2 = legacyFromOverrides(ov, perms)
    const settings = { ...s0, slow, nsfw, hide, bitrate, video_quality: vq, user_limit: limit, region, private: priv, perms: perms2, invites_paused: paused, name_font: nameFont || null, name_font_url: nameFontUrl || null, name_colors: nameColors.length ? nameColors : null, name_anim: nameAnim, forum_tags: cleanTags }
    const nm = name.trim() || channel.name
    const payload: any = { name: nm, topic: topic || null, settings, private_roles: privRoles, perm_overrides: ov }
    let { data: upd, error } = await supabase.from('channels').update(payload).eq('id', channel.id).select('id')
    // v1.443.0: колонки perm_overrides нет, пока не применена миграция 103.
    // Сохраняем остальное и говорим прямо, что перекрытия не записались, —
    // молча потерять их значит показать настройку, которой в базе нет.
    if (error && /perm_overrides/i.test(error.message ?? '')) {
      delete payload.perm_overrides
      const r0 = await supabase.from('channels').update(payload).eq('id', channel.id).select('id')
      upd = r0.data; error = r0.error
      if (!error) toastErr('Права ролей по каналу не сохранены — примени миграцию supabase/103_channel_perms.sql')
    }
    // v1.267.0: private_roles — отдельная колонка (миграция supabase/69_channel_privacy.sql,
    // нужна RLS-политикам can_view_channel), пока не применена — колонки не существует.
    if (error && /private_roles/i.test(error.message ?? '')) {
      // v1.443.0: повторяем тем же payload без одной колонки — раньше здесь
      // собирался объект заново, и вместе с private_roles терялись перекрытия.
      delete payload.private_roles
      const r0 = await supabase.from('channels').update(payload).eq('id', channel.id).select('id')
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
    setForumTags(cleanTags)
    // v1.128.0: сохранённое становится новой «базой». Теги подставляем уже
    // очищенными — snapAll() читает состояние, которое обновится только к
    // следующей отрисовке, и плашка «есть несохранённые» осталась бы висеть.
    setBase(JSON.stringify({ ...JSON.parse(snapAll()), forumTags: cleanTags }))
    toastOk('Изменения сохранены')
    onChanged()
  }

  function reset() {
    // v1.128.0: сброс к последним сохранённым значениям (из базового снимка)
    const b = JSON.parse(base)
    setName(b.name); setTopic(b.topic); setSlow(b.slow); setNsfw(b.nsfw)
    setHide(b.hide); setBitrate(b.bitrate); setVq(b.vq); setLimit(b.limit)
    setRegion(b.region); setPriv(b.priv); setPrivRoles(b.privRoles ?? []); setPerms(b.perms); setOv(fromNorm(b.ov ?? '[]')); setPaused(b.paused); setNameFont(b.nameFont ?? ''); setNameColors(b.nameColors ?? []); setNameAnim(!!b.nameAnim); setNameFontUrl(b.nameFontUrl ?? null); setForumTags(b.forumTags ?? [])
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

  // ── v1.443.0: перекрытия прав канала ──────────────────────────────────────
  // Участники нужны только на этой вкладке — тянем их при первом заходе, а не
  // при открытии настроек: на большом сервере это лишний запрос на каждый вход.
  const [extra, setExtra] = useState<string[]>([])
  useEffect(() => {
    if (tab !== 'perms' || members.length) return
    listMembers(server.id).then(setMembers).catch(e => logErr('members]', e))
  }, [tab, server.id])

  const hasOv = (key: string) => !!ov[key]
  const memberName = (id: string) => members.find(m => m.user_id === id)?.member_name ?? id.slice(0, 8)
  // Цели: @everyone, все роли сервера, плюс те участники, у кого перекрытия уже
  // есть или кого только что добавили.
  const ovUserIds = [...new Set([...Object.keys(ov).filter(isUserKey).map(keyUserId), ...extra])]
  const ovTargets = [
    { key: 'everyone', name: '@everyone', color: '#99aab5' },
    ...roles.map(r => ({ key: r.id, name: r.name, color: r.color })),
    ...ovUserIds.map(id => ({ key: userKey(id), name: memberName(id), color: '#5865f2' })),
  ]
  const ovTargetName = ovTargets.find(t => t.key === ovTarget)?.name ?? '@everyone'
  const addable = members
    .filter(m => !ovUserIds.includes(m.user_id))
    .filter(m => !addQ.trim() || String(m.member_name ?? '').toLowerCase().includes(addQ.trim().toLowerCase()))
    .slice(0, 8)

  /** Три состояния одного права. Читает и пишет то же самое перекрытие, что
   *  уедет в базу, — отдельного «отображаемого» значения здесь нет намеренно. */
  const ovTri = (bit: number) => {
    const cur = triOf(ov, ovTarget, bit)
    const put = (v: Tri) => { setOv(setTri(ov, ovTarget, bit, v)); setDirty(true) }
    return (
      <div className="cset-tri">
        <button className={'deny' + (cur === 'deny' ? ' on' : '')} title="Запретить" onClick={() => put('deny')}><Icon name="close" size={13} /></button>
        <button className={'def' + (cur === 'default' ? ' on' : '')} title="По умолчанию" onClick={() => put('default')}>／</button>
        <button className={'allow' + (cur === 'allow' ? ' on' : '')} title="Разрешить" onClick={() => put('allow')}><Icon name="check" size={13} /></button>
      </div>
    )
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

  useEffect(() => {
    if (tab !== 'integrations' || hooks !== null) return
    listWebhooks(channel.id).then(setHooks).catch(() => setHooks([]))
  }, [tab, channel.id, hooks])

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
          {isForumCh && <>
            <div className="cset-div" />
            <label className="cset-lbl">Теги форума</label>
            <div className="cset-hint" style={{ marginTop: -8 }}>Ими помечают обсуждения, чтобы список можно было отфильтровать. Тег можно переименовать — на уже помеченных обсуждениях он останется тем же. Удалённый тег с обсуждений просто исчезнет.</div>
            <div className="forum-tag-edit">
              {forumTags.map((t, i) => (
                <div key={t.id} className="forum-tag-row">
                  <input className="modal-in forum-tag-emo" maxLength={4} placeholder="🏷️" value={t.emoji ?? ''}
                    onChange={e => setForumTags(list => list.map((x, j) => j === i ? { ...x, emoji: e.target.value } : x))} />
                  <input className="modal-in" maxLength={24} placeholder="Название тега" value={t.name}
                    onChange={e => setForumTags(list => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <button className="forum-tag-del" title="Удалить тег"
                    onClick={() => setForumTags(list => list.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
                </div>
              ))}
              {forumTags.length === 0 && <div className="cset-hint">Тегов нет — обсуждения будут просто списком.</div>}
              {forumTags.length < 20 && <button className="modal-ghost" style={{ alignSelf: 'flex-start' }}
                onClick={() => setForumTags(list => [...list, { id: 'ft' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: '' }])}>
                <Icon name="plus" size={14} /> Добавить тег
              </button>}
            </div>
          </>}
          {!isVoice && !isForumCh && <>
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
            <div className="cset-hint">Ограничивает количество пользователей, которые могут подключаться к этому голосовому каналу. Пользователи с правом <b>управлять каналами</b> заходят в заполненный канал всё равно.</div>
            <label className="cset-lbl">Назначение региона</label>
            {/* v1.332.0: выбор региона сохранялся и не читался нигде — и читаться
                ему неоткуда: сервер связи у Ponoi ровно один, выбирать не из чего.
                Оставляем на виду, но честно выключенным: обещать выбор, которого
                нет, — то же самое, что оставить кнопку-обманку. */}
            <select className="modal-in" value={region} disabled title="Сервер связи один — выбирать не из чего">{REGIONS.map(o => <option key={o}>{o}</option>)}</select>
            <div className="cset-hint">Сервер связи у Ponoi один, поэтому выбирать регион не из чего — все подключаются к нему. Настройка появится, когда серверов станет несколько.</div>
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
            {roles.length > 0 && privRoles.length === 0 && (
              // v1.270.0: приватный канал без единой отмеченной роли молча исчезал
              // из списка у всех, кроме владельца/модераторов — ни здесь, ни в самом
              // списке каналов не было ни намёка, что канал теперь фактически скрыт.
              <div className="cset-hint" style={{ background: 'rgba(237,66,69,.12)', border: '1px solid rgba(237,66,69,.35)', borderRadius: 8, padding: '8px 10px', margin: '2px 0 8px' }}>
                ⚠️ Ни одна роль не отмечена — канал сейчас видят только владелец и модераторы с правом «Управление каналами». Остальные участники не увидят его в списке каналов.
              </div>
            )}
            {roles.map(r => (
              <label key={r.id} className="cset-priv-role">
                <input type="checkbox" checked={privRoles.includes(r.id)}
                  onChange={e => { setPrivRoles(p => e.target.checked ? [...p, r.id] : p.filter(id => id !== r.id)); setDirty(true) }} />
                <span className="role-dot" style={{ background: r.color }} /> {r.name}
              </label>
            ))}
          </div>}
          <div className="cset-div" />
          {/* v1.443.0: раньше здесь стоял один переключатель для @everyone.
              Теперь — перекрытия как в Discord: цель слева (@everyone, роль,
              отдельный участник), её права справа. Считает и показывает одна и
              та же функция channelPermissions из src/lib/chanPerms.ts — та же
              арифметика, что в базе (supabase/103_channel_perms.sql). */}
          <div className="cset-h" style={{ fontSize: 17 }}>Расширенные права</div>
          <div className="cset-hint" style={{ marginTop: -12, marginBottom: 12 }}>
            Права отдельной роли или участника <b>только в этом канале</b>. Личное разрешение сильнее запрета роли, а запрет роли — сильнее того, что разрешено всем.
          </div>
          <div className="cset-ovr">
            <div className="cset-ovr-side">
              <div className="cset-cat" style={{ padding: '0 0 6px' }}>Роли/Участники</div>
              {ovTargets.map(t => (
                <div key={t.key} className={'cset-ovr-t' + (ovTarget === t.key ? ' on' : '')} onClick={() => setOvTarget(t.key)}>
                  <span className="role-dot" style={{ background: t.color }} />
                  <span className="cset-ovr-nm">{t.name}</span>
                  {hasOv(t.key) && <span className="cset-ovr-mark" title="Есть перекрытия">●</span>}
                </div>
              ))}
              <button className="cset-ovr-add" onClick={() => { setAddOpen(v => !v); setAddQ('') }}>+ Добавить участника</button>
              {addOpen && <div className="cset-ovr-add-box">
                <input className="modal-in" autoFocus placeholder="Имя участника" value={addQ} onChange={e => setAddQ(e.target.value)} />
                {addable.length === 0 && <div className="cset-hint" style={{ padding: '6px 2px' }}>Никого не нашлось</div>}
                {addable.map(m => (
                  <div key={m.user_id} className="cset-ovr-t" onClick={() => {
                    // Пустая запись перекрытием не считается и в базу не уедет —
                    // она нужна лишь для того, чтобы цель появилась в списке.
                    setExtra(x => x.includes(m.user_id) ? x : [...x, m.user_id])
                    setOvTarget(userKey(m.user_id)); setAddOpen(false)
                  }}>
                    <span className="role-dot" style={{ background: '#5865f2' }} />
                    <span className="cset-ovr-nm">{m.member_name ?? m.user_id}</span>
                  </div>
                ))}
              </div>}
            </div>
            <div className="cset-ovr-main">
              <label className="cset-lbl">Права для «{ovTargetName}»</label>
              {PERM_ROWS.map(p => <div key={p.bit} className="cset-perm">
                <div className="cset-perm-h">{p.t} {ovTri(p.bit)}</div>
                <div className="cset-hint">{p.d}</div>
              </div>)}
              {ovTarget !== 'everyone' && hasOv(ovTarget) && (
                <button className="cset-reset" style={{ marginTop: 10 }} onClick={() => {
                  let next = ov
                  for (const p of PERM_ROWS) next = setTri(next, ovTarget, p.bit, 'default')
                  setOv(next); setDirty(true)
                }}>Убрать все перекрытия у этой цели</button>
              )}
              {/* Разрешать всё подряд без нужды не стоит: «по умолчанию» — это
                  «как на сервере», и оно продолжает следовать за настройками
                  сервера, а явное разрешение — нет. */}
              <div className="cset-hint" style={{ marginTop: 12 }}>
                «По умолчанию» — как настроено на сервере. Владельца сервера и обладателей права «Управление каналами» перекрытия не ограничивают.
              </div>
            </div>
          </div>
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
            <div className="cset-int-t"><b>Вебхуки</b><span>{hooks === null ? 'загружаю…' : hooks.length + ' шт.'}</span></div>
            <button disabled={whBusy} onClick={async () => {
              setWhBusy(true)
              try {
                const { url } = await createWebhook(server.id, channel.id, 'Вебхук ' + ((hooks?.length ?? 0) + 1))
                // Показываем адрес сразу и один раз: токен в базе не хранится, и
                // восстановить его потом нельзя — только создать новый вебхук.
                setNewUrl(url)
                setHooks(await listWebhooks(channel.id))
              } catch (e: any) { toastErr(e.message) }
              finally { setWhBusy(false) }
            }}>{whBusy ? 'Создаю…' : 'Создать вебхук'}</button>
          </div>
          {newUrl && <div className="wh-new">
            <div className="cset-lbl" style={{ marginTop: 0 }}>Адрес вебхука — виден только сейчас</div>
            <div className="wh-url">{newUrl}</div>
            <div className="cset-hint">
              Скопируй его: токен в базе не хранится, показать ещё раз будет нечем.
              Стороннее приложение шлёт сюда POST с телом {'{'}"content": "текст"{'}'}.
            </div>
            <div className="guide-edit-row" style={{ marginTop: 8 }}>
              <button className="pqs2-btn" onClick={() => { navigator.clipboard?.writeText(newUrl); toastOk('Адрес скопирован') }}>Копировать</button>
              <button className="pqs2-btn ghost" onClick={() => setNewUrl(null)}>Скрыть</button>
            </div>
          </div>}
          {hooks?.map(h => (
            <div key={h.id} className="wh-row">
              <Icon name="zap" size={16} />
              <div className="wh-row-b">
                <b>{h.name}</b>
                <span className="cset-hint">
                  {h.last_used_at ? 'последний раз: ' + new Date(h.last_used_at).toLocaleString('ru-RU') : 'ещё не использовался'}
                </span>
              </div>
              <button className="pqs2-btn ghost danger" onClick={async () => {
                if (!await confirmUi('Удалить вебхук «' + h.name + '»? Его адрес перестанет работать.', { okText: 'Удалить' })) return
                try { await deleteWebhook(h.id); setHooks(await listWebhooks(channel.id)) }
                catch (e: any) { toastErr(e.message) }
              }}><Icon name="trash" size={14} /></button>
            </div>
          ))}
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