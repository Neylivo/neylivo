import { useEffect, useRef, useState } from 'react'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { uploadTo } from '../lib/storage'
import { useAuth } from '../auth/AuthProvider'
import { createRole, deleteRole, updateRole, toggleMemberRole, saveRoleOrder, setRolePermissions, type ServerRole } from '../lib/roles'
import { PERM_GROUPS, hasPerm } from '../lib/permissions'
import type { Server } from '../types'
import { Icon } from './icons'

// Редактор ролей — 1-в-1 как в Discord (v1.96.0): слева «НАЗАД», плюс и список
// ролей (+ @everyone), в центре вкладки «Элементы отображения / Права доступа /
// Ссылки», справа «Управлять участниками (N)». Всё, что в Discord за буст
// (градиенты/голограммы), здесь по правилу проекта просто отсутствует.

const PALETTE = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a',
]
const DEFAULT_COLOR = '#99aab5'

export function RoleEditor({ server, roles, members, memberRoles, roleId, onSelectRole, onBack, onEveryone, onReload, isOwner, myTopPosition }: {
  server: Server; roles: ServerRole[]; members: any[]; memberRoles: Record<string, string[]>
  roleId: string; onSelectRole: (id: string) => void; onBack: () => void; onEveryone: () => void; onReload: () => Promise<void>
  // v1.191.0: иерархия — нельзя редактировать/удалять роль не ниже своей старшей (как в Discord).
  isOwner?: boolean; myTopPosition?: number
}) {
  const { user } = useAuth()
  const [rtab, setRtab] = useState<'display' | 'perms' | 'links'>('display')
  const [nm, setNm] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [busy, setBusy] = useState(false)
  const iconRef = useRef<HTMLInputElement>(null)
  const found = roles.find(r => r.id === roleId)
  useEffect(() => { setNm(found?.name ?? ''); setShowAdd(false); setAddQ('') }, [roleId, found?.name])
  if (!found) return null
  const role = found
  const canManage = !!isOwner || (myTopPosition ?? Infinity) < role.position

  // Роли участника: новая таблица member_roles, до миграции 25 — старое одиночное role_id.
  const rolesOf = (uid: string): string[] => {
    const multi = memberRoles[uid]
    if (multi && multi.length) return multi
    const mm = members.find(m => m.user_id === uid)
    return mm?.role_id ? [mm.role_id] : []
  }
  const withRole = members.filter(m => rolesOf(m.user_id).includes(role.id))
  const withoutRole = members.filter(m => !rolesOf(m.user_id).includes(role.id))

  const saveName = async () => {
    const v = nm.trim()
    if (!v || v === role.name) { setNm(role.name); return }
    const { error } = await updateRole(role.id, { name: v })
    if (error) return toastErr(String(error.message ?? error))
    await onReload(); toastOk('Роль переименована')
  }
  const setColor = async (c: string) => {
    const { error } = await updateRole(role.id, { color: c })
    if (error) return toastErr(String(error.message ?? error))
    await onReload()
  }
  // v1.156.0: битовая маска прав (миграция 34_permissions.sql) вместо одного
  // флага manage — переключатель конкретного права меняет только его бит.
  const togglePerm = async (bit: number, on: boolean) => {
    const next = on ? ((role.permissions ?? 0) | bit) : ((role.permissions ?? 0) & ~bit)
    const { error } = await setRolePermissions(role.id, next)
    if (error) return toastErr(String(error.message ?? error).includes('permissions') ? 'Сначала примени миграцию supabase/34_permissions.sql в Supabase SQL Editor' : String(error.message ?? error))
    await onReload()
  }
  const pickIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f || !user) return
    if (f.size > 1024 * 1024) { e.target.value = ''; return toastErr('Изображение должно быть меньше 1 МБ') }
    setBusy(true)
    try {
      const url = await uploadTo('avatars', user.id, f)
      const { error } = await updateRole(role.id, { icon_url: url })
      if (error) toastErr(String(error.message ?? error).includes('icon_url') ? 'Сначала примени миграцию supabase/25_member_roles.sql в Supabase SQL Editor' : String(error.message ?? error))
      else await onReload()
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false); e.target.value = '' }
  }
  const moveRole = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= roles.length) return
    const next = [...roles]
    ;[next[i], next[j]] = [next[j], next[i]]
    const { error } = await saveRoleOrder(next)
    if (error) toastErr(String((error as any).message ?? error))
    else await onReload()
  }
  const mav = (m: any) => (
    <span className="redit-mem-av" style={m.avatar_url ? { backgroundImage: `url(${m.avatar_url})` } : undefined}>
      {!m.avatar_url && (m.member_name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )

  return (
    <div className="redit">
      <div className="redit-side">
        <div className="redit-back" onClick={onBack}><Icon name="chevron-right" size={16} style={{ transform: 'rotate(180deg)' }} /> НАЗАД</div>
        <div className="redit-side-h">
          <span>РОЛИ</span>
          <button className="redit-plus" title="Создать роль" onClick={async () => {
            const { error } = await createRole(server.id, 'новая роль', DEFAULT_COLOR)
            if (error) return toastErr(String(error.message ?? error))
            await onReload()
          }}><Icon name="plus" size={14} /></button>
        </div>
        {roles.map((r, i) => (
          <div key={r.id} className={'redit-role' + (r.id === roleId ? ' on' : '')} onClick={() => onSelectRole(r.id)}>
            <span className="role-dot" style={{ background: r.color }} />
            <span className="redit-role-nm">{r.name}</span>
            <span className="redit-rmove" onClick={e => e.stopPropagation()}>
              <button title="Выше (в списке участников)" disabled={i === 0} onClick={() => moveRole(i, -1)}>▲</button>
              <button title="Ниже (в списке участников)" disabled={i === roles.length - 1} onClick={() => moveRole(i, 1)}>▼</button>
            </span>
          </div>
        ))}
        <div className="redit-role" onClick={onEveryone}>
          <span className="role-dot" style={{ background: '#99aab5' }} />
          <span className="redit-role-nm">@everyone</span>
        </div>
      </div>
      <div className="redit-main">
        <div className="redit-head">
          <div className="redit-title">РЕДАКТИРОВАТЬ РОЛЬ — {role.name.toUpperCase()}</div>
          {canManage && <button className="redit-dots" title="Удалить роль" onClick={async () => {
            if (!await confirmUi('Удалить роль «' + role.name + '»?', { okText: 'Удалить' })) return
            await deleteRole(role.id); await onReload(); onBack()
          }}><Icon name="trash" size={15} /></button>}
          <div className="redit-manage" onClick={() => setShowMembers(v => !v)}>Управлять участниками ({withRole.length})</div>
        </div>
        <div className="redit-tabs">
          <span className={rtab === 'display' ? 'on' : ''} onClick={() => setRtab('display')}>Элементы отображения</span>
          <span className={rtab === 'perms' ? 'on' : ''} onClick={() => setRtab('perms')}>Права доступа</span>
          <span className={rtab === 'links' ? 'on' : ''} onClick={() => setRtab('links')}>Ссылки</span>
        </div>
        {rtab === 'display' && <div className="redit-body">
          {!canManage && <div className="cset-hint" style={{ marginBottom: 10 }}>Эта роль не ниже вашей старшей — редактирование недоступно.</div>}
          <label className="pqs-lbl">Название роли <i className="req">*</i></label>
          <input className="modal-in" value={nm} onChange={e => setNm(e.target.value)} onBlur={saveName} disabled={!canManage}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          <label className="pqs-lbl">Цвет роли <i className="req">*</i></label>
          <div className="cset-hint" style={{ marginTop: 0 }}>Для участников используется цвет высшей роли, которую они имеют.</div>
          <div className="redit-colors" style={!canManage ? { pointerEvents: 'none', opacity: .5 } : undefined}>
            <span className={'redit-sw big' + (role.color === DEFAULT_COLOR ? ' on' : '')} style={{ background: DEFAULT_COLOR }} title="По умолчанию"
              onClick={() => setColor(DEFAULT_COLOR)}>{role.color === DEFAULT_COLOR && <Icon name="check" size={18} />}</span>
            <label className="redit-sw big custom" title="Свой цвет">
              <input type="color" value={role.color} onChange={e => setColor(e.target.value)} />
              <Icon name="edit" size={14} />
            </label>
            <span className="redit-grid">
              {PALETTE.map(c => <span key={c} className={'redit-sw' + (role.color === c ? ' on' : '')} style={{ background: c }}
                onClick={() => setColor(c)}>{role.color === c && <Icon name="check" size={12} />}</span>)}
            </span>
          </div>
          <label className="pqs-lbl">Значок роли</label>
          <div className="cset-hint" style={{ marginTop: 0 }}>Загрузите изображение размером менее 1 МБ. Мы советуем использовать разрешение не менее 64 x 64 пикселя. Если у участников есть несколько ролей, они будут видеть значок высшей из них.</div>
          <div className="redit-iconrow">
            <span className="redit-iconprev">{role.icon_url ? <img src={role.icon_url} alt="" /> : '🖼️'}</span>
            <button className="modal-primary" disabled={!canManage} onClick={() => iconRef.current?.click()}>{busy ? 'Загрузка…' : 'Выберите изображение'}</button>
            {role.icon_url && canManage && <button className="pqs2-btn ghost" onClick={async () => { await updateRole(role.id, { icon_url: null }); await onReload() }}>Убрать</button>}
            <input ref={iconRef} type="file" accept="image/*" hidden onChange={pickIcon} />
          </div>
          <div className="redit-preview">
            <span className="redit-prev-av">🤖</span>
            <div>
              <b style={{ color: role.color === DEFAULT_COLOR ? undefined : role.color }}>Вампус{role.icon_url && <img className="role-badge" src={role.icon_url} alt="" />}</b> <small className="mut">20:57</small>
              <div>камни очень старые</div>
            </div>
          </div>
        </div>}
        {rtab === 'perms' && <div className="redit-body">
          {PERM_GROUPS.map(g => (
            <div key={g.title} className="redit-permgrp">
              <div className="redit-permgrp-h">{g.title}</div>
              {g.perms.map(p => {
                const on = hasPerm(role.permissions, p.bit)
                return (
                  <div key={p.bit} className="cset-perm">
                    <div className="cset-perm-h">{p.label}
                      <label className="sset-rmanage" style={{ marginLeft: 'auto' }}>
                        <input type="checkbox" checked={on} disabled={!canManage} onChange={e => togglePerm(p.bit, e.target.checked)} /> Разрешить
                      </label>
                    </div>
                    <div className="cset-hint">{p.hint}</div>
                  </div>
                )
              })}
            </div>
          ))}
          <div className="cset-hint" style={{ marginTop: 14 }}>Право видеть/писать в конкретном канале, подключаться к голосовым каналам и т.д. настраивается в «Права по умолчанию» (@everyone) и действует на всех участников.</div>
        </div>}
        {rtab === 'links' && <div className="redit-body">
          <div className="sset-empty">🔗<b>ПОКА НЕТ ССЫЛОК</b>Ссылки, привязанные к этой роли, появятся здесь.</div>
        </div>}
      </div>
      {showMembers && <div className="redit-members">
        <div className="redit-mem-h">Управлять участниками ({withRole.length})
          <button className="modal-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowAdd(v => !v)}>{showAdd ? 'Готово' : 'Добавить'}</button>
        </div>
        {showAdd && <>
          <input className="modal-in" style={{ margin: '6px 0 0' }} placeholder="Поиск участников" value={addQ} onChange={e => setAddQ(e.target.value)} />
          <div className="redit-mem-list">
            {withoutRole.filter(m => (m.member_name ?? '').toLowerCase().includes(addQ.toLowerCase())).map(m => (
              <div key={m.user_id} className="redit-mem" title="Выдать роль"
                onClick={async () => { await toggleMemberRole(server.id, m.user_id, role.id, true); await onReload() }}>
                {mav(m)}{m.member_name}
                <span className="redit-mem-x" style={{ color: '#3ba55d' }}><Icon name="plus" size={13} /></span>
              </div>
            ))}
            {withoutRole.length === 0 && <div className="cset-hint">Роль уже у всех участников.</div>}
          </div>
        </>}
        <div className="redit-mem-list">
          {withRole.map(m => (
            <div key={m.user_id} className="redit-mem">
              {mav(m)}{m.member_name}
              <span className="redit-mem-x" title="Снять роль"
                onClick={async () => { await toggleMemberRole(server.id, m.user_id, role.id, false); await onReload() }}><Icon name="close" size={13} /></span>
            </div>
          ))}
          {withRole.length === 0 && !showAdd && <div className="cset-hint">Пока никого — нажмите «Добавить».</div>}
        </div>
      </div>}
    </div>
  )
}
