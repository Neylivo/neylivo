import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { joinServerDirect } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import { usePresence } from '../lib/presence'
import { toastOk, toastErr } from '../lib/toast'
import { fmtN, ruMembers } from '../lib/ui'
import { Icon } from './icons'
import { Avatar } from './Avatar'
import { TagChip, type ServerTag } from './TagEmoji'

interface PreviewData { name: string; avatar_url: string | null; banner_url: string | null; description: string | null; created_at: string | null; member_count: number; online_ids: string[] | null }

// v1.195.0: клик по тегу сервера рядом с ником — превью сервера + «Вступить»,
// как в настоящем Discord. Данные идут через server_tag_preview() (миграция
// 52_server_tag_preview.sql, security definer) — обычный select сервера тут не
// сработает, тег специально показывают тем, кто ещё НЕ на сервере (иначе зачем
// кнопка «Вступить»), а servers_read RLS пускает читать только участников.
export function ServerTagPreview({ serverId, tag, onClose, onJoined }: {
  serverId: string; tag: ServerTag; onClose: () => void; onJoined?: (serverId: string) => void
}) {
  const { user } = useAuth()
  const { online } = usePresence()
  const [data, setData] = useState<PreviewData | null>(null)
  const [failed, setFailed] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [myName, setMyName] = useState('участник')

  useEffect(() => {
    let ok = true
    supabase.rpc('server_tag_preview', { p_server: serverId }).then(({ data: rows, error }) => {
      if (!ok) return
      const row = Array.isArray(rows) ? rows[0] : rows
      if (error || !row) { setFailed(true); return }
      setData(row as PreviewData)
    })
    if (user) supabase.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle()
      .then(({ data: p }) => { if (ok && p) setMyName((p as any).display_name || (p as any).username || 'участник') })
    return () => { ok = false }
  }, [serverId, user])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function join() {
    if (!user || joining || joined) return
    setJoining(true)
    try {
      const res: any = await joinServerDirect(serverId, user.id, myName)
      if (res?.error) { toastErr(String(res.error.message ?? res.error)); return }
      setJoined(true)
      toastOk('Вы вступили на сервер «' + (data?.name ?? '') + '»')
      onJoined?.(serverId)
    } finally { setJoining(false) }
  }

  const ids = data?.online_ids ?? []
  const onlineCnt = ids.filter(id => online[id] && online[id].status !== 'offline').length
  const founded = data?.created_at ? new Date(data.created_at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal srvtagprev" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        {failed && <div className="modal-empty">Не удалось загрузить сервер.</div>}
        {!failed && !data && <div className="modal-empty">Загрузка…</div>}
        {data && <div className="inv2-box">
          {data.banner_url && <div className="inv2-banner" style={{ backgroundImage: `url(${data.banner_url})` }} />}
          <div className={'inv2-body' + (data.banner_url ? ' has-bn' : '')}>
            <div className="inv2-ico"><Avatar name={data.name} url={data.avatar_url} size={data.banner_url ? 56 : 48} /></div>
            <div className="inv2-nm"><span className="inv2-nm-t">{data.name}</span>{tag.name && <TagChip tag={tag} />}</div>
            <div className="inv2-stats">
              <span className="inv2-st"><i className="on" /> {fmtN(onlineCnt)} в сети</span>
              <span className="inv2-st"><i /> {fmtN(data.member_count)} {ruMembers(data.member_count)}</span>
            </div>
            {founded && <div className="inv2-meta">Дата основания: {founded} г.</div>}
            {data.description && <div className="inv2-desc">{data.description}</div>}
            <button className="inv2-join" disabled={joining || joined} onClick={join}>
              {joined ? 'Вы вступили' : joining ? 'Вступаем…' : 'Вступить'}
            </button>
          </div>
        </div>}
      </div>
    </div>
  )
}
