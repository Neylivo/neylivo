import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server } from '../types'
import { ServerView } from './ServerView'
import { DMHome } from './DMHome'
import { myServers, createServer as createSrv, joinByCode } from '../lib/servers'

type View = { kind: 'dm' } | { kind: 'server'; server: Server }

export function Home() {
  const { user } = useAuth()
  const [username, setUsername] = useState('Вы')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [view, setView] = useState<View>({ kind: 'dm' })

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

  async function onCreate() {
    const name = prompt('Название сервера')?.trim()
    if (!name || !user) return
    const res = await createSrv(name, user.id, username)
    if (res.error) return alert(res.error.message)
    if (res.server) refresh(res.server.id)
  }

  async function onJoin() {
    const code = prompt('Вставь код приглашения или ссылку')?.trim()
    if (!code || !user) return
    const res = await joinByCode(code, user.id, username)
    if (res.error) return alert(res.error.message)
    if (res.serverId) refresh(res.serverId)
  }

  return (
    <div className="app">
      <nav className="servers">
        <button className={'srv home' + (view.kind === 'dm' ? ' on' : '')}
          title="Личные сообщения" onClick={() => setView({ kind: 'dm' })}>🏠</button>
        <div className="srv-sep" />
        {servers.map(s => (
          <button key={s.id} className={'srv' + (view.kind === 'server' && view.server.id === s.id ? ' on' : '')}
            title={s.name} onClick={() => setView({ kind: 'server', server: s })}>{s.name.slice(0, 2).toUpperCase()}</button>
        ))}
        <button className="srv add" title="Создать сервер" onClick={onCreate}>＋</button>
        <button className="srv join" title="Присоединиться по коду" onClick={onJoin}>🔗</button>
      </nav>
      {view.kind === 'dm'
        ? <DMHome username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} />
        : <ServerView server={view.server} username={username} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} onLeft={() => { setView({ kind: 'dm' }); refresh() }} />}
    </div>
  )
}
