// Полноэкранные настройки сервера — 1-в-1 как в Discord (v1.25.0).
// Отличия по прямому указанию владельца проекта:
//  • всё, что в Discord платно (за буст) — здесь бесплатно и без плашек «Откройте с помощью буста»;
//  • нет шкалы/счётчика бустов и страницы «Бонусы буста» — её бесплатные фичи
//    (фоновый баннер сервера, фон приглашения) живут в «Профиле сервера»;
//  • нет лимитов на эмодзи и стикеры (никаких уровней и слотов);
//  • нет каталога сторонних приложений (Discord App Directory) — вместо этого
//    вкладка «Боты» (v1.193.0): добавить свой/чужой бот по ID приложения,
//    см. src/components/DevPortal.tsx («Мои приложения» в настройках пользователя).
// Все настройки лежат в servers.settings (jsonb, миграция 17_server_settings.sql).
// Без миграции код гладко деградирует: имя сервера сохраняется, остальное — с подсказкой.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { toastOk, toastErr } from '../lib/toast'
import { uploadTo } from '../lib/storage'
import { usePresence } from '../lib/presence'
import { listMembers, createInvite, updateServer } from '../lib/servers'
import { fetchRoles, fetchMemberRoles, createRole, deleteRole, setRolePermissions, saveRoleOrder, ROLE_COLORS, type ServerRole } from '../lib/roles'
import { PERM, hasPerm, kickMember, banMember, unbanMember, fetchBans, type ServerBan } from '../lib/permissions'
import { confirmUi } from '../lib/confirm'
import { RoleEditor } from './RoleEditor'
import { ServerBotsPanel } from './DevPortal'
import type { Server, Channel } from '../types'
import { Icon } from './icons'
import { CH_FONTS, chFontFamily } from '../lib/chStyle'
import { EmojiPicker } from './EmojiPicker'
import { TagEmoji, tagFontFamily } from './TagEmoji'

type Tab = 'profile' | 'tag' | 'engage' | 'emoji' | 'stickers' | 'sound' | 'members' | 'roles' | 'invites' | 'access' | 'security' | 'audit' | 'bans' | 'automod' | 'bots' | 'community' | 'template'

const BANNER_COLORS = ['', '#f23f9a', '#ed4245', '#f0813c', '#f2e75c', '#8547d6', '#0fa4f5', '#2ce0bf', '#5c8a2e', '#232428']
const TAG_ICONS = ['🍃', '🗡️', '💗', '🔥', '💧', '💀', '🌙', '⚡', '🔮', '🍄']
const VERIF_LEVELS: { t: string; d: string }[] = [
  { t: 'Отсутствует', d: 'Без ограничений' },
  { t: 'Низкий', d: 'Участники должны иметь подтверждённый email' },
  { t: 'Средний', d: 'Участники должны быть зарегистрированы в Ponoi дольше 5 минут' },
  { t: 'Высокий', d: 'Участники должны состоять на сервере дольше 10 минут' },
  { t: 'Наивысший', d: 'Участники должны иметь подтверждённый номер телефона' },
]
const FILTER_LEVELS: { t: string; d: string }[] = [
  { t: 'Не фильтровать', d: 'Сообщения не будут проверяться на наличие изображений откровенного характера.' },
  { t: 'Проверять участников без ролей', d: 'Сообщения участников без ролей будут проверяться на наличие изображений откровенного характера.' },
  { t: 'Проверять всех участников', d: 'Сообщения всех участников будут проверяться на наличие изображений откровенного характера.' },
]
const EVERYONE_PERMS: { k: string; t: string; d: string }[] = [
  { k: 'view', t: 'Просмотр каналов', d: 'Позволяет участникам по умолчанию просматривать каналы (за исключением приватных).' },
  { k: 'send', t: 'Отправлять сообщения', d: 'Позволяет участникам отправлять сообщения в текстовых каналах.' },
  { k: 'invite', t: 'Создание приглашения', d: 'Позволяет участникам приглашать новых людей на этот сервер.' },
  { k: 'nick', t: 'Изменить никнейм', d: 'Позволяет участникам менять свой никнейм на этом сервере.' },
  { k: 'connect', t: 'Подключаться', d: 'Позволяет участникам подключаться к голосовым каналам.' },
  { k: 'speak', t: 'Говорить', d: 'Позволяет участникам говорить в голосовых каналах.' },
]
const AUTOMOD_CARDS: { k: string; ico: string; t: string; d: string; chips: string[]; btn: string }[] = [
  { k: 'mentions', ico: '@', t: 'Блокировать упоминания спама', d: 'Блокировать сообщения с большим количеством упоминаний ролей и пользователей', chips: ['✕ блокировать сообщение', '# отправить оповещение', '👤 отстранить участника'], btn: 'Настройка' },
  { k: 'spam', ico: '🙁', t: 'Блокировать контент, похожий на спам', d: 'Проверять сообщения, а также форумные ветки и публикации на наличие спама.', chips: ['✕ блокировать сообщение', '# отправить оповещение'], btn: 'Настройка' },
  { k: 'badwords', ico: '≡', t: 'Блокировать стандартные недопустимые слова', d: 'Отмечать сообщения, содержащие нецензурную лексику и другие нежелательные слова.', chips: ['✕ блокировать сообщение', '# отправить оповещение'], btn: 'Настройка' },
  { k: 'custom', ico: '☰+', t: 'Блокировать выбранные пользователем слова', d: 'Создать свой фильтр, чтобы запретить определённую лексику на вашем сервере.', chips: ['✕ блокировать сообщение', '# отправить оповещение', '👤 отстранить участника'], btn: 'Создать' },
]

