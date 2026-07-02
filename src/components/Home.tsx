import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server } from '../types'
import { ServerView } from './ServerView'
import { DMHome } from './DMHome'
import { MusicPlayer } from '../music/MusicPlayer'
import { myServers, createServer as createSrv, joinByCode, findServers, renameServer, deleteServer, updateServer } from '../lib/servers'
import { CreateServerModal, FindServerModal, ServerCtxMenu, ServerSettingsModal } from './ServerModals'
import { PresenceProvider } from '../lib/presence'

type View = { kind: 'dm' } | { kind: 'music' } | { kind: 'server'; server: Server }

export function Home() {
  const { user } = useAuth()
  const [username, setUsername] = useState('Вы')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [view, setView] = useState<View>({ kind: 'dm' })
  const [showCreate, setShowCreate] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [ctx, setCtx] = useState<{ server: Server; x: number; y: number } | null>(null)
  const [settingsServer, setSettingsServer] = useState<Server | null>(null)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single()
      .then(({ data }) => { if (data?.username) setUsername(data.username); if (data?.avatar_url) setAvatarUrl(data.avatar_url) })
    refresh()
    // eslint-disable-next-line
  }, [user])

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
    if (res.error) return alert(res.error.message)
    setShowCreate(false)
    if (res.server) refresh(res.server.id)
  }

  async function onCtxAction(k: string, server: Server) {
    if (!user) return
    if (k === 'copyid') { navigator.clipboard?.writeText(server.id); return }
    if (k === 'settings') { setSettingsServer(server); return }
    if (k === 'invite') {
      const { createInvite } = await import('../lib/servers')
      const res = await createInvite(server.id, user.id)
      if (res.code) { navigator.clipboard?.writeText(res.code); alert('Код приглашения скопирован: ' + res.code) }
      return
    }
    if (k === 'delete') {
      if (server.owner !== user.id) return alert('Только владелец может удалить сервер')
      await deleteServer(server.id)
      setView({ kind: 'dm' }); refresh()
      return
    }
    // read / notif / mute / tag — client-side niceties, no-op persistence for now
  }

  return (
    <PresenceProvider username={username} avatarUrl={avatarUrl}>
    <div className="app">
      <nav className="servers">
        <div className={'srv-wrap' + (view.kind === 'dm' ? ' on' : '')}>
          <button className={'srv home' + (view.kind === 'dm' ? ' on' : '')}
            title="Личные сообщения" onClick={() => setView({ kind: 'dm' })}>🏠</button>
        </div>
        <div className={'srv-wrap' + (view.kind === 'music' ? ' on' : '')}>
          <button className={'srv music' + (view.kind === 'music' ? ' on' : '')}
            title="Ponoi Music" onClick={() => setView({ kind: 'music' })}>🎵</button>
        </div>
        <div className="srv-sep" />
        {servers.map(s => (
          <div key={s.id} className={'srv-wrap' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '')}>
            <button className={'srv' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '')}
              style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center', color: 'transparent' } : undefined}
              title={s.name}
              onClick={() => setView({ kind: 'server', server: s })}
              onContextMenu={e => { e.preventDefault(); setCtx({ server: s, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 320) }) }}>
              {s.name.slice(0, 2).toUpperCase()}</button>
          </div>
        ))}
        <button className="srv add" title="Создать сервер" onClick={() => setShowCreate(true)}>＋</button>
        <button className="srv join" title="Найти сервер" onClick={() => setShowFind(true)}>🔍</button>
      </nav>
      {view.kind === 'music'
        ? <MusicPlayer me={username} meId={user?.id ?? ''} onClose={() => setView({ kind: 'dm' })} />
        : view.kind === 'dm'
        ? <DMHome username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} />
        : <ServerView server={view.server} username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} onLeft={() => { setView({ kind: 'dm' }); refresh() }} />}
    </div>
    {showCreate && <CreateServerModal uid={user?.id ?? ''} onClose={() => setShowCreate(false)} onCreate={onCreate} />}
    {showFind && <FindServerModal onClose={() => setShowFind(false)} onFind={findServers} />}
    {ctx && <ServerCtxMenu x={ctx.x} y={ctx.y} isOwner={ctx.server.owner === user?.id} onClose={() => setCtx(null)} onAction={k => onCtxAction(k, ctx.server)} />}
    {settingsServer && <ServerSettingsModal server={settingsServer} uid={user?.id ?? ''}
      onClose={() => setSettingsServer(null)}
      onChanged={() => refresh()}
      onRename={async name => { await renameServer(settingsServer.id, name); setSettingsServer(null); refresh() }}
      onDelete={async () => { await deleteServer(settingsServer.id); setSettingsServer(null); setView({ kind: 'dm' }); refresh() }} />}
    </PresenceProvider>
  )
}