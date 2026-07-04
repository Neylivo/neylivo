import { toastErr, toastOk } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server } from '../types'
import { ServerView } from './ServerView'
import { DMHome } from './DMHome'
import { MusicPlayer } from '../music/MusicPlayer'
import { myServers, createServer as createSrv, joinByCode, findServers, deleteServer, updateServer } from '../lib/servers'
import { CreateServerModal, FindServerModal, ServerCtxMenu, ServerNotifModal } from './ServerModals'
import { ServerSettings } from './ServerSettings'
import { PresenceProvider } from '../lib/presence'
import { initCustomEmoji } from '../lib/emoji'
import { initNotifications } from '../lib/notify'
import { registerPush } from '../lib/push'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'
import { matchCombo } from '../lib/keybind'
import { QuickSwitcher } from './QuickSwitcher'
import { HotkeysModal } from './HotkeysModal'
import { FolderModal } from './FolderModal'
import { loadFolders, toggleFolder, type SrvFolder } from '../lib/folders'
import { notifModeOf, setNotifMode } from '../lib/srvNotify'
import { IncomingCall } from './IncomingCall'

type View = { kind: 'dm' } | { kind: 'music' } | { kind: 'server'; server: Server }

export function Home() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [username, setUsername] = useState(() => localStorage.getItem('ponoi_username') || 'Вы')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [view, setView] = useState<View>({ kind: 'dm' })
  const [showCreate, setShowCreate] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [ctx, setCtx] = useState<{ server: Server; x: number; y: number } | null>(null)
  const [settingsServer, setSettingsServer] = useState<Server | null>(null)
  const [musicOn, setMusicOn] = useState(false)   // плеер остаётся смонтирован — музыка играет в фоне
  const [qs, setQs] = useState(false)             // Ctrl+K панель быстрого перехода
  const [hk, setHk] = useState(false)             // Ctrl+/ шпаргалка горячих клавиш
  const [folders, setFolders] = useState<SrvFolder[]>(loadFolders())
  const [folderFor, setFolderFor] = useState<Server | null>(null)
  const [notifFor, setNotifFor] = useState<Server | null>(null)
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
  const [, setNotifVer] = useState(0) // ре-рендер при смене режима уведомлений

  // Непрочитанное на серверах: глобальная подписка на INSERT в messages.
  // Канал → сервер резолвим по заранее загруженной карте каналов.
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const chMap = useRef<Record<string, string>>({})
  const viewRef = useRef<View>(view)
  useEffect(() => { viewRef.current = view }, [view])
  // Музыка теперь открывается панелью справа, а базовый экран (ЛС/сервер) остаётся под ней.
  const lastView = useRef<View>({ kind: 'dm' })
  useEffect(() => { if (view.kind !== 'music') lastView.current = view }, [view])
  useEffect(() => {
    if (servers.length === 0) return
    supabase.from('channels').select('id, server_id').in('server_id', servers.map(s => s.id))
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const c of data ?? []) map[c.id] = c.server_id
        chMap.current = map
      })
  }, [servers])
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('unread:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
        const msg = p.new as { channel_id?: string; author?: string }
        if (!msg.channel_id || msg.author === user.id) return
        const sid = chMap.current[msg.channel_id]
        if (!sid) return
        if (notifModeOf(sid) === 'mute') return // заглушенные сервера точку не зажигают
        const v = viewRef.current
        if (v.kind === 'server' && v.server.id === sid) return
        setUnread(prev => { const n = new Set(prev); n.add(sid); return n })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [user])
  function clearUnread(id: string) {
    setUnread(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n })
  }

  useEffect(() => {
    if (!user) return
    initCustomEmoji()   // load + realtime-subscribe the shared custom-emoji cache
    initNotifications() // ask once for desktop-notification permission
    registerPush(user.id) // subscribe to real web-push (works even when app closed)
    supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single()
      .then(({ data }) => { if (data?.username) { setUsername(data.username); localStorage.setItem('ponoi_username', data.username) } if (data?.avatar_url) setAvatarUrl(data.avatar_url) })
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

  // Переход на сервер из фулл-профиля (вкладка «Общие сервера»).
  useEffect(() => {
    const h = (e: any) => { const s = servers.find(x => x.id === e.detail); if (s) { setView({ kind: 'server', server: s }); clearUnread(s.id) } }
    window.addEventListener('ponoi-open-server', h)
    return () => window.removeEventListener('ponoi-open-server', h)
    // eslint-disable-next-line
  }, [servers])

  async function refresh(selectId?: string) {
    const list = await myServers()
    setServers(list)
    if (selectId) {
      const s = list.find(x => x.id === selectId)
      if (s) setView({ kind: 'server', server: s })
    }
  }

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
    if (k === 'invite') {
      const { createInvite } = await import('../lib/servers')
      const res = await createInvite(server.id, user.id)
      if (res.code) { navigator.clipboard?.writeText(res.code); toastOk('Код приглашения скопирован: ' + res.code) }
      return
    }
    if (k === 'delete') {
      if (server.owner !== user.id) return toastErr('Только владелец может удалить сервер')
      await deleteServer(server.id)
      setView({ kind: 'dm' }); refresh()
      return
    }
    if (k === 'read') { clearUnread(server.id); toastOk('Отмечено прочитанным'); return }
    if (k === 'notif') { setNotifFor(server); return }
    if (k === 'mute') {
      const muted = notifModeOf(server.id) === 'mute'
      setNotifMode(server.id, muted ? 'all' : 'mute')
      toastOk(muted ? 'Уведомления включены: ' + server.name : 'Сервер заглушен: ' + server.name)
      return
    }
    // tag — client-side nicety, no-op for now
  }

  return (
    <PresenceProvider username={username} avatarUrl={avatarUrl}>
    <div className="app">
      <nav className="servers">
        <div className={'srv-wrap' + (view.kind === 'dm' ? ' on' : '')}>
          <button className={'srv home' + (view.kind === 'dm' ? ' on' : '')}
            title="Личные сообщения" onClick={() => setView({ kind: 'dm' })}><Icon name="home" size={24} /></button>
        </div>
        <div className="srv-sep" />
        {(() => {
          const inFolder = new Set(folders.flatMap(f => f.servers))
          const srvBtn = (s: Server) => (
            <div key={s.id} className={'srv-wrap' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '') + (notifModeOf(s.id) === 'mute' ? ' srv-muted' : '')}>
              <button className={'srv' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '')}
                style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center', color: 'transparent' } : undefined}
                title={s.name}
                onClick={() => { setView({ kind: 'server', server: s }); clearUnread(s.id) }}
                onContextMenu={e => { e.preventDefault(); setCtx({ server: s, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 320) }) }}>
                {s.name.slice(0, 2).toUpperCase()}</button>
              {unread.has(s.id) && notifModeOf(s.id) !== 'mute' && <span className="unread-dot" title="Есть новые сообщения" />}
              {notifModeOf(s.id) === 'mute' && <span className="srv-mute-badge" title="Уведомления выключены">🔕</span>}
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
                  <button className="srv fold-head" title={f.name} onClick={() => toggleFolder(f.id)}>
                    {f.open ? <Icon name="folder" size={20} /> : (
                      <span className="fold-grid">
                        {list.slice(0, 4).map(s => <span key={s.id} className="fold-mini"
                          style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})` } : undefined}>
                          {!s.avatar_url && s.name.slice(0, 1).toUpperCase()}</span>)}
                      </span>
                    )}
                  </button>
                  {f.open && list.map(srvBtn)}
                </div>
              )
            })}
            {servers.filter(s => !inFolder.has(s.id)).map(srvBtn)}
          </>
        })()}
        <button className="srv add" title="Создать сервер" onClick={() => setShowCreate(true)}><Icon name="plus" size={24} /></button>
        <button className="srv join" title="Найти сервер" onClick={() => setShowFind(true)}><Icon name="compass" size={22} /></button>
        <div className={'srv-wrap music-bottom' + (view.kind === 'music' ? ' on' : '')}>
          <button className={'srv music' + (view.kind === 'music' ? ' on' : '')}
            title="Ponoi Music" onClick={() => setView({ kind: 'music' })}><Icon name="music" size={22} /></button>
        </div>
      </nav>
      {(() => { const bv = view.kind === 'music' ? lastView.current : view
        return <>
          {bv.kind === 'dm' && <DMHome username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} />}
          {bv.kind === 'server' && <ServerView server={bv.server} username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} onLeft={() => { setView({ kind: 'dm' }); refresh() }} />}
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
    {showCreate && <CreateServerModal uid={user?.id ?? ''} username={username} onClose={() => setShowCreate(false)} onCreate={onCreate} onJoin={() => setShowFind(true)} />}
    {showFind && <FindServerModal onClose={() => setShowFind(false)} onFind={findServers} />}
    {ctx && <ServerCtxMenu x={ctx.x} y={ctx.y} isOwner={ctx.server.owner === user?.id} muted={notifModeOf(ctx.server.id) === 'mute'} onClose={() => setCtx(null)} onAction={k => onCtxAction(k, ctx.server)} />}
    {settingsServer && <ServerSettings server={settingsServer} uid={user?.id ?? ''}
      onClose={() => setSettingsServer(null)}
      onChanged={() => refresh()}
      onDelete={async () => { await deleteServer(settingsServer.id); setSettingsServer(null); setView({ kind: 'dm' }); refresh() }} />}
    </PresenceProvider>
  )
}