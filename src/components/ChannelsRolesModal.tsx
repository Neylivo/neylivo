import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { fetchRoles, type ServerRole } from '../lib/roles'
import { PERM, PERM_GROUPS, hasPerm } from '../lib/permissions'
import type { Channel } from '../types'

// v1.315.0: «Каналы и роли» — раньше пункт меню показывал заглушку «скоро появится».
//
// Что это по смыслу (как в Discord): одно место, где видно устройство сервера —
// какие есть каналы, какие роли и что каждая из них позволяет. Нужно не для
// настройки, а чтобы понять, почему ты чего-то не видишь или не можешь: без
// такого экрана человеку остаётся только гадать, роль это, приватность канала или
// поломка.
//
// Только чтение: менять роли и каналы можно там же, где и раньше, — в настройках
// сервера. Смешивать просмотр с правкой значило бы дать кнопку «изменить» тем,
// у кого нет прав, и объяснять отказ уже после нажатия.

export function ChannelsRolesModal({ channels, serverId, myPerms, isOwner, onClose, onOpenChannel }: {
  channels: Channel[]
  serverId: string
  myPerms: number
  isOwner: boolean
  onClose: () => void
  onOpenChannel?: (c: Channel) => void
}) {
  const [tab, setTab] = useState<'channels' | 'roles'>('channels')
  const [roles, setRoles] = useState<ServerRole[] | null>(null)

  useEffect(() => {
    let ok = true
    fetchRoles(serverId)
      .then(r => { if (ok) setRoles(r) })
      .catch(() => { if (ok) setRoles([]) })
    return () => { ok = false }
  }, [serverId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Категории в этом проекте — каналы вида kind='category'; остальные идут под
  // последней встреченной. Тот же порядок, что и в списке слева, чтобы человек
  // видел ровно ту же картину, а не другую сортировку.
  const groups: { cat: Channel | null; items: Channel[] }[] = []
  for (const c of channels) {
    if (c.kind === 'category') groups.push({ cat: c, items: [] })
    else {
      if (!groups.length) groups.push({ cat: null, items: [] })
      groups[groups.length - 1].items.push(c)
    }
  }

  const kindIcon = (c: Channel) => c.kind === 'voice' ? 'volume' : c.kind === 'announcement' ? 'megaphone' : 'hash'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chr-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">Каналы и роли</div>
        <div className="modal-sub">Как устроен этот сервер и что тебе доступно</div>

        <div className="chr-tabs">
          <button className={'chr-tab' + (tab === 'channels' ? ' on' : '')} onClick={() => setTab('channels')}>
            Каналы <span className="chr-count">{channels.filter(c => c.kind !== 'category').length}</span>
          </button>
          <button className={'chr-tab' + (tab === 'roles' ? ' on' : '')} onClick={() => setTab('roles')}>
            Роли <span className="chr-count">{roles?.length ?? '…'}</span>
          </button>
        </div>

        {tab === 'channels' && <div className="chr-body">
          {groups.length === 0 && <div className="modal-empty">На сервере пока нет каналов</div>}
          {groups.map((g, i) => (
            <div key={g.cat?.id ?? 'no-cat-' + i} className="chr-group">
              {g.cat && <div className="chr-cat">{g.cat.name}</div>}
              {g.items.map(c => {
                const priv = !!(c as any).settings?.private
                return (
                  <div key={c.id} className="chr-item" onClick={() => { if (onOpenChannel) { onOpenChannel(c); onClose() } }}>
                    <Icon name={kindIcon(c)} size={16} />
                    <span className="chr-name">{c.name}</span>
                    {priv && <span className="chr-tag" title="Виден не всем — доступ выдаётся ролью">
                      <Icon name="lock" size={12} /> закрытый
                    </span>}
                    {c.topic && <span className="chr-topic">{c.topic}</span>}
                  </div>
                )
              })}
              {g.items.length === 0 && g.cat && <div className="chr-empty">пусто</div>}
            </div>
          ))}
          <div className="chr-note">
            Здесь только те каналы, которые тебе доступны. Если товарищ упоминает канал,
            которого ты не видишь, — он закрытый, и доступ к нему даёт роль.
          </div>
        </div>}

        {tab === 'roles' && <div className="chr-body">
          {roles === null && <div className="modal-empty">Загружаю роли…</div>}
          {roles?.length === 0 && <div className="modal-empty">На сервере пока нет ролей</div>}
          {roles?.map(r => {
            const perms = r.permissions ?? 0
            // Показываем не все права подряд, а только выданные — иначе список из
            // трёх десятков строк с прочерками читать невозможно.
            const granted = PERM_GROUPS.flatMap(g => g.perms).filter(p => hasPerm(perms, p.bit))
            return (
              <div key={r.id} className="chr-role">
                <div className="chr-role-h">
                  <span className="chr-dot" style={{ background: r.color }} />
                  <span className="chr-name" style={{ color: r.color }}>{r.name}</span>
                  {hasPerm(perms, PERM.MANAGE_SERVER) && <span className="chr-tag warn">управляет сервером</span>}
                </div>
                {granted.length > 0 && (
                  <div className="chr-perms">
                    {granted.slice(0, 8).map(p => <span key={p.bit} className="chr-perm">{p.label}</span>)}
                    {granted.length > 8 && <span className="chr-perm mut">и ещё {granted.length - 8}</span>}
                  </div>
                )}
                {granted.length === 0 && (
                  <div className="chr-perms"><span className="chr-perm mut">без особых прав</span></div>
                )}
              </div>
            )
          })}
          <div className="chr-note">
            {isOwner || hasPerm(myPerms, PERM.MANAGE_ROLES)
              ? 'Изменить роли можно в настройках сервера, вкладка «Роли».'
              : 'Роли выдаёт владелец сервера или участник с правом управления ролями.'}
          </div>
        </div>}
      </div>
    </div>
  )
}
