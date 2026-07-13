import { toastErr, toastOk } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server } from '../types'
import { ServerView } from './ServerView'
import { DMHome } from './DMHome'
import { MusicPlayer } from '../music/MusicPlayer'
import { myServers, createServer as createSrv, joinByCode, deleteServer, updateServer } from '../lib/servers'
import { CreateServerModal, FindServerModal, JoinServerModal, ServerCtxMenu, ServerNotifModal } from './ServerModals'
import { ServerSettings } from './ServerSettings'
import { PresenceProvider } from '../lib/presence'
import { initCustomEmoji } from '../lib/emoji'
import { initServerEmoji, setMyServers } from '../lib/serverEmoji'
import { initNotifications } from '../lib/notify'
import { registerPush } from '../lib/push'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'
import { matchCombo } from '../lib/keybind'
import { QuickSwitcher } from './QuickSwitcher'
import { HotkeysModal } from './HotkeysModal'
import { FolderModal } from './FolderModal'
import { RailTip } from './RailTip'
import { loadFolders, toggleFolder, type SrvFolder } from '../lib/folders'
import { notifModeOf, setNotifMode } from '../lib/srvNotify'
import { bumpDm, bumpMention, bumpSoft, bumpUnread, clearBadgeKey, useBadgeCount } from '../lib/badge'
import { isDmMuted, setChRead } from '../lib/userPrefs'
import { mentionsUser, mentionsRoleName } from '../lib/md'
import { parseSys } from '../lib/sysmsg'
import { IncomingCall } from './IncomingCall'
import { InviteModal } from './InviteModal'
import { IS_MOBILE, openMobNav, closeMobNav } from '../lib/mobile'
import { ServerTagModal } from './ServerTagModal'
import { ProfileCard } from './ProfileCard'
import { fetchProfile, cachedProfile } from '../lib/profilePrefs'
import { cacheGet, cacheSet } from '../lib/offlineCache'
import { netOk, netFail } from '../lib/netStatus'

type View = { kind: 'dm' } | { kind: 'music' } | { kind: 'server'; server: Server }

// v1.212.0: красный бейджик с числом на иконке сервера в рейле — как в
// мобильном Discord. Считает те же bumpMention()/bumpUnread()-события, что уже
// рисуют кружок на иконке приложения/трее (src/lib/badge.ts) — заглушенный
// сервер бейджик от обычных сообщений не получает (см. mute-проверку в
// обработчике INSERT messages), но реальные упоминания всё равно видны.
// v1.269.0: раньше число было только у упоминаний, а обычные непрочитанные —
// отдельной белой точкой без числа; теперь и обычные сообщения дают то же
// число на этом кружке (пользователь просил единый «кружок с количеством»).
function SrvPingBadge({ serverId }: { serverId: string }) {
  const n = useBadgeCount('srv:' + serverId)
  if (!n) return null
  return <span className="srv-ping-badge">{n > 99 ? '99+' : n}</span>
}

