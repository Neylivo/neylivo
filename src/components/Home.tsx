import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server } from '../types'
import { ServerView } from './ServerView'
import { DMHome } from './DMHome'

type View = { kind: 'dm' } | { kind: 'server'; server: Server }

export function Home() {
  const { user } = useAuth()
  const [username, setUsername] = useState('Вы')
  const [servers, setServers] = useState<Server[]>([])
  const [view, setView] = useState<View>({ kind: 'dm' })

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('username').eq('id', user.id).single()
      .then(({ data }) => { if (data?.username) setUsername(data.username) })
    loadServers()
    // eslint-disable-next-line
  }, [user])

  async function loadServers(select?: Server) {
    const { data } = await supabase.from('servers').select('*').order('created_at')
    const list = data ?? []
    setServers(list)
    if (select) setView({ kind: 'server', server: select })
  }

  async function createServer() {
    const name = prompt('Название сервера')?.trim()
    if (!name || !user) return
    const { data, error } = await supabase.from('servers').insert({ name, owner: user.id }).select().single()
    if (error) return alert(error.message)
    if (data) {
      await supabase.from('channels').insert({ server_id: data.id, name: 'общий' })
      loadServers(data as Server)
    }
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
        <button className="srv add" title="Создать сервер" onClick={createServer}>＋</button>
      </nav>
      {view.kind === 'dm'
        ? <DMHome username={username} />
        : <ServerView server={view.server} username={username} />}
    </div>
  )
}