export function ServerSettings({ server, uid, onClose, onChanged, onDelete }: {
  server: Server; uid: string; onClose: () => void; onChanged: () => void; onDelete: () => void }) {
  const s0: any = (server as any).settings ?? {}
  const { statusOf } = usePresence()
  const [tab, setTab] = useState<Tab>('profile')
  const [rolesView, setRolesView] = useState<'main' | 'everyone' | 'edit'>('main')
  const [selRoleId, setSelRoleId] = useState<string | null>(null)   // роль, открытая в редакторе (v1.96.0)
  const [name, setName] = useState(server.name)
  const [st, setSt] = useState<any>({ ...s0 })
  // v1.128.0: «несохранённые изменения» считаются сравнением с последними
  // сохранёнными значениями — вернул настройку обратно, и плашка пропадает сама.
  const SETTING_DEFAULTS: Record<string, any> = { verification: 0, content_filter: 0, banner: '', description: '', sys_channel: '', default_notif: 'all', afk_channel: '', afk_timeout: '5 минут', access: 'invite' }
  const normSt = (o: any) => { const r: any = {}; for (const k of Object.keys(o ?? {}).sort()) { const v = o[k]; if (v === undefined || v === null || v === false || v === '' || JSON.stringify(v) === JSON.stringify(SETTING_DEFAULTS[k])) continue; r[k] = v } return r }
  const [baseName, setBaseName] = useState(server.name)
  const [baseSt, setBaseSt] = useState(() => JSON.stringify(normSt(s0)))
  const dirty = name !== baseName || JSON.stringify(normSt(st)) !== baseSt
  const setDirty = (_d: boolean) => {}
  const [busy, setBusy] = useState(false)
  const chFontRef = useRef<HTMLInputElement>(null)   // v1.140.0: свой файл шрифта названий каналов
  const tagFontRef = useRef<HTMLInputElement>(null)  // v1.175.0: свой файл шрифта тега сервера
  const [tagEmojiOpen, setTagEmojiOpen] = useState(false)
  const [members, setMembers] = useState<any[]>([])
  const [roles, setRoles] = useState<ServerRole[]>([])
  const [memberRoles, setMemberRoles] = useState<Record<string, string[]>>({})  // v1.96.0: user_id -> все его роли
  const [invites, setInvites] = useState<any[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [mq, setMq] = useState('')       // поиск по участникам
  const [bq, setBq] = useState('')       // поиск по банам
  const [bqDone, setBqDone] = useState<string | null>(null)  // v1.109.0: выполненный поиск по банам
  // v1.156.0: реальный список банов + кик/бан участников (миграция 34_permissions.sql).
  const [bans, setBans] = useState<(ServerBan & { name?: string; avatar_url?: string | null })[]>([])
  const isOwner = server.owner === uid
  const rolesOfId = (userId: string): string[] => {
    const multi = memberRoles[userId]
    if (multi && multi.length) return multi
    const mm = members.find(m => m.user_id === userId)
    return mm?.role_id ? [mm.role_id] : []
  }
  const permsOfId = (userId: string): number => rolesOfId(userId).reduce((m, id) => m | (roles.find(r => r.id === id)?.permissions ?? 0), 0)
  const topPositionOfId = (userId: string): number => {
    let best = Infinity
    for (const id of rolesOfId(userId)) { const r = roles.find(x => x.id === id); if (r && r.position < best) best = r.position }
    return best
  }
  // v1.191.0: + server-wide base_permissions, см. пояснение в ServerView.tsx.
  const myPerms = permsOfId(uid) | (server.base_permissions ?? 0)
  const canKick = isOwner || hasPerm(myPerms, PERM.KICK_MEMBERS)
  const canBan = isOwner || hasPerm(myPerms, PERM.BAN_MEMBERS)
  const canManageEmoji = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER) || hasPerm(myPerms, PERM.MANAGE_EMOJI)
  const canViewAudit = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER) || hasPerm(myPerms, PERM.VIEW_AUDIT_LOG)
  const canManageAutomod = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER) || hasPerm(myPerms, PERM.MANAGE_AUTOMOD)
  const canManageWebhooks = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER) || hasPerm(myPerms, PERM.MANAGE_WEBHOOKS)
  const canOwnerLevel = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER)   // разделы, которые новые точечные права не открывают (профиль, доступ, безопасность, участники, баны, приглашения, удаление)
  async function loadBans() {
    const list = await fetchBans(server.id)
    if (list.length === 0) { setBans([]); return }
    const { data } = await supabase.from('profiles').select('id, username, avatar_url').in('id', list.map(b => b.user_id))
    const byId = new Map(((data ?? []) as any[]).map(p => [p.id, p]))
    setBans(list.map(b => ({ ...b, name: byId.get(b.user_id)?.username, avatar_url: byId.get(b.user_id)?.avatar_url ?? null })))
  }
  async function doKick(m: any) {
    if (!await confirmUi('Кикнуть «' + m.member_name + '» с сервера?', { okText: 'Кикнуть' })) return
    try { await kickMember(server.id, m.user_id); setMembers(await listMembers(server.id)); toastOk('Участник кикнут') }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  async function doBan(m: any) {
    if (!await confirmUi('Забанить «' + m.member_name + '»? Он не сможет вернуться по приглашению.', { okText: 'Забанить' })) return
    try { await banMember(server.id, m.user_id); setMembers(await listMembers(server.id)); await loadBans(); toastOk('Участник забанен') }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  async function doUnban(userId: string) {
    try { await unbanMember(server.id, userId); await loadBans(); toastOk('Разбанен') }
    catch (e: any) { toastErr(e.message ?? String(e)) }
  }
  const [newRole, setNewRole] = useState('')
  const [newRoleColor, setNewRoleColor] = useState(ROLE_COLORS[0])
  const [showDelete, setShowDelete] = useState(false)
  const [delName, setDelName] = useState('')
  const avRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const invBgRef = useRef<HTMLInputElement>(null)
  const emojiRef = useRef<HTMLInputElement>(null)
  const stkRef = useRef<HTMLInputElement>(null)
  const sndRef = useRef<HTMLInputElement>(null)
  const [avatar, setAvatar] = useState<string | null>(server.avatar_url ?? null)
  const initials = (server.name || 'S').slice(0, 2).toUpperCase()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    listMembers(server.id).then(setMembers)
    fetchRoles(server.id).then(setRoles)
    fetchMemberRoles(server.id).then(setMemberRoles)
    loadBans()
    supabase.from('channels').select('*').eq('server_id', server.id).order('name')
      .then(({ data }) => setChannels((data ?? []) as Channel[]))
    supabase.from('server_invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false })
      .then(({ data }) => setInvites(data ?? []))
  }, [server.id])

  // Обычные правки копятся и сохраняются кнопкой в савбаре.
  function up(k: string, v: any) { setSt((s: any) => ({ ...s, [k]: v })); setDirty(true) }
  // Загрузки файлов и «мгновенные» действия сохраняются сразу.
  async function persistNow(next: any) {
    setSt(next)
    setBaseSt(JSON.stringify(normSt(next)))   // v1.128.0: мгновенное сохранение — сразу в «базу»
    const { error } = await supabase.from('servers').update({ settings: next } as any).eq('id', server.id)
    if (error) toastErr('Примени миграцию supabase/17_server_settings.sql — настройки пока не сохраняются')
    else onChanged()
  }
  // v1.178.0: тег сервера — раньше название/значок/цвет/шрифт-пресет копились в
  // силе (up()) и терялись, если закрыть настройки без «Сохранить изменения»;
  // сохранялся сразу только загруженный файл шрифта. Теперь весь тег — как файлы,
  // сохраняется мгновенно при любом изменении.
  function setTag(patch: any) { persistNow({ ...st, tag: { ...(st.tag ?? {}), ...patch } }) }
  async function saveAll() {
    const nm = name.trim() || server.name
    const { error } = await supabase.from('servers').update({ name: nm, settings: st } as any).eq('id', server.id)
    if (error) {
      const r2 = await supabase.from('servers').update({ name: nm }).eq('id', server.id)
      if (r2.error) return toastErr(r2.error.message)
      toastErr('Имя сохранено. Для остальных настроек примени миграцию supabase/17_server_settings.sql')
    } else toastOk('Изменения сохранены')
    setBaseName(nm); setName(nm); setBaseSt(JSON.stringify(normSt(st))); onChanged()   // v1.128.0
  }
  function resetAll() { setName(baseName); setSt(JSON.parse(baseSt)) }   // v1.128.0: сброс к последним сохранённым

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>, cb: (url: string, f: File) => void) {
    const f = e.target.files?.[0]; if (!f) return
    setBusy(true)
    try { cb(await uploadTo('avatars', uid, f), f) }
    catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false); e.target.value = '' }
  }
  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    await pickFile(e, async url => { setAvatar(url); await updateServer(server.id, { avatar_url: url }); onChanged() })
  }
  const cleanName = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[^\wа-яё-]+/gi, '_').slice(0, 32) || 'file'

  async function makeInvite() {
    const res = await createInvite(server.id, uid)
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
  async function addRole() {
    const nm = newRole.trim(); if (!nm) return
    const { error } = await createRole(server.id, nm, newRoleColor)
    if (error) return toastErr(String(error.message ?? error).includes('server_roles') ? 'Сначала примени миграцию supabase/12_roles.sql' : String(error.message ?? error))
    setNewRole(''); setRoles(await fetchRoles(server.id)); toastOk('Роль «' + nm + '» создана')
  }

  // v1.96.0: полный перезабор ролей/назначений после правок в редакторе ролей.
  async function reloadRoles() {
    setRoles(await fetchRoles(server.id))
    setMemberRoles(await fetchMemberRoles(server.id))
    setMembers(await listMembers(server.id))
  }

  // Перестановка ролей (иерархия): двигаем на шаг и сохраняем позиции 0..n-1.
  async function moveRole(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= roles.length) return
    const next = [...roles]
    ;[next[i], next[j]] = [next[j], next[i]]
    setRoles(next)
    const { error } = await saveRoleOrder(next)
    if (error) toastErr(String((error as any).message ?? error))
  }

  const tri = (k: string) => {
    const cur = (st.everyone_perms ?? {})[k] ?? 'default'
    const set = (v: string) => up('everyone_perms', { ...(st.everyone_perms ?? {}), [k]: v })
    return (
      <div className="cset-tri">
        <button className={'deny' + (cur === 'deny' ? ' on' : '')} title="Запретить" onClick={() => set('deny')}><Icon name="close" size={13} /></button>
        <button className={'def' + (cur === 'default' ? ' on' : '')} title="По умолчанию" onClick={() => set('default')}>／</button>
        <button className={'allow' + (cur === 'allow' ? ' on' : '')} title="Разрешить" onClick={() => set('allow')}><Icon name="check" size={13} /></button>
      </div>
    )
  }
  const toggleRow = (t: string, d: string, k: string, dflt = false) => (
    <div className="cset-row">
      <div><div className="cset-row-t">{t}</div><div className="cset-hint">{d}</div></div>
      <button className={'tgl' + ((st[k] ?? dflt) ? ' on' : '')} onClick={() => up(k, !(st[k] ?? dflt))} />
    </div>
  )
  const fmtD = (x: string) => new Date(x).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  const online = members.filter(m => statusOf(m.user_id) !== 'offline').length
  const canManageRolesTab = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER) || hasPerm(myPerms, PERM.MANAGE_ROLES)
  // v1.191.0: точечные права (см. supabase/49_role_perms2.sql) открывают доступ
  // к конкретным вкладкам без полного MANAGE_SERVER — раньше все вкладки были
  // видны любому, кто вообще мог открыть настройки (эффективно = MANAGE_SERVER).
  const NAV_RAW: { cat?: string; k?: Tab; t?: string; ok?: boolean }[] = [
    { cat: 'Сервер ' + server.name }, { k: 'profile', t: 'Профиль сервера', ok: canOwnerLevel }, { k: 'tag', t: 'Тег сервера', ok: canOwnerLevel }, { k: 'engage', t: 'Вовлечённость', ok: canOwnerLevel },
    { cat: 'Реакции' }, { k: 'emoji', t: 'Эмодзи', ok: canManageEmoji }, { k: 'stickers', t: 'Стикеры', ok: canManageEmoji }, { k: 'sound', t: 'Звуковая панель', ok: canOwnerLevel },
    { cat: 'Люди' }, { k: 'members', t: 'Участники', ok: canOwnerLevel }, { k: 'roles', t: 'Роли', ok: canManageRolesTab }, { k: 'invites', t: 'Приглашения', ok: canOwnerLevel }, { k: 'access', t: 'Доступ', ok: canOwnerLevel },
    { cat: 'Модерация' }, { k: 'security', t: 'Настройка безопасности', ok: canOwnerLevel }, { k: 'audit', t: 'Журнал аудита', ok: canViewAudit }, { k: 'bans', t: 'Баны', ok: canOwnerLevel }, { k: 'automod', t: 'Автомод', ok: canManageAutomod },
    { cat: 'Интеграции' }, { k: 'bots', t: 'Боты', ok: canManageWebhooks },
  ]
  // Прячем категории, у которых после фильтра по правам не осталось ни одной вкладки.
  const NAV = NAV_RAW.filter((n, i) => {
    if (!n.cat) return n.ok
    const next = NAV_RAW.slice(i + 1).findIndex(x => x.cat)
    const rest = next === -1 ? NAV_RAW.slice(i + 1) : NAV_RAW.slice(i + 1, i + 1 + next)
    return rest.some(x => x.ok)
  })
  // Точечное право может открыть настройки без MANAGE_SERVER (см. canManage в
  // ServerView.tsx) — если текущая вкладка такому пользователю не видна (по
  // умолчанию 'profile', доступна только владельцам настроек), переключаем на
  // первую, которая реально есть в его NAV.
  useEffect(() => {
    if (NAV.some(n => n.k === tab)) return
    const first = NAV.find(n => n.k)
    if (first?.k) setTab(first.k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canOwnerLevel, canManageEmoji, canViewAudit, canManageAutomod, canManageRolesTab])
  const filtered = members.filter(m => !mq.trim() || (m.member_name ?? '').toLowerCase().includes(mq.trim().toLowerCase()))
  const vl = VERIF_LEVELS[st.verification ?? 0] ?? VERIF_LEVELS[0]
  const fl = FILTER_LEVELS[st.content_filter ?? 0] ?? FILTER_LEVELS[0]

  return createPortal(
    <div className="cset sset">
      <div className="cset-side">
        <nav className="cset-nav">
          {NAV.map((n, i) => n.cat
            ? <div key={i} className="cset-cat">{n.cat}</div>
            : <div key={i} className={'cset-tab' + (tab === n.k ? ' on' : '')} onClick={() => { setTab(n.k!); setRolesView('main') }}>{n.t}</div>)}
          <div className="cset-sep" />
          <div className={'cset-tab' + (tab === 'community' ? ' on' : '')} onClick={() => setTab('community')}>Включить сообщество</div>
          <div className="cset-sep" />
          <div className={'cset-tab' + (tab === 'template' ? ' on' : '')} onClick={() => setTab('template')}>Шаблон сервера</div>
          <div className="cset-tab danger" onClick={() => { setDelName(''); setShowDelete(true) }}>Удалить сервер <Icon name="trash" size={15} /></div>
        </nav>
      </div>
      <div className="cset-main">
        <button className="cset-esc" onClick={onClose}><span className="cset-esc-circle"><Icon name="close" size={16} /></span>ESC</button>

        {tab === 'profile' && <div className="sset-cols">
          <div className="sset-colmain">
            <div className="cset-h">Профиль сервера</div>
            <div className="cset-hint" style={{ marginTop: -12 }}>Настройте отображение вашего сервера в ссылках-приглашениях, а также сообщениях «Путешествия по серверам» и канала с объявлениями, если эти функции активны</div>
            <label className="cset-lbl">Имя</label>
            <input className="modal-in" value={name} onChange={e => { setName(e.target.value); setDirty(true) }} />
            <div className="cset-div" />
            <label className="cset-lbl">Значок</label>
            <div className="cset-hint" style={{ marginTop: 0 }}>Мы рекомендуем использовать изображение размером как минимум 512x512.</div>
            <button className="modal-primary" style={{ marginTop: 10 }} onClick={() => avRef.current?.click()}>{busy ? '…' : 'Изменить значок сервера'}</button>
            <input ref={avRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            <div className="cset-div" />
            <label className="cset-lbl">Баннер</label>
            <div className="sset-swatches">
              {BANNER_COLORS.map(c => (
                <div key={c || 'default'} className={'sset-sw' + ((st.banner ?? '') === c ? ' on' : '')}
                  style={{ background: c || 'linear-gradient(160deg,#3a3d44,#17181c)' }} onClick={() => persistNow({ ...st, banner: c })} />
              ))}
            </div>
            <div className="cset-div" />
            <label className="cset-lbl">Фоновый баннер сервера</label>
            <div className="cset-hint" style={{ marginTop: 0 }}>Это изображение будет помещено над списком ваших каналов. Рекомендуемый минимальный размер составляет 960x540, рекомендуемое соотношение сторон — 16:9. В Ponoi это бесплатно.</div>
            <div className="sset-upbox" style={st.banner_url ? { backgroundImage: `url(${st.banner_url})` } : undefined} onClick={() => bannerRef.current?.click()}>
              {!st.banner_url && <Icon name="image" size={26} />}
            </div>
            {st.banner_url && <button className="modal-ghost" style={{ marginTop: 8 }} onClick={() => persistNow({ ...st, banner_url: null })}>Убрать баннер</button>}
            <input ref={bannerRef} type="file" accept="image/*" hidden onChange={e => pickFile(e, url => persistNow({ ...st, banner_url: url }))} />
            <div className="cset-div" />
            <label className="cset-lbl">Фон приглашения на сервер</label>
            <div className="cset-hint" style={{ marginTop: 0 }}>Это изображение будет отображаться при просмотре вашего приглашения на сервер в браузере, а также на экране подтверждения приглашения и во время адаптации. Рекомендуемый минимальный размер составляет 1920x1080, рекомендуемое соотношение сторон — 16:9. В Ponoi это бесплатно.</div>
            <div className="sset-upbox" style={st.invite_bg ? { backgroundImage: `url(${st.invite_bg})` } : undefined} onClick={() => invBgRef.current?.click()}>
              {!st.invite_bg && <Icon name="image" size={26} />}
            </div>
            {st.invite_bg && <button className="modal-ghost" style={{ marginTop: 8 }} onClick={() => persistNow({ ...st, invite_bg: null })}>Убрать фон</button>}
            <input ref={invBgRef} type="file" accept="image/*" hidden onChange={e => pickFile(e, url => persistNow({ ...st, invite_bg: url }))} />
            <div className="cset-div" />
            <label className="cset-lbl">Шрифт названий каналов</label>
            <div className="cset-hint" style={{ marginTop: 0, marginBottom: 10 }}>Этим шрифтом пишутся названия всех каналов в списке слева. Отдельному каналу можно задать свой шрифт в его настройках («Обзор»).</div>
            <div className="pqs-font-grid">
              {CH_FONTS.map(f => (
                <button key={f.id || 'sys'} className={'pqs-font-btn' + (!st.ch_font_url && (st.ch_font ?? '') === f.id ? ' on' : '')} onClick={() => persistNow({ ...st, ch_font: f.id, ch_font_url: null })}>
                  <span className="pqs-font-sample" style={f.id ? { fontFamily: f.id } : undefined}># общий</span>
                  <small>{f.name}</small>
                </button>
              ))}
              <button className={'pqs-font-btn' + (st.ch_font_url ? ' on' : '')} onClick={() => chFontRef.current?.click()}>{/* v1.140.0: свой файл шрифта */}
                <span className="pqs-font-sample" style={st.ch_font_url ? { fontFamily: chFontFamily(st.ch_font_url) } : undefined}># общий</span>
                <small>{st.ch_font_url ? 'Свой шрифт — заменить' : 'Загрузить свой (.ttf/.otf/.woff2)'}</small>
              </button>
            </div>
            <input ref={chFontRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={e => pickFile(e, url => persistNow({ ...st, ch_font_url: url }))} />
            {st.ch_font_url && <button className="pqs2-btn ghost" style={{ marginTop: 8 }} onClick={() => persistNow({ ...st, ch_font_url: null })}>Убрать свой шрифт</button>}
            <div className="cset-div" />
            <label className="cset-lbl">Особенности</label>
            <div className="cset-hint" style={{ marginTop: 0, marginBottom: 10 }}>Добавьте до 5 особенностей, соответствующих интересам и характеру участников вашего сервера.</div>
            <div className="sset-feats">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="sset-feat">🙂 <input maxLength={24} value={(st.features ?? [])[i] ?? ''}
                  onChange={e => { const f = [...(st.features ?? ['', '', '', '', ''])]; f[i] = e.target.value; up('features', f) }} /></div>
              ))}
            </div>
            <label className="cset-lbl">Описание</label>
            <textarea className="cset-topic" maxLength={300} placeholder="Почему вы создали этот сервер? Зачем пользователям к нему присоединяться?"
              value={st.description ?? ''} onChange={e => up('description', e.target.value)} />
          </div>
          <div className="sset-prev">
            <div className="sset-prev-banner" style={st.banner_url ? { background: `url(${st.banner_url}) center/cover` } : st.banner ? { background: st.banner } : undefined} />
            <div className="sset-prev-body">
              <div className="sset-prev-av" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{!avatar && initials}</div>
              <div className="sset-prev-nm">{name || server.name}{st.tag?.name && <span className="sset-tagchip" style={{ background: (st.tag?.color ?? '#5865f2') + '33', color: st.tag?.color ?? '#5865f2', marginLeft: 6, fontFamily: tagFontFamily(st.tag) }}>{st.tag?.icon && <TagEmoji e={st.tag.icon} />} {st.tag?.name}</span>}</div>
              <div className="sset-prev-meta"><span className="sset-dot on" /> {online} в сети <span className="sset-dot off" /> {members.length} {members.length === 1 ? 'участник' : 'участников'}</div>
              <div className="sset-prev-meta">Дата основания: {new Date(server.created_at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</div>
              {(st.description ?? '') && <div className="sset-prev-meta" style={{ marginTop: 8 }}>{st.description}</div>}
            </div>
          </div>
        </div>}

        {tab === 'tag' && <>
          <div className="cset-h">Тег сервера</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Создайте тег, который будет отображаться рядом с именем участников вашего сервера (если они захотят, конечно)! Благодаря тегу сервера любой пользователь Ponoi сможет просматривать профиль вашего сервера — и даже подать заявку на вступление, если у вас включена эта опция. В Ponoi теги бесплатны для всех серверов.</div>
          <label className="cset-lbl">Выберите название</label>
          <div className="sset-tagname">
            <div className="sset-tagchip big" style={{ background: (st.tag?.color ?? '#5865f2') + '33', color: st.tag?.color ?? '#5865f2', fontFamily: tagFontFamily(st.tag) }}>
              {st.tag?.icon ? <TagEmoji e={st.tag.icon} /> : TAG_ICONS[1]} {(st.tag?.name ?? '') || 'WUMP'}
            </div>
            <input className="modal-in" style={{ width: 130, textTransform: 'uppercase' }} maxLength={4} placeholder="ТЕГ"
              value={st.tag?.name ?? ''} onChange={e => up('tag', { ...(st.tag ?? {}), name: e.target.value.toUpperCase() })}
              onBlur={() => setTag({ name: st.tag?.name ?? '' })}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            <span className="cset-hint" style={{ margin: 0 }}>Вы можете использовать максимум 4 символа, буквы алфавита и цифры.</span>
          </div>
          <div className="sset-info"><Icon name="shield" size={15} /> После обновления тега всем участникам сервера потребуется заново установить его у себя в профиле. Мы делаем это в целях предотвращения злоупотребления.</div>
          <label className="cset-lbl">Выберите значок</label>
          <div className="cset-hint" style={{ marginTop: 0, marginBottom: 10 }}>Изменив только значок, вы не удалите тег сервера у участников. Кроме набора ниже, можно выбрать вообще любой эмодзи.</div>
          <div className="sset-tagico" style={{ position: 'relative' }}>
            {TAG_ICONS.map(ic => (
              <button key={ic} className={(st.tag?.icon ?? TAG_ICONS[1]) === ic ? 'on' : ''} onClick={() => { setTag({ icon: ic }); setTagEmojiOpen(false) }}>{ic}</button>
            ))}
            <button className={st.tag?.icon && !TAG_ICONS.includes(st.tag.icon) ? 'on' : ''} title="Выбрать любой эмодзи" onClick={() => setTagEmojiOpen(v => !v)}>
              {st.tag?.icon && !TAG_ICONS.includes(st.tag.icon) ? <TagEmoji e={st.tag.icon} /> : <Icon name="plus" size={20} />}
            </button>
            {tagEmojiOpen && <div className="sset-emojipop">
              <EmojiPicker onPick={e => { setTag({ icon: e }); setTagEmojiOpen(false) }} onClose={() => setTagEmojiOpen(false)} />
            </div>}
          </div>
          <label className="cset-lbl">Выберите цвет</label>
          <div className="sset-swatches">
            {ROLE_COLORS.map(c => (
              <div key={c} className={'sset-sw small' + ((st.tag?.color ?? '#5865f2') === c ? ' on' : '')} style={{ background: c }}
                onClick={() => setTag({ color: c })} />
            ))}
            <label className={'sset-sw small custom' + (st.tag?.color && !ROLE_COLORS.includes(st.tag.color) ? ' on' : '')} title="Свой цвет">
              <input type="color" value={st.tag?.color ?? '#5865f2'} onChange={e => setTag({ color: e.target.value })} />
              <Icon name="edit" size={14} />
            </label>
          </div>
          <label className="pqs-lbl">Выберите шрифт</label>
          <div className="cset-hint" style={{ marginTop: 0, marginBottom: 10 }}>Шрифт текста тега — виден всем, кто видит тег рядом с чьим-то ником.</div>
          <div className="pqs-font-grid">
            {CH_FONTS.map(f => (
              <button key={f.id || 'sys'} className={'pqs-font-btn' + (!st.tag?.fontUrl && (st.tag?.font ?? '') === f.id ? ' on' : '')}
                onClick={() => setTag({ font: f.id, fontUrl: null })}>
                <span className="pqs-font-sample" style={f.id ? { fontFamily: f.id } : undefined}>{(st.tag?.name ?? '') || 'ТЕГ'}</span>
                <small>{f.name}</small>
              </button>
            ))}
            <button className={'pqs-font-btn' + (st.tag?.fontUrl ? ' on' : '')} onClick={() => tagFontRef.current?.click()}>
              <span className="pqs-font-sample" style={st.tag?.fontUrl ? { fontFamily: tagFontFamily(st.tag) } : undefined}>{(st.tag?.name ?? '') || 'ТЕГ'}</span>
              <small>{st.tag?.fontUrl ? 'Свой шрифт — заменить' : 'Загрузить свой (.ttf/.otf/.woff2)'}</small>
            </button>
          </div>
          {st.tag?.fontUrl && <button className="pqs2-btn ghost" style={{ marginTop: 8 }} onClick={() => setTag({ fontUrl: null })}>Убрать свой шрифт</button>}
          <input ref={tagFontRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={e => pickFile(e, url => setTag({ fontUrl: url }))} />
        </>}

        {tab === 'engage' && <>
          <div className="cset-h">Вовлечённость</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Управление настройками, помогающими поддерживать активность на вашем сервере.</div>
          <div className="cset-h" style={{ fontSize: 17, marginTop: 24, marginBottom: 0 }}>Системные сообщения</div>
          <div className="cset-hint" style={{ marginTop: 4 }}>Настройте системные сообщения о событиях, отправляемые на ваш сервер.</div>
          {toggleRow('Отправлять случайное приветственное сообщение, когда пользователь подключается к этому серверу.', '', 'sys_welcome', true)}
          {toggleRow('Предлагать участникам отвечать на приветственное сообщение стикером.', '', 'sys_sticker', true)}
          {toggleRow('Отправить полезные советы для настройки сервера.', '', 'sys_tips', true)}
          <label className="cset-lbl">Канал системных сообщений</label>
          <div className="cset-hint" style={{ marginTop: 0, marginBottom: 8 }}>На этом канале мы публикуем системные сообщения о событиях.</div>
          <select className="modal-in" value={st.sys_channel ?? ''} onChange={e => up('sys_channel', e.target.value)}>
            {channels.filter(c => (c as any).kind !== 'voice').map(c => <option key={c.id} value={c.id}># {c.name}</option>)}
          </select>
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 17, marginBottom: 0 }}>Настройки ленты событий</div>
          <div className="cset-hint" style={{ marginTop: 4 }}>Здесь отображается информация о событиях из игр и подключённых приложений на этом сервере.</div>
          {toggleRow('Показать ленту событий этого сервера', '', 'feed', true)}
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 17, marginBottom: 0 }}>Стандартные настройки уведомлений</div>
          <div className="cset-hint" style={{ marginTop: 4 }}>Эта опция определит, будут ли участники, не настроившие параметры уведомлений для сервера, получать их при каждом отправленном сообщении.</div>
          <div className={'cset-radio' + ((st.default_notif ?? 'all') === 'all' ? ' on' : '')} onClick={() => up('default_notif', 'all')}><span className="dot" /> Все сообщения</div>
          <div className={'cset-radio' + (st.default_notif === 'mentions' ? ' on' : '')} onClick={() => up('default_notif', 'mentions')}><span className="dot" /> Только @упоминания</div>
          <div className="cset-hint">Для сервера сообщества мы настоятельно рекомендуем установить эту опцию исключительно на @упоминания.</div>
          <div className="cset-div" />
          <div className="sset-2col">
            <div>
              <label className="cset-lbl">Канал для бездействия</label>
              <select className="modal-in" value={st.afk_channel ?? ''} onChange={e => up('afk_channel', e.target.value)}>
                <option value="">Нет канала для бездействия</option>
                {channels.filter(c => (c as any).kind === 'voice').map(c => <option key={c.id} value={c.id}>🔊 {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="cset-lbl">Время бездействия</label>
              <select className="modal-in" value={st.afk_timeout ?? '5 минут'} onChange={e => up('afk_timeout', e.target.value)}>
                {['1 минута', '5 минут', '15 минут', '30 минут', '1 час'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </>}

        {tab === 'emoji' && <>
          <div className="cset-h">Эмодзи</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Добавьте пользовательские эмодзи для всех на этом сервере. В Ponoi — без лимитов и подписок: любые эмодзи, в том числе анимированные, доступны всем.</div>
          <button className="modal-primary" style={{ marginTop: 14 }} onClick={() => emojiRef.current?.click()}>{busy ? '…' : 'Загрузить эмодзи'}</button>
          <input ref={emojiRef} type="file" accept="image/*" hidden onChange={e => pickFile(e, (url, f) => persistNow({ ...st, emojis: [...(st.emojis ?? []), { name: cleanName(f), url }] }))} />
          <div className="cset-hint" style={{ marginTop: 10 }}>Если вы хотите загрузить несколько эмодзи или пропустить редактирование, перетащите файлы на эту страницу. Эмодзи будут названы именем файла.</div>
          <div className="cset-div" />
          {(st.emojis ?? []).length === 0
            ? <div className="sset-empty">🙂<b>ЭМОДЗИ НЕТ</b>Начните вечеринку, загрузив эмодзи</div>
            : <div className="sset-egrid">{(st.emojis ?? []).map((em: any, i: number) => (
              <div key={i} className="sset-ecell">
                <img src={em.url} alt={em.name} />
                <div className="nm">:{em.name}:</div>
                <button className="sset-edel" onClick={() => persistNow({ ...st, emojis: (st.emojis ?? []).filter((_: any, j: number) => j !== i) })}><Icon name="close" size={11} /></button>
              </div>))}</div>}
        </>}

        {tab === 'stickers' && <>
          <div className="cset-h">Стикеры</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Загружайте стикеры, которые будут доступны всем участникам сервера. В Ponoi нет уровней и слотов — стикеров может быть сколько угодно, бесплатно.</div>
          <button className="modal-primary" style={{ marginTop: 14 }} onClick={() => stkRef.current?.click()}>{busy ? '…' : 'Загрузить стикер'}</button>
          <input ref={stkRef} type="file" accept="image/*" hidden onChange={e => pickFile(e, (url, f) => persistNow({ ...st, stickers: [...(st.stickers ?? []), { name: cleanName(f), url }] }))} />
          <div className="cset-div" />
          {(st.stickers ?? []).length === 0
            ? <div className="sset-empty">🎟️<b>СТИКЕРОВ НЕТ</b>Загрузите первый стикер, чтобы начать тусу</div>
            : <div className="sset-egrid stk">{(st.stickers ?? []).map((em: any, i: number) => (
              <div key={i} className="sset-ecell">
                <img src={em.url} alt={em.name} style={{ width: 72, height: 72 }} />
                <div className="nm">{em.name}</div>
                <button className="sset-edel" onClick={() => persistNow({ ...st, stickers: (st.stickers ?? []).filter((_: any, j: number) => j !== i) })}><Icon name="close" size={11} /></button>
              </div>))}</div>}
        </>}

        {tab === 'sound' && <>
          <div className="cset-h">Звуковая панель</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Загрузите звуковые реакции, которые будут доступны всем участникам сервера.</div>
          {(st.sounds ?? []).length === 0
            ? <div className="sset-empty">🔊<b>НЕТ ЗВУКОВ</b>Загрузите звук, чтобы начать тусу<br /><button className="modal-primary" style={{ marginTop: 14 }} onClick={() => sndRef.current?.click()}>{busy ? '…' : 'Загрузить звук'}</button></div>
            : <>
              <button className="modal-primary" style={{ marginTop: 14 }} onClick={() => sndRef.current?.click()}>{busy ? '…' : 'Загрузить звук'}</button>
              <div className="sset-egrid">{(st.sounds ?? []).map((em: any, i: number) => (
                <div key={i} className="sset-ecell clickable" onClick={() => { try { new Audio(em.url).play() } catch {} }}>
                  <Icon name="play" size={26} />
                  <div className="nm">{em.name}</div>
                  <button className="sset-edel" onClick={e => { e.stopPropagation(); persistNow({ ...st, sounds: (st.sounds ?? []).filter((_: any, j: number) => j !== i) }) }}><Icon name="close" size={11} /></button>
                </div>))}</div>
            </>}
          <input ref={sndRef} type="file" accept="audio/*" hidden onChange={e => pickFile(e, (url, f) => persistNow({ ...st, sounds: [...(st.sounds ?? []), { name: cleanName(f), url }] }))} />
        </>}

        {tab === 'members' && <>
          <div className="cset-h">Участники сервера</div>
          <div className="cset-row" style={{ marginTop: 0 }}>
            <div><div className="cset-row-t">Показать участников в списке каналов</div>
              <div className="cset-hint">При включении этого параметра страницы участников будут показаны в списке каналов. Это позволит вам быстро посмотреть, кто недавно присоединился к вашему серверу, и принять решение в отношении пользователей, замеченных в подозрительной деятельности.</div></div>
            <button className={'tgl' + (st.members_in_list ? ' on' : '')} onClick={() => up('members_in_list', !st.members_in_list)} />
          </div>
          <div className="cset-div" />
          <div className="sset-mtop">
            <b>Недавние участники</b>
            <input className="modal-in" style={{ width: 240, margin: 0 }} placeholder="Поиск по имени пользователя" value={mq} onChange={e => setMq(e.target.value)} />
          </div>
          <table className="sset-table">
            <thead><tr><th>Имя</th><th>В числе участников с</th><th>В Ponoi с</th><th>Способ вступления</th><th>Роли</th><th>Сигналы</th><th /></tr></thead>
            <tbody>
              {filtered.map(m => {
                const mrs = (memberRoles[m.user_id] ?? (m.role_id ? [m.role_id] : [])).map(id => roles.find(r => r.id === id)).filter(Boolean) as ServerRole[]
                // v1.156.0: кик/бан — не владельцу, не себе, и только если моя старшая роль строго выше жертвы.
                const targetable = m.user_id !== uid && m.role !== 'owner' && (isOwner || topPositionOfId(uid) < topPositionOfId(m.user_id))
                return (
                  <tr key={m.user_id}>
                    <td><div className="sset-mrow">
                      <div className="sset-mav" style={m.avatar_url ? { backgroundImage: `url(${m.avatar_url})` } : undefined}>{!m.avatar_url && (m.member_name ?? '?').slice(0, 1).toUpperCase()}</div>
                      {m.member_name}{m.role === 'owner' && <Icon name="crown" size={13} />}
                    </div></td>
                    <td>{m.joined_at ? fmtD(m.joined_at) : '—'}</td>
                    <td>—</td>
                    <td>{m.role === 'owner' ? 'Создатель сервера' : 'Приглашение'}</td>
                    <td>{mrs.length === 0
                      ? <span className="sset-rolechip"><span className="role-dot" style={{ background: '#99aab5' }} />Участник</span>
                      : mrs.map(r => <span key={r.id} className="sset-rolechip"><span className="role-dot" style={{ background: r.color }} />{r.name}</span>)}</td>
                    <td>—</td>
                    <td>{targetable && <div className="sset-mactions">
                      {canKick && <button className="sset-mact" title="Кикнуть" onClick={() => doKick(m)}><Icon name="signout" size={14} /></button>}
                      {canBan && <button className="sset-mact danger" title="Забанить" onClick={() => doBan(m)}><Icon name="trash" size={14} /></button>}
                    </div>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="sset-empty">🔎<b>НИКОГО НЕ НАШЛОСЬ</b>Попробуйте другой запрос</div>}
        </>}

        {tab === 'roles' && rolesView === 'main' && <>
          <div className="cset-h">Роли</div>
          <div className="sset-rhero">
            <div className="sset-rwump">
              <div style={{ fontSize: 34 }}>🤖</div>
              <div style={{ fontWeight: 800, marginTop: 4 }}>Wumpus#0000</div>
              <div className="sset-rchips">
                {['президент', 'лидер', 'тренер', 'новичок', 'выпускники', 'ученик'].map((r, i) => (
                  <span key={r} className="sset-rchip"><span className="role-dot" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />{r}</span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="cset-h" style={{ marginBottom: 6 }}>Организуйте своих участников</div>
            <div className="cset-hint">Используйте роли для создания групп с участниками сервера и настройки их прав.</div>
          </div>
          <div className="sset-rolecreate">
            <input className="modal-in" style={{ flex: 1, margin: 0 }} placeholder="Название новой роли (например: Модератор)" value={newRole}
              onChange={e => setNewRole(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRole() }} />
            <div className="sset-swpick">
              {ROLE_COLORS.slice(0, 6).map(c => <span key={c} className={'sset-swdot' + (newRoleColor === c ? ' on' : '')} style={{ background: c }} onClick={() => setNewRoleColor(c)} />)}
            </div>
            <button className="modal-primary" onClick={addRole}>Создание роли</button>
          </div>
          {roles.length > 0 && <div className="sset-rolelist">
            <div className="cset-hint" style={{ margin: '0 0 6px' }}>Порядок ниже — это иерархия: чем выше роль, тем выше её секция в списке участников сервера.</div>
            {roles.map((r, i) => (
              <div key={r.id} className="sset-rolerow">
                <span className="sset-rmove">
                  <button title="Выше" disabled={i === 0} onClick={() => moveRole(i, -1)}><Icon name="chevron-down" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
                  <button title="Ниже" disabled={i === roles.length - 1} onClick={() => moveRole(i, 1)}><Icon name="chevron-down" size={13} /></button>
                </span>
                <span className="role-dot" style={{ background: r.color }} /><b className="sset-rolename" title="Редактировать роль" onClick={() => { setSelRoleId(r.id); setRolesView('edit') }}>{r.name}</b>
                <label className="sset-rmanage" title="Участники с этой ролью могут открывать и менять настройки сервера. Остальные права — в редакторе роли.">
                  <input type="checkbox" checked={hasPerm(r.permissions, PERM.MANAGE_SERVER)} onChange={async e => {
                    const v = e.target.checked
                    const next = v ? ((r.permissions ?? 0) | PERM.MANAGE_SERVER) : ((r.permissions ?? 0) & ~PERM.MANAGE_SERVER)
                    const { error } = await setRolePermissions(r.id, next)
                    if (error) return toastErr(String(error.message ?? error).includes('permissions') ? 'Сначала примени миграцию supabase/34_permissions.sql в Supabase SQL Editor' : String(error.message ?? error))
                    setRoles(await fetchRoles(server.id))
                  }} /> Управление сервером
                </label>
                <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>{members.filter(m => (memberRoles[m.user_id] ?? (m.role_id ? [m.role_id] : [])).includes(r.id)).length} 👤</span>
                <button className="sset-roledel" title="Редактировать роль" onClick={() => { setSelRoleId(r.id); setRolesView('edit') }}><Icon name="edit" size={14} /></button>
                <button className="sset-roledel" title="Удалить роль" onClick={async () => { await deleteRole(r.id); setRoles(await fetchRoles(server.id)) }}><Icon name="trash" size={14} /></button>
              </div>
            ))}
          </div>}
          <div className="sset-everyone" onClick={() => setRolesView('everyone')}>
            <span className="sset-am-ic"><Icon name="users" size={18} /></span>
            <div style={{ flex: 1 }}><div className="cset-row-t">Права по умолчанию</div>
              <div className="cset-hint">@everyone • распространяется на всех участников сервера</div></div>
            <Icon name="chevron-right" size={18} />
          </div>
        </>}

        {tab === 'roles' && rolesView === 'edit' && selRoleId && <RoleEditor server={server} roles={roles} members={members} memberRoles={memberRoles}
          isOwner={isOwner} myTopPosition={topPositionOfId(uid)}
          roleId={selRoleId} onSelectRole={setSelRoleId} onBack={() => setRolesView('main')} onEveryone={() => setRolesView('everyone')} onReload={reloadRoles} />}

        {tab === 'roles' && rolesView === 'everyone' && <>
          <div className="sset-back" onClick={() => setRolesView('main')}><Icon name="chevron-right" size={16} style={{ transform: 'rotate(180deg)' }} /> НАЗАД</div>
          <div className="cset-h">Права по умолчанию — @everyone</div>
          {EVERYONE_PERMS.map(p => (
            <div key={p.k} className="cset-perm">
              <div className="cset-perm-h">{p.t} {tri(p.k)}</div>
              <div className="cset-hint">{p.d}</div>
            </div>
          ))}
        </>}

        {tab === 'invites' && <>
          <div className="cset-h">Приглашения</div>
          <div className="sset-invtop">
            {invites.length === 0 && <span className="sset-invlbl">Нет активных ссылок-приглашений</span>}
            <div className="sset-invbtns">
              <button className={'cset-pause' + (st.invites_paused ? ' off' : '')} onClick={() => persistNow({ ...st, invites_paused: !st.invites_paused })}>{st.invites_paused ? 'Возобновить приглашения' : 'Приостановить приглашения'}</button>
              <button className="modal-primary" onClick={makeInvite}>Создать ссылку-приглашение</button>
            </div>
          </div>
          {invites.length === 0
            ? <div className="sset-empty">✈️<b>ПОКА НЕТ ПРИГЛАШЕНИЙ</b>Не видите перед собой цели? Вас несёт, словно бумажный самолётик, дрейфующий по небу? Пригласите сюда своих друзей, создав ссылку-приглашение!</div>
            : invites.map(inv => (
              <div key={inv.id} className="cset-inv">
                <span><code>{inv.code}</code> · {fmtD(inv.created_at)}</span>
                <button className="modal-ghost" onClick={() => revoke(inv.id)}>Отозвать</button>
              </div>
            ))}
        </>}

        {tab === 'access' && <>
          <div className="cset-h">Доступ</div>
          <div className="cset-h" style={{ fontSize: 16, marginBottom: 4 }}>Как можно присоединиться к вашему серверу?</div>
          <div className="cset-hint" style={{ marginTop: 0, marginBottom: 14 }}>Вы можете оставить свой сервер приватным или открыть его, чтобы привлечь большую аудиторию.</div>
          <div className="sset-accs">
            {[
              { k: 'invite', ico: '🔒', t: 'Только по приглашению', d: 'К вашему серверу можно сразу присоединиться по приглашению' },
              { k: 'apply', ico: '✉️', t: 'По заявке', d: 'Чтобы присоединиться к серверу, нужно подать заявку на вступление и дождаться её одобрения' },
              { k: 'public', ico: '🌐', t: 'Публичный', d: 'Любой может присоединиться к вашему серверу непосредственно через «Путешествие по серверам»' },
            ].map(a => (
              <div key={a.k} className={'sset-acc' + ((st.access ?? 'invite') === a.k ? ' on' : '')} onClick={() => up('access', a.k)}>
                <div style={{ fontSize: 22 }}>{a.ico}</div><b>{a.t}</b><span>{a.d}</span>
              </div>
            ))}
          </div>
          <div className="cset-div" />
          {toggleRow('Сервер с возрастным ограничением', 'Для просмотра содержимого этого сервера пользователям необходимо подтвердить, что они достигли совершеннолетия.', 'age_restricted')}
          <div className="cset-div" />
          {toggleRow('Правила сервера', 'Прежде чем общаться на сервере и взаимодействовать с другими его участниками, необходимо согласиться с правилами сервера.', 'rules_on')}
          {st.rules_on && <>
            <label className="cset-lbl">Правила</label>
            {(st.rules ?? []).map((r: string, i: number) => (
              <div key={i} className="sset-rule">{i + 1}. {r}
                <button onClick={() => up('rules', (st.rules ?? []).filter((_: string, j: number) => j !== i))}><Icon name="close" size={13} /></button></div>
            ))}
            <div className="sset-ruleadd">
              <input className="modal-in" style={{ margin: 0 }} placeholder="Введите правило" id="sset-rule-in"
                onKeyDown={e => { if (e.key === 'Enter') { const el = e.target as HTMLInputElement; if (el.value.trim()) { up('rules', [...(st.rules ?? []), el.value.trim()]); el.value = '' } } }} />
            </div>
            <div className="cset-hint">Примерные правила: Будьте вежливы и уважительны · Не рассылайте спам и не занимайтесь самопродвижением · Не публикуйте непристойные материалы, а также контент с ограничениями по возрасту.</div>
          </>}
        </>}

        {tab === 'security' && <>
          <div className="cset-h">Настройка безопасности</div>
          <div className="cset-row" style={{ marginTop: 0 }}>
            <div><div className="cset-row-t">Показать участников в списке каналов <span className="sset-beta">Бета</span></div>
              <div className="cset-hint">При включении этого параметра страницы участников будут показаны в списке каналов. Это позволит вам быстро посмотреть, кто недавно присоединился к вашему серверу, и принять решение в отношении пользователей, замеченных в подозрительной деятельности.</div></div>
            <button className={'tgl' + (st.members_in_list ? ' on' : '')} onClick={() => up('members_in_list', !st.members_in_list)} />
          </div>
          <div className="sset-info">В сообществах эта функция активируется автоматически.</div>
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 16, marginBottom: 4 }}>Уровень проверки</div>
          <div className="cset-hint" style={{ marginTop: 0 }}>Участники сервера должны соответствовать указанным критериям, чтобы писать в текстовые каналы или отправлять личные сообщения. Данное условие не действует, если у участника есть назначенная роль.</div>
          <div className="sset-level">
            <div><b>{vl.t}</b><div className="cset-hint" style={{ marginTop: 2 }}>{vl.d}</div></div>
            <button className="cset-link" onClick={() => up('verification', ((st.verification ?? 0) + 1) % VERIF_LEVELS.length)}>Изменить</button>
          </div>
          <div className="cset-div" />
          {toggleRow('Требовать двухфакторную аутентификацию для модераторов', 'У модераторов должна быть включена двухфакторная аутентификация, чтобы они могли банить, выгонять или отстранять участников, а также удалять сообщения. Этот параметр может изменить только владелец сервера.', 'mod_2fa')}
          <div className="cset-div" />
          {toggleRow('Разрешить исключение участников только администраторам', 'Когда включена эта опция, исключать неактивных участников могут только администраторы и владелец сервера.', 'admin_prune')}
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 16, marginBottom: 4 }}>Фильтры нежелательного контента</div>
          <div className="cset-hint" style={{ marginTop: 0 }}>Выберите, могут ли участники сервера делиться изображениями откровенного характера. Эта настройка будет применяться на каналах, не имеющих возрастных ограничений.</div>
          <div className="sset-level">
            <div><b>{fl.t}</b><div className="cset-hint" style={{ marginTop: 2 }}>{fl.d}</div></div>
            <button className="cset-link" onClick={() => up('content_filter', ((st.content_filter ?? 0) + 1) % FILTER_LEVELS.length)}>Изменить</button>
          </div>
        </>}

        {tab === 'audit' && <>
          <div className="sset-audhead">
            <div className="cset-h" style={{ marginBottom: 0 }}>Журнал аудита</div>
            <div>
              <label className="cset-lbl" style={{ margin: '0 0 4px' }}>Фильтр по пользователям</label>
              <select className="modal-in" style={{ margin: 0 }} disabled title="Журнал аудита пока не ведётся — фильтровать нечего"><option>Все пользователи</option>{members.map(m => <option key={m.user_id}>{m.member_name}</option>)}</select>
            </div>
            <div>
              <label className="cset-lbl" style={{ margin: '0 0 4px' }}>Фильтр по действиям</label>
              <select className="modal-in" style={{ margin: 0 }} disabled title="Журнал аудита пока не ведётся — фильтровать нечего"><option>Все действия</option><option>Обновление сервера</option><option>Создание канала</option><option>Удаление канала</option><option>Бан участника</option></select>
            </div>
          </div>
          <div className="sset-empty" style={{ paddingTop: 90 }}>📜<b>ЗАПИСЕЙ ПОКА НЕТ</b>Когда модераторы начнут модерировать, вы сможете промодерировать их модерацию здесь.</div>
        </>}

        {tab === 'bans' && <>
          <div className="cset-h">Список банов сервера</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>По умолчанию баны выдаются по учётной записи и IP-адресу. Пользователь сможет обойти бан по IP-адресу, используя прокси. Включение проверки по мобильному телефону во вкладке «Модерация» сделает процесс обхода бана намного сложнее.</div>
          <div className="sset-banfind">
            <input className="modal-in" style={{ margin: 0, flex: 1 }} placeholder="Поиск банов по ID или имени пользователя" value={bq}
              onChange={e => { setBq(e.target.value); if (!e.target.value.trim()) setBqDone(null) }}
              onKeyDown={e => { if (e.key === 'Enter') setBqDone(bq.trim() || null) }} />
            <button className="modal-primary" onClick={() => setBqDone(bq.trim() || null)}>Поиск</button>
          </div>
          {(() => {
            const q = (bqDone ?? '').toLowerCase()
            const list = q ? bans.filter(b => (b.name ?? '').toLowerCase().includes(q) || b.user_id.toLowerCase().includes(q)) : bans
            if (list.length === 0 && bqDone) return <div className="sset-empty" style={{ paddingTop: 70 }}>🔎<b>НИЧЕГО НЕ НАЙДЕНО</b>Банов по запросу «{bqDone}» нет. Попробуйте другой ID или имя.</div>
            if (list.length === 0) return <div className="sset-empty" style={{ paddingTop: 70 }}>🔨<b>НЕТ БАНОВ</b>Вы ещё никого не банили… но если надо, не стесняйтесь!</div>
            return <div className="sset-banlist">
              {list.map(b => (
                <div key={b.user_id} className="sset-banrow">
                  <div className="sset-mav" style={b.avatar_url ? { backgroundImage: `url(${b.avatar_url})` } : undefined}>{!b.avatar_url && (b.name ?? '?').slice(0, 1).toUpperCase()}</div>
                  <div className="sset-baninfo">
                    <b>{b.name ?? b.user_id}</b>
                    <span className="cset-hint">{b.reason ? b.reason + ' · ' : ''}{fmtD(b.created_at)}</span>
                  </div>
                  {canBan && <button className="modal-ghost" onClick={() => doUnban(b.user_id)}>Разбанить</button>}
                </div>
              ))}
            </div>
          })()}
        </>}

        {tab === 'automod' && <>
          <div className="cset-h">Автомод</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Облегчите работу модераторам и наведите порядок на сервере! Настройте фильтры для модерирования контента и задайте текст автоматического оповещения, отправляемого при выявлении нарушений. Остальное Автомод сделает за вас.</div>
          <div className="cset-h" style={{ fontSize: 17, margin: '22px 0 12px' }}>Контент</div>
          {AUTOMOD_CARDS.map(c => (
            <div key={c.k} className="sset-am">
              <span className="sset-am-ic">{c.ico}</span>
              <div className="sset-am-t">
                <b>{c.t}{(st.automod ?? {})[c.k] && <span className="sset-on">Вкл.</span>}</b>
                <span>{c.d}</span>
                <div className="sset-chips">{c.chips.map(ch => <span key={ch} className="sset-chip">{ch}</span>)}</div>
              </div>
              <button className="modal-primary" onClick={() => {
                const on = !(st.automod ?? {})[c.k]
                persistNow({ ...st, automod: { ...(st.automod ?? {}), [c.k]: on } })
                toastOk(on ? 'Фильтр включён' : 'Фильтр выключен')
              }}>{(st.automod ?? {})[c.k] ? 'Выключить' : c.btn}</button>
            </div>
          ))}
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 16, marginBottom: 4 }}>Фильтры нежелательного контента</div>
          <div className="cset-hint" style={{ marginTop: 0 }}>Выберите, могут ли участники сервера делиться изображениями, отмеченными как контент откровенного характера. Эта настройка будет применяться на каналах, не имеющих возрастных ограничений.</div>
          <div className="sset-level">
            <div><b>{fl.t}</b><div className="cset-hint" style={{ marginTop: 2 }}>{fl.d}</div></div>
            <button className="cset-link" onClick={() => up('content_filter', ((st.content_filter ?? 0) + 1) % FILTER_LEVELS.length)}>Изменить</button>
          </div>
        </>}

        {tab === 'bots' && <ServerBotsPanel serverId={server.id} memberIds={members.map(m => m.user_id)} />}

        {tab === 'community' && <>
          <div className="sset-chero">
            <div style={{ fontSize: 54 }}>🏡</div>
            <div className="cset-h" style={{ marginBottom: 6 }}>Вы создаёте сообщество?</div>
            <div className="cset-hint">Превратите сервер в сервер сообщества, чтобы получить доступ к дополнительным административным инструментам, которые помогут модерировать и развивать его.</div>
            {st.community
              ? <button className="modal-ghost" style={{ marginTop: 16 }} onClick={() => persistNow({ ...st, community: false })}>Отключить сообщество</button>
              : <button className="modal-primary" style={{ marginTop: 16 }} onClick={() => { persistNow({ ...st, community: true, members_in_list: true }); toastOk('Сообщество включено!') }}>Включить сообщество</button>}
            <div className="cset-hint" style={{ marginTop: 16 }}>Серверы сообщества — большие площадки, где могут собираться люди с общими интересами. Включив функцию «Сообщество», вы не сделаете сервер видимым в «Путешествии по серверам».</div>
          </div>
          <div className="sset-ccards">
            <div className="sset-ccard"><span className="sset-cic" style={{ background: 'rgba(35,165,90,.2)', color: '#23a55a' }}>📈</span><b>Развивайте своё сообщество</b>Подайте заявку на включение в Путешествие по серверам, чтобы новые пользователи могли найти ваш сервер в Ponoi.</div>
            <div className="sset-ccard"><span className="sset-cic" style={{ background: 'rgba(99,102,241,.2)', color: '#6366f1' }}>📊</span><b>Поддерживайте активность участников</b>Получите доступ к таким инструментам, как Аналитика сервера, которая помогает модерировать сервер и поддерживать на нём активность.</div>
            <div className="sset-ccard"><span className="sset-cic" style={{ background: 'rgba(237,66,69,.2)', color: '#ed4245' }}>ℹ️</span><b>Следите за ситуацией</b>Получайте новости о новинках, созданных специально для сообществ Ponoi.</div>
          </div>
        </>}

        {tab === 'template' && <>
          <div className="cset-h">Шаблон сервера</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Шаблон сервера — это простой способ поделиться образцом вашего сервера и помочь другим пользователям быстро создать свой сервер. Щёлкнув по ссылке на ваш шаблон, другой пользователь создаст новый сервер с такими же каналами, ролями, правами и настройками, как и на вашем сервере.</div>
          <div className="sset-tpl">
            <div><b>Шаблоны скопируют:</b><ul>
              <li><span className="sset-ok">✔</span> Каналы и темы каналов</li>
              <li><span className="sset-ok">✔</span> Роли и права</li>
              <li><span className="sset-ok">✔</span> Стандартные настройки сервера</li>
            </ul></div>
            <div><b>Шаблоны не скопируют:</b><ul>
              <li><span className="sset-no">✘</span> Сообщения или иной контент</li>
              <li><span className="sset-no">✘</span> Участники и боты</li>
              <li><span className="sset-no">✘</span> Значок вашего сервера и другие изображения</li>
            </ul></div>
          </div>
          <label className="cset-lbl">Название шаблона <span style={{ color: '#ed4245' }}>*</span></label>
          <input className="modal-in" placeholder="Что это за сервер? (Например, для школьного кружка или сообщества художников)"
            value={st.template?.name ?? ''} onChange={e => up('template', { ...(st.template ?? {}), name: e.target.value })} />
          <label className="cset-lbl">Описание шаблона</label>
          <textarea className="cset-topic" style={{ minHeight: 80 }} placeholder="Чем занимаются на этом сервере?"
            value={st.template?.desc ?? ''} onChange={e => up('template', { ...(st.template ?? {}), desc: e.target.value })} />
          <button className="modal-primary" style={{ marginTop: 14 }} disabled={!(st.template?.name ?? '').trim()}
            onClick={() => { persistNow({ ...st }); toastOk('Шаблон «' + st.template.name + '» создан') }}>Создать шаблон</button>
        </>}

        <div className={'cset-savebar' + (dirty ? '' : ' bye')}>
          <span>Осторожно, вы не сохранили изменения!</span>
          <button className="cset-reset" onClick={resetAll}>Сбросить</button>
          <button className="cset-save" onClick={saveAll}>Сохранить изменения</button>
        </div>
      </div>

      {showDelete && <div className="modal-overlay" style={{ zIndex: 140 }} onClick={() => setShowDelete(false)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <button className="modal-x" onClick={() => setShowDelete(false)}><Icon name="close" size={18} /></button>
          <div className="modal-title">Удалить '{server.name}'</div>
          <div className="modal-sub">Вы уверены, что хотите удалить <b>{server.name}</b>? Это действие нельзя отменить.</div>
          <label className="modal-lbl">Введите название сервера</label>
          <input className="modal-in" autoFocus value={delName} onChange={e => setDelName(e.target.value)} />
          <div className="modal-foot">
            <button className="modal-ghost" onClick={() => setShowDelete(false)}>Отмена</button>
            <button className="modal-danger solid" disabled={delName.trim() !== server.name} onClick={onDelete}>Удалить сервер</button>
          </div>
        </div>
      </div>}
    </div>,
    document.body,
  )
}