export function Home() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [username, setUsername] = useState(() => localStorage.getItem('ponoi_username') || '')
  const [handle, setHandle] = useState('')   // v1.40.0: настоящий юзернейм (уникальный) — для «Добавить в друзья»
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // v1.272.0: рисуем список серверов из локального кэша СРАЗУ (до первого
  // сетевого ответа) — если Supabase сейчас недоступен, сайдбар не выглядит
  // как «у тебя нет серверов», а показывает последний известный снимок.
  const [servers, setServers] = useState<Server[]>(() => cacheGet<Server[]>('servers') ?? [])
  const [view, setView] = useState<View>({ kind: 'dm' })
  const [showCreate, setShowCreate] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [inviteFor, setInviteFor] = useState<Server | null>(null)   // v1.68.0: панель «Пригласить друзей»
  // v1.53.0: карточка «Исследуйте доступные серверы» во вкладке «Добавить в друзья»
  useEffect(() => {
    const h = () => setShowFind(true)
    window.addEventListener('ponoi-open-discover', h)
    return () => window.removeEventListener('ponoi-open-discover', h)
  }, [])
  const [showJoin, setShowJoin] = useState(false)   // v1.46.0: модалка «Присоединиться к серверу»
  const [ctx, setCtx] = useState<{ server: Server; x: number; y: number } | null>(null)
  const [settingsServer, setSettingsServer] = useState<Server | null>(null)
  const [musicOn, setMusicOn] = useState(false)   // плеер остаётся смонтирован — музыка играет в фоне
  const [qs, setQs] = useState(false)             // Ctrl+K панель быстрого перехода
  const [hk, setHk] = useState(false)             // Ctrl+/ шпаргалка горячих клавиш
  const [folders, setFolders] = useState<SrvFolder[]>(loadFolders())
  const [folderFor, setFolderFor] = useState<Server | null>(null)
  const [notifFor, setNotifFor] = useState<Server | null>(null)
  // v1.178.0: «Взять тег сервера» — модалка из правого клика по серверу.
  const [tagServer, setTagServer] = useState<Server | null>(null)
  const [myTagServerId, setMyTagServerId] = useState<string | null>(null)
  const [editMyProfile, setEditMyProfile] = useState(false)
  useEffect(() => {
    if (!user) return
    const c = cachedProfile(user.id); if (c) setMyTagServerId(c.tagServerId)
    fetchProfile(user.id).then(p => setMyTagServerId(p.tagServerId))
    const h = (e: any) => { if (e.detail?.id === user.id) { const cc = cachedProfile(user.id); if (cc) setMyTagServerId(cc.tagServerId) } }
    window.addEventListener('ponoi-profile', h)
    return () => window.removeEventListener('ponoi-profile', h)
  }, [user?.id])
  // Открытие настроек/уведомлений сервера из меню в ServerView (клик по имени сервера).
  useEffect(() => {
    const openSettings = (e: any) => setSettingsServer(e.detail)
    const openNotif = (e: any) => setNotifFor(e.detail)
    window.addEventListener('ponoi-open-server-settings', openSettings as any)
    window.addEventListener('ponoi-open-server-notif', openNotif as any)
    return () => {
      window.removeEventListener('ponoi-open-server-settings', openSettings as any)
      window.removeEventListener('ponoi-open-server-notif', openNotif as any)
    }
  }, [])
  // v1.232.0: «Сообщение» в полном профиле (ProfileCard, может быть открыт откуда
  // угодно — с сервера, из мини-профиля) шлёт то же событие ponoi-open-dm, что и
  // Ctrl+K/входящий звонок — DMHome (смонтирован постоянно) сам откроет диалог,
  // но если сейчас открыт СЕРВЕР, экран ЛС ещё и нужно сделать видимым.
  useEffect(() => {
    const h = () => setView({ kind: 'dm' })
    window.addEventListener('ponoi-open-dm', h)
    return () => window.removeEventListener('ponoi-open-dm', h)
  }, [])
  // Мобильная версия (v1.34.0): при старте открываем шторку навигации, как в Discord.
  useEffect(() => { if (IS_MOBILE) openMobNav() }, [])
  // v1.40.0: настройки сохранили ник/юзернейм — обновляем имя во всём приложении сразу, без перезагрузки.
  useEffect(() => {
    const h = (e: any) => {
      const d = e.detail || {}
      if (d.nick) { setUsername(d.nick); localStorage.setItem('ponoi_username', d.nick) }
      if (d.handle) setHandle(d.handle)
    }
    window.addEventListener('ponoi-profile-updated', h as any)
    return () => window.removeEventListener('ponoi-profile-updated', h as any)
  }, [])
  // v1.212.0: на телефоне MeBar шлёт это событие вместо открытия MiniProfile —
  // сразу полноэкранный профиль (ProfileCard), см. MeBar.tsx.
  useEffect(() => {
    const h = () => setEditMyProfile(true)
    window.addEventListener('ponoi-open-my-profile', h)
    return () => window.removeEventListener('ponoi-open-my-profile', h)
  }, [])
  const [, setNotifVer] = useState(0) // ре-рендер при смене режима уведомлений

  // Непрочитанное на серверах: глобальная подписка на INSERT в messages.
  // Канал → сервер резолвим по заранее загруженной карте каналов.
  const chMap = useRef<Record<string, string>>({})
  const viewRef = useRef<View>(view)
  useEffect(() => { viewRef.current = view }, [view])
  // Музыка теперь открывается панелью справа, а базовый экран (ЛС/сервер) остаётся под ней.
  const lastView = useRef<View>({ kind: 'dm' })

  // v1.72.0: каждый раз, когда экран ЛС снова показан (возврат с сервера/музыки),
  // сообщаем DMHome — тот плавно прокручивает открытый чат в самый низ, к новым.
  useEffect(() => {
    if (view.kind === 'dm') window.dispatchEvent(new Event('ponoi-dm-shown'))
  }, [view.kind])
  useEffect(() => { if (view.kind !== 'music') lastView.current = view }, [view])
  // v1.64.0: сервер остаётся смонтированным при уходе в ЛС — звонок/голос не рвётся.
  const [lastServer, setLastServer] = useState<Server | null>(null)
  useEffect(() => { if (view.kind === 'server') setLastServer(view.server) }, [view])

  // v1.56.0: история переходов между разделами — стрелки назад/вперёд в тайтлбаре (как в Discord).
  const sameView = (a: View, b: View) => a.kind === b.kind && (a.kind !== 'server' || (b as any).server?.id === a.server.id)
  const viewTitle = (v: View) => v.kind === 'dm' ? 'Личные сообщения' : v.kind === 'music' ? 'Ponoi Music' : v.server.name
  const navHist = useRef<{ stack: View[]; idx: number }>({ stack: [view], idx: 0 })
  const navByArrow = useRef(false)
  const broadcastNav = () => {
    const h = navHist.current
    window.dispatchEvent(new CustomEvent('ponoi-nav-state', { detail: {
      title: viewTitle(view), canBack: h.idx > 0, canForward: h.idx < h.stack.length - 1,
    } }))
  }
  useEffect(() => {
    const h = navHist.current
    if (navByArrow.current) { navByArrow.current = false }
    else if (!sameView(h.stack[h.idx], view)) {
      h.stack = h.stack.slice(0, h.idx + 1); h.stack.push(view); h.idx = h.stack.length - 1
    }
    broadcastNav()
    // eslint-disable-next-line
  }, [view])
  useEffect(() => {
    const back = () => { const h = navHist.current; if (h.idx > 0) { h.idx--; navByArrow.current = true; setView(h.stack[h.idx]) } }
    const fwd = () => { const h = navHist.current; if (h.idx < h.stack.length - 1) { h.idx++; navByArrow.current = true; setView(h.stack[h.idx]) } }
    const req = () => broadcastNav()
    const openQs = () => setQs(true)
    window.addEventListener('ponoi-nav-back', back)
    window.addEventListener('ponoi-nav-forward', fwd)
    window.addEventListener('ponoi-nav-request', req)
    window.addEventListener('ponoi-open-qs', openQs)
    return () => {
      window.removeEventListener('ponoi-nav-back', back)
      window.removeEventListener('ponoi-nav-forward', fwd)
      window.removeEventListener('ponoi-nav-request', req)
      window.removeEventListener('ponoi-open-qs', openQs)
    }
    // eslint-disable-next-line
  }, [])
  useEffect(() => {
    if (servers.length === 0) return
    supabase.from('channels').select('id, server_id').in('server_id', servers.map(s => s.id))
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const c of data ?? []) map[c.id] = c.server_id
        chMap.current = map
      })
  }, [servers])
  // v1.250.0: пак эмодзи/стикеров сервера доступен всем участникам автоматически —
  // просто перечитываем его для АКТУАЛЬНОГО списка серверов пользователя, без
  // отдельного шага «выдать доступ» при вступлении/выходе.
  useEffect(() => { setMyServers(servers.map(s => ({ id: s.id, name: s.name }))) }, [servers])
  // v1.239.0: мои роли на каждом сервере (имена) — чтобы упоминание роли (@Название),
  // а не только меня лично, тоже зажигало красный кружок/пуш, как в Discord.
  const myRoleNamesBySrv = useRef<Record<string, string[]>>({})
  useEffect(() => {
    if (!user || servers.length === 0) { myRoleNamesBySrv.current = {}; return }
    let ok = true
    const loadMyRoles = () => {
      supabase.from('member_roles').select('server_id, role_id')
        .eq('user_id', user.id).in('server_id', servers.map(s => s.id))
        .then(async ({ data }) => {
          const rows = (data ?? []) as { server_id: string; role_id: string }[]
          if (!ok || rows.length === 0) { if (ok) myRoleNamesBySrv.current = {}; return }
          const { data: rolesData } = await supabase.from('server_roles').select('id, name').in('id', rows.map(r => r.role_id))
          if (!ok) return
          const nameById: Record<string, string> = {}
          for (const r of (rolesData ?? []) as { id: string; name: string }[]) nameById[r.id] = r.name
          const map: Record<string, string[]> = {}
          for (const r of rows) { const nm = nameById[r.role_id]; if (nm) (map[r.server_id] ??= []).push(nm) }
          myRoleNamesBySrv.current = map
        })
    }
    loadMyRoles()
    const ch = supabase.channel('my-roles:' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_roles', filter: 'user_id=eq.' + user.id }, loadMyRoles)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'member_roles', filter: 'user_id=eq.' + user.id }, loadMyRoles)
      .subscribe()
    return () => { ok = false; supabase.removeChannel(ch) }
  }, [user, servers])
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('unread:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
        const msg = p.new as { channel_id?: string; author?: string; content?: string | null; thread_id?: string | null }
        if (!msg.channel_id || msg.author === user.id || msg.thread_id) return
        const sid = chMap.current[msg.channel_id]
        if (!sid) return
        const v = viewRef.current
        const viewing = v.kind === 'server' && v.server.id === sid
        // v1.100.0: @упоминание меня — красный кружок на иконке приложения.
        // Работает даже на заглушенном сервере (как в Discord: mute прячет точку, но не пинги).
        // v1.239.0: + упоминание любой из МОИХ ролей на этом сервере.
        const mentioned = mentionsUser(msg.content ?? '', nameRef.current.username) || mentionsUser(msg.content ?? '', nameRef.current.handle)
          || (myRoleNamesBySrv.current[sid] ?? []).some(rn => mentionsRoleName(msg.content ?? '', rn))
        if (!viewing && mentioned) bumpMention(sid)
        if (notifModeOf(sid) === 'mute') return // заглушенные сервера кружок не зажигают
        if (viewing) return
        // v1.269.0: обычное сообщение без упоминания теперь тоже даёт кружок с
        // числом (как у упоминаний) — раньше была только тихая точка без числа.
        if (!mentioned) bumpUnread(sid)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [user])
  function clearUnread(id: string) {
    clearBadgeKey('srv:' + id)   // v1.100.0: зашли на сервер — пинги с него сняты с кружка
  }

  // v1.100.0: кружок на иконке приложения — глобальный счёт новых ЛС.
  // Свои диалоги знаем по dm_threads; открытый сейчас диалог кружок не увеличивает
  // (модулю бейджа его сообщает DMHome через setActiveDm).
  const nameRef = useRef({ username: '', handle: '' })
  useEffect(() => { nameRef.current = { username, handle } }, [username, handle])
  const dmThreadsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!user) return
    let alive = true
    // v1.223.0: групповые беседы не имеют user_a/user_b (см. supabase/56_group_dm.sql) —
    // без dm_participants их сообщения никогда не долетали бы до счётчика непрочитанного.
    const load = () => { Promise.all([
      supabase.from('dm_threads').select('id').or('user_a.eq.' + user.id + ',user_b.eq.' + user.id),
      supabase.from('dm_participants').select('thread_id').eq('user_id', user.id),
    ]).then(([a, b]) => {
      if (!alive) return
      const ids = new Set(((a.data ?? []) as any[]).map(t => t.id))
      for (const p of (b.data ?? []) as any[]) ids.add(p.thread_id)
      dmThreadsRef.current = ids
    }) }
    load()
    const ch = supabase.channel('badge:dm')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_threads' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_participants', filter: 'user_id=eq.' + user.id }, () => load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'dm_participants', filter: 'user_id=eq.' + user.id }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, p => {
        const m = p.new as { thread_id?: string; author?: string; content?: string | null }
        if (!m.thread_id || m.author === user.id) return
        if (!dmThreadsRef.current.has(m.thread_id)) return
        if (parseSys(m.content ?? null)) return   // системные («начал звонок») не считаем
        if (m.author && isDmMuted(m.author)) {
          // v1.187.0: заглушенный в ЛС не зажигает счётчик; v1.203.0: но тихая точка
          // на иконке приложения (без числа) теперь всё же есть — видно, что что-то
          // было, но это не всплывает числом/звуком/тостом.
          bumpSoft('dm:' + m.thread_id)
          return
        }
        bumpDm(m.thread_id)
      })
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [user])

  useEffect(() => {
    if (!user) return
    initCustomEmoji(user.id)   // load + realtime-subscribe the shared custom-emoji cache
    initServerEmoji()   // v1.250.0: то же самое для эмодзи/стикеров серверов
    initNotifications() // ask once for desktop-notification permission
    registerPush(user.id) // subscribe to real web-push (works even when app closed)
    // v1.39.0: ник (display_name) — отображаемое имя, показывается везде, если задан;
    // юзернейм — уникальный идентификатор. До миграции 21 колонки display_name нет — откатываемся.
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', user.id).maybeSingle()
      .then(async ({ data, error }) => {
        let d: any = data
        if (error) { const r = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle(); d = r.data }
        const disp = d?.display_name || d?.username
        if (d?.username) setHandle(d.username)
        if (disp) { setUsername(disp); localStorage.setItem('ponoi_username', disp) }
        else if (user.email) {
          // Профиль без юзернейма (например, регистрация с подтверждением почты не успела его записать):
          // показываем часть почты до @ и сразу чиним профиль — «Вы» больше нигде не появляется (v1.37.0)
          const fb = localStorage.getItem('ponoi_username') || user.email.split('@')[0]
          setUsername(fb); setHandle(fb); localStorage.setItem('ponoi_username', fb)
          supabase.from('profiles').upsert({ id: user.id, username: fb })
        }
        if (d?.avatar_url) setAvatarUrl(d.avatar_url)
      })
    refresh()
    // eslint-disable-next-line
  }, [user])

  // Global quick-navigation keybinds (configurable in Settings).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (settings.keyMusic && matchCombo(e, settings.keyMusic)) { e.preventDefault(); setView({ kind: 'music' }) }
      else if (settings.keyHome && matchCombo(e, settings.keyHome)) { e.preventDefault(); setView({ kind: 'dm' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings.keyMusic, settings.keyHome])

  // Ctrl+K / Cmd+K — быстрый переход, работает даже когда фокус в поле ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setQs(v => !v) }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setHk(v => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (view.kind === 'music') setMusicOn(true) }, [view])

  // Смена режима уведомлений: перерисовать левую колонку (иконки/точки).
  useEffect(() => {
    const h = () => setNotifVer(v => v + 1)
    window.addEventListener('ponoi-notif', h)
    return () => window.removeEventListener('ponoi-notif', h)
  }, [])

  // Папки серверов: перечитываем при любом изменении (создание/перенос/сворачивание).
  useEffect(() => {
    const h = () => setFolders(loadFolders())
    window.addEventListener('ponoi-folders', h)
    return () => window.removeEventListener('ponoi-folders', h)
  }, [])

  // Переход на сервер из фулл-профиля (вкладка «Общие сервера») — а также диплинк на
  // сообщение (detail — объект с channelId/messageId вместо простого id сервера).
  useEffect(() => {
    const h = (e: any) => {
      const d = e.detail
      const id = typeof d === 'string' ? d : d?.id
      const s = servers.find(x => x.id === id)
      if (!s) return
      setView({ kind: 'server', server: s }); clearUnread(s.id)
      if (d && typeof d === 'object' && d.channelId) {
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('ponoi-open-channel-msg', { detail: { channelId: d.channelId, messageId: d.messageId } })), 60)
      }
    }
    window.addEventListener('ponoi-open-server', h)
    return () => window.removeEventListener('ponoi-open-server', h)
    // eslint-disable-next-line
  }, [servers])

  // Диплинк на сообщение в ЛС: переключаем экран на «Личные сообщения» — сам диалог
  // и прыжок к сообщению открывает DMHome (он смонтирован постоянно, см. ниже).
  useEffect(() => {
    const h = () => setView({ kind: 'dm' })
    window.addEventListener('ponoi-open-dm-thread', h)
    return () => window.removeEventListener('ponoi-open-dm-thread', h)
  }, [])

  async function refresh(selectId?: string) {
    // v1.272.0: сбой сети раньше добегал до setServers([]) через myServers()
    // (та возвращала [] и при пустом аккаунте, и при отказе Supabase — теперь
    // бросает исключение при отказе) — здесь при сбое просто НЕ трогаем
    // уже показанный (из кэша или прошлого успешного ответа) список.
    let list: Server[]
    try { list = await myServers(); netOk() }
    catch (e) { netFail(); console.error('[servers] load failed:', e); return }
    setServers(list)
    cacheSet('servers', list)
    if (selectId) {
      const s = list.find(x => x.id === selectId)
      if (s) setView({ kind: 'server', server: s })
    }
  }

  // v1.257.0: точечное обновление ОДНОГО сервера — не трогает навигацию (в отличие
  // от refresh(selectId) выше, который специально переключает view на выбранный
  // сервер — нужно для «только что вступил, перейди туда», но было бы неверно
  // после простого сохранения настроек, если сейчас открыто что-то другое).
  // Обновляет и список в сайдбаре (servers), и текущий открытый сервер (view.server),
  // если это именно он — иначе именно эта строка (не сам refresh()) осталась бы
  // устаревшей, и повторное открытие настроек показывало бы старый снимок,
  // хотя сохранение уже прошло по-настоящему.
  async function refreshOneServer(id: string) {
    const { data } = await supabase.from('servers').select('*').eq('id', id).maybeSingle()
    if (!data) return
    const fresh = data as Server
    setServers(list => list.map(s => (s.id === id ? fresh : s)))
    setView(v => (v.kind === 'server' && v.server.id === id ? { kind: 'server', server: fresh } : v))
  }

  // v1.68.0: клик «Присоединиться» на карточке-приглашении в ленте сообщений.
  useEffect(() => {
    const h = async (e: Event) => {
      const code = String((e as CustomEvent).detail ?? '')
      if (!user || !code) return
      const res = await joinByCode(code, user.id, username)
      if ((res as any).error) return toastErr((res as any).error.message)
      toastOk('Вы присоединились к серверу!')
      refresh((res as any).serverId)
    }
    window.addEventListener('ponoi-join-invite', h)
    return () => window.removeEventListener('ponoi-join-invite', h)
    // eslint-disable-next-line
  }, [user, username])

  async function onCreate(name: string, avatarUrl: string | null) {
    if (!name || !user) return
    const res = await createSrv(name, user.id, username, avatarUrl)
    if (res.error) return toastErr(res.error.message)
    setShowCreate(false)
    if (res.server) refresh(res.server.id)
  }

  async function onCtxAction(k: string, server: Server) {
    if (!user) return
    if (k === 'copyid') { navigator.clipboard?.writeText(server.id); return }
    if (k === 'folder') { setFolderFor(server); return }
    if (k === 'settings') { setSettingsServer(server); return }
    if (k === 'invite') { setInviteFor(server); return }
    if (k === 'delete') {
      if (server.owner !== user.id) return toastErr('Только владелец может удалить сервер')
      const { error } = await deleteServer(server.id)
      if (error) { toastErr('Не удалось удалить сервер: ' + error.message); return }
      setLastServer(null); setView({ kind: 'dm' }); refresh()
      return
    }
    if (k === 'read') {
      // v1.266.0: раньше только гасил точку в сайдбаре (clearUnread) — сами
      // каналы сервера свою «непрочитанность» (ch_read в userPrefs, см.
      // refreshUnread в ServerView.tsx) не получали, поэтому при заходе на
      // сервер список каналов слева всё равно показывал непрочитанное, а после
      // перезапуска точка на сервере зажигалась заново.
      clearUnread(server.id)
      const { data } = await supabase.from('channels').select('id').eq('server_id', server.id)
      const now = Date.now()
      for (const c of (data ?? []) as { id: string }[]) setChRead(c.id, now)
      toastOk('Отмечено прочитанным')
      return
    }
    if (k === 'notif') { setNotifFor(server); return }
    if (k === 'mute') {
      const muted = notifModeOf(server.id) === 'mute'
      setNotifMode(server.id, muted ? 'all' : 'mute')
      toastOk(muted ? 'Уведомления включены: ' + server.name : 'Сервер заглушен: ' + server.name)
      return
    }
    if (k === 'tag') { setTagServer(server); return }
  }

  return (
    <PresenceProvider username={username} avatarUrl={avatarUrl}>
    <div className="app">
      <nav className="servers">
        <div className={'srv-wrap' + (view.kind === 'dm' ? ' on' : '')}>
          <RailTip text="Личные сообщения">
            <button className={'srv home' + (view.kind === 'dm' ? ' on' : '')}
              onClick={() => setView({ kind: 'dm' })}><Icon name="home" size={24} /></button>
          </RailTip>
        </div>
        <div className="srv-sep" />
        {(() => {
          const inFolder = new Set(folders.flatMap(f => f.servers))
          const srvBtn = (s: Server) => (
            <div key={s.id} className={'srv-wrap' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '') + (notifModeOf(s.id) === 'mute' ? ' srv-muted' : '')}>
              <RailTip text={s.name}>
                <button className={'srv' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '')}
                  style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center', color: 'transparent' } : undefined}
                  onClick={() => { setView({ kind: 'server', server: s }); clearUnread(s.id) }}
                  onContextMenu={e => { e.preventDefault(); setCtx({ server: s, x: e.clientX, y: e.clientY }) }}>
                  {s.name.slice(0, 2).toUpperCase()}</button>
              </RailTip>
              {notifModeOf(s.id) === 'mute' && <span className="srv-mute-badge" title="Уведомления выключены">🔕</span>}
              <SrvPingBadge serverId={s.id} />
            </div>
          )
          return <>
            {folders.map(f => {
              const list = f.servers.map(id => servers.find(s => s.id === id)).filter(Boolean) as Server[]
              if (list.length === 0) return null
              const activeIn = view.kind === 'server' && f.servers.includes(view.server.id)
              return (
                <div key={f.id} className={'srv-folder' + (f.open ? ' open' : '') + (activeIn ? ' active' : '')}
                  style={{ ['--fold' as any]: f.color }}>
                  <RailTip text={f.name}>
                    <button className="srv fold-head" onClick={() => toggleFolder(f.id)}>
                      {f.open ? <Icon name="folder" size={20} /> : (
                        <span className="fold-grid">
                          {list.slice(0, 4).map(s => <span key={s.id} className="fold-mini"
                            style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})` } : undefined}>
                            {!s.avatar_url && s.name.slice(0, 1).toUpperCase()}</span>)}
                        </span>
                      )}
                    </button>
                  </RailTip>
                  {f.open && list.map(srvBtn)}
                </div>
              )
            })}
            {servers.filter(s => !inFolder.has(s.id)).map(srvBtn)}
          </>
        })()}
        <RailTip text="Создать сервер">
          <button className="srv add" onClick={() => setShowCreate(true)}><Icon name="plus" size={24} /></button>
        </RailTip>
        <RailTip text="Найти сервер">
          <button className="srv join" onClick={() => setShowFind(true)}><Icon name="compass" size={22} /></button>
        </RailTip>
        <div className={'srv-wrap music-bottom' + (view.kind === 'music' ? ' on' : '')}>
          <RailTip text="Ponoi Music">
            <button className={'srv music' + (view.kind === 'music' ? ' on' : '')}
              onClick={() => setView({ kind: 'music' })}><Icon name="music" size={22} /></button>
          </RailTip>
        </div>
      </nav>
      <div className="mob-backdrop" onClick={closeMobNav} />
      {(() => { const bv = view.kind === 'music' ? lastView.current : view
        const srv = bv.kind === 'server' ? bv.server : lastServer
        // v1.64.0: ЛС и сервер не размонтируются при навигации — активный звонок
        // продолжает жить, неактивный экран просто скрывается.
        return <>
          <div style={{ display: bv.kind === 'dm' ? 'contents' : 'none' }}>
            <DMHome username={username} handle={handle} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} servers={servers} />
          </div>
          {srv && <div style={{ display: bv.kind === 'server' ? 'contents' : 'none' }}>
            <ServerView server={srv} username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} onLeft={() => { setLastServer(null); setView({ kind: 'dm' }); refresh() }} />
          </div>}
        </> })()}
      {(musicOn || view.kind === 'music') && <MusicPlayer me={username} meId={user?.id ?? ''}
        visible={view.kind === 'music'}
        onClose={() => setView(v => v.kind === 'music' ? lastView.current : { kind: 'music' })}
        onStop={() => { setMusicOn(false); setView(v => v.kind === 'music' ? lastView.current : v) }} />}
    </div>
    {user && <IncomingCall meId={user.id} onAccept={r => {
      setView({ kind: 'dm' })
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ponoi-open-dm', { detail: { id: r.fromId, name: r.fromName } }))
        setTimeout(() => window.dispatchEvent(new CustomEvent('ponoi-join-call', { detail: { threadId: r.threadId } })), 300)
      }, 60)
    }} />}
    {hk && <HotkeysModal onClose={() => setHk(false)} />}
    {folderFor && <FolderModal server={folderFor} onClose={() => setFolderFor(null)} />}
    {notifFor && <ServerNotifModal server={notifFor} onClose={() => setNotifFor(null)} />}
    {qs && <QuickSwitcher servers={servers} onClose={() => setQs(false)} onGo={t => {
      setQs(false)
      if (t.kind === 'home') setView({ kind: 'dm' })
      else if (t.kind === 'music') setView({ kind: 'music' })
      else if (t.kind === 'server') { setView({ kind: 'server', server: t.server }); clearUnread(t.server.id) }
      else { setView({ kind: 'dm' }); setTimeout(() => window.dispatchEvent(new CustomEvent('ponoi-open-dm', { detail: t.friend })), 60) }
    }} />}
    {showCreate && <CreateServerModal uid={user?.id ?? ''} username={username} onClose={() => setShowCreate(false)} onCreate={onCreate} onJoin={() => setShowJoin(true)} />}
    {showJoin && <JoinServerModal
      onClose={() => setShowJoin(false)}
      onBack={() => { setShowJoin(false); setShowCreate(true) }}
      onDiscover={() => { setShowJoin(false); setShowFind(true) }}
      onJoin={async code => {
        if (!user) return
        const res = await joinByCode(code, user.id, username)
        if (res.error) { toastErr(res.error.message ?? 'Приглашение не найдено'); return }
        toastOk('Добро пожаловать на сервер!')
        setShowJoin(false)
        if (res.serverId) refresh(res.serverId)
      }} />}
    {showFind && <FindServerModal uid={user?.id ?? ''} username={username} onClose={() => setShowFind(false)} onJoined={id => { setShowFind(false); refresh(id) }} />}
      {inviteFor && user && <InviteModal server={inviteFor} meId={user.id} meName={username} onClose={() => setInviteFor(null)} />}
    {ctx && <ServerCtxMenu x={ctx.x} y={ctx.y} isOwner={ctx.server.owner === user?.id} muted={notifModeOf(ctx.server.id) === 'mute'} onClose={() => setCtx(null)} onAction={k => onCtxAction(k, ctx.server)} />}
    {settingsServer && <ServerSettings server={settingsServer} uid={user?.id ?? ''}
      onClose={() => setSettingsServer(null)}
      onChanged={() => refreshOneServer(settingsServer.id)}
      onDelete={async () => {
        const { error } = await deleteServer(settingsServer.id)
        if (error) { toastErr('Не удалось удалить сервер: ' + error.message); return }
        setSettingsServer(null); setLastServer(null); setView({ kind: 'dm' }); refresh()
      }} />}
    {tagServer && <ServerTagModal server={tagServer} myTagServerId={myTagServerId}
      onClose={() => setTagServer(null)} onEditProfile={() => setEditMyProfile(true)} />}
    {editMyProfile && user && <ProfileCard userId={user.id} name={username} avatarUrl={avatarUrl} status="online"
      initialTab="board" onClose={() => setEditMyProfile(false)} />}
    </PresenceProvider>
  )
}