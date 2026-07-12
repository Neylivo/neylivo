import { toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import type { Server, Channel } from '../types'
import { uploadTo } from '../lib/storage'
import { updateServer, discoverServers, joinServerDirect, type DiscoverServer } from '../lib/servers'
import { notifModeOf, setNotifMode, muteUntilOf, NOTIF_LABEL, type NotifMode } from '../lib/srvNotify'
import { chOverrideOf, setChNotifMode, chMuteUntilOf } from '../lib/chNotify'
import { getUserPrefs, patchUserPrefs } from '../lib/userPrefs'
import { Icon } from './icons'
import { useClampToViewport } from '../lib/clampPos'

// v1.260.0: длительность заглушения сервера/канала — как в Discord (флайаут при
// «Заглушить»). ЛС (dm_muted) это уже умели, серверам/каналам не хватало.
const MUTE_DURATIONS: { label: string; ms: number }[] = [
  { label: '15 минут', ms: 15 * 60_000 },
  { label: '1 час', ms: 60 * 60_000 },
  { label: '3 часа', ms: 3 * 60 * 60_000 },
  { label: '8 часов', ms: 8 * 60 * 60_000 },
  { label: '24 часа', ms: 24 * 60 * 60_000 },
]
function fmtUntil(ms: number): string {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? 'до ' + time : 'до ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + time
}
function MuteDurationRow({ untilMs, onPick }: { untilMs: number | null; onPick: (ms: number | null) => void }) {
  return (
    <div className="notif-mutefor">
      <div className="notif-mutefor-t">{untilMs ? 'Заглушено ' + fmtUntil(untilMs) : 'Заглушить на время'}</div>
      <div className="notif-mutefor-chips">
        {MUTE_DURATIONS.map(d => <button key={d.label} className="notif-chip" onClick={() => onPick(d.ms)}>{d.label}</button>)}
        {untilMs && <button className="notif-chip" onClick={() => onPick(null)}>Насовсем</button>}
      </div>
    </div>
  )
}

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  )
}

// Шаблоны для экрана «Создайте свой сервер» — 1-в-1 как в Discord.
const SRV_TEMPLATES = [
  { icon: '🎮', label: 'Игры' },
  { icon: '💗', label: 'Друзья' },
  { icon: '🍎', label: 'Учебная группа' },
  { icon: '✏️', label: 'Школьный клуб' },
  { icon: '🎨', label: 'Творческое сообщество' },
  { icon: '🌍', label: 'Локальное сообщество' },
]

export function CreateServerModal({ uid, username, onClose, onCreate, onJoin }:
  { uid: string; username?: string; onClose: () => void; onCreate: (name: string, avatarUrl: string | null) => void; onJoin?: () => void }) {
  // Трёхшаговая модалка как в Discord:
  // выбор шаблона → «Расскажите нам о вашем сервере» → персонализация (имя + значок).
  const [step, setStep] = useState<'pick' | 'about' | 'custom'>('pick')
  const [tplName, setTplName] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !uid) return
    setBusy(true)
    try { setAvatar(await uploadTo('avatars', uid, f)) }
    catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }
  function chooseTpl(label: string | null) {
    setTplName(label)
    setStep('about')
  }
  function toCustom() {
    // Имя по умолчанию: из шаблона, иначе «Сервер <ник>» — как в Discord.
    setName(tplName ?? `Сервер ${username || 'guchip0n'}`)
    setStep('custom')
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal csrv" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        {step === 'pick' && (<>
          <div className="csrv-head">
            <div className="modal-title">Создайте свой сервер</div>
            <div className="modal-sub">Ваш сервер — это место, где вы можете тусоваться со своими друзьями. Создайте сервер и начните общаться.</div>
          </div>
          <div className="csrv-list">
            <button className="csrv-row" onClick={() => chooseTpl(null)}>
              <span className="csrv-ico">🚀</span>
              <span className="csrv-lbl">Свой шаблон</span>
              <span className="csrv-arr">›</span>
            </button>
            <div className="csrv-sect">Начните с шаблона</div>
            {SRV_TEMPLATES.map(t => (
              <button key={t.label} className="csrv-row" onClick={() => chooseTpl(t.label)}>
                <span className="csrv-ico">{t.icon}</span>
                <span className="csrv-lbl">{t.label}</span>
                <span className="csrv-arr">›</span>
              </button>
            ))}
          </div>
          <div className="csrv-join">
            <div className="csrv-join-t">У вас уже есть приглашение?</div>
            <button className="csrv-joinbtn" onClick={() => { onClose(); onJoin?.() }}>Присоединиться к серверу</button>
          </div>
        </>)}
        {step === 'about' && (<>
          <div className="csrv-head">
            <div className="modal-title">Расскажите нам о вашем сервере</div>
            <div className="modal-sub">Чтобы мы смогли помочь вам с настройкой, скажите, для кого предназначен ваш сервер: для друзей или большого сообщества?</div>
          </div>
          <div className="csrv-list">
            <button className="csrv-row" onClick={toCustom}>
              <span className="csrv-ico">🌐</span>
              <span className="csrv-lbl">Для клуба или сообщества</span>
              <span className="csrv-arr">›</span>
            </button>
            <button className="csrv-row" onClick={toCustom}>
              <span className="csrv-ico">😺</span>
              <span className="csrv-lbl">Для меня и друзей</span>
              <span className="csrv-arr">›</span>
            </button>
            <div className="csrv-skip">Затрудняетесь ответить? Вы можете пока <a onClick={toCustom}>пропустить этот вопрос</a>.</div>
          </div>
          <div className="csrv-foot single">
            <button className="modal-ghost" onClick={() => setStep('pick')}>Назад</button>
          </div>
        </>)}
        {step === 'custom' && (<>
          <div className="csrv-head">
            <div className="modal-title">Персонализируйте свой сервер</div>
            <div className="modal-sub">Персонализируйте свой новый сервер, выбрав ему название и значок. Их можно будет изменить в любой момент.</div>
          </div>
          <div className="csrv-body">
            <div className="csrv-upwrap">
              <button className="csrv-up" style={avatar ? { backgroundImage: `url(${avatar})`, borderStyle: 'solid' } : undefined}
                onClick={() => fileRef.current?.click()} title="Загрузить значок">
                {!avatar && (<>
                  <Icon name="camera" size={22} />
                  <span className="csrv-up-t">{busy ? '…' : 'UPLOAD'}</span>
                </>)}
                <span className="csrv-up-plus">+</span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
            </div>
            <label className="modal-lbl">Название сервера <span className="csrv-req">*</span></label>
            <input className="modal-in" autoFocus value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim(), avatar) }} />
            <div className="csrv-terms">Создавая сервер, вы соглашаетесь с Правилами Сообщества Ponoi.</div>
          </div>
          <div className="csrv-foot">
            <button className="modal-ghost" onClick={() => setStep('about')}>Назад</button>
            <button className="modal-primary" disabled={!name.trim() || busy} onClick={() => onCreate(name.trim(), avatar)}>Создать</button>
          </div>
        </>)}
      </div>
    </div>
  )
}

// «Найти сервер» (v1.48.0): «Путешествие по серверам» в стиле Discord —
// живой поиск, подборка сообществ, карточки с иконкой и числом участников,
// вступление в один клик, «Открыть» для серверов, где уже состоишь.
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function FindServerModal({ uid, username, onClose, onJoined }:
  { uid: string; username: string; onClose: () => void; onJoined: (serverId: string) => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<DiscoverServer[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // eslint-disable-next-line
  useEffect(() => { load('') }, [])
  async function load(term: string) {
    const my = ++seq.current
    setItems(null)
    const res = await discoverServers(term, uid)
    if (my === seq.current) setItems(res)
  }
  function onInput(v: string) {
    setQ(v)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => load(v), 300)
  }
  async function join(s: DiscoverServer) {
    if (s.joined) { onJoined(s.id); return }
    if (busyId) return
    setBusyId(s.id)
    const res = await joinServerDirect(s.id, uid, username)
    setBusyId(null)
    if ((res as any).error) { toastErr(String((res as any).error.message ?? (res as any).error)); return }
    onJoined(s.id)
  }
  const list = items ?? []
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fsm" onClick={e => e.stopPropagation()}>
        <div className="fsm-hero">
          <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
          <div className="fsm-hero-ic"><Icon name="compass" size={26} /></div>
          <div className="fsm-hero-t">Путешествие по серверам</div>
          <div className="fsm-hero-sub">Найдите сообщество по названию или ID сервера — или загляните в подборку ниже.</div>
        </div>
        <div className="fsm-search">
          <span className="fsm-si"><Icon name="search" size={18} /></span>
          <input autoFocus placeholder="Название или ID сервера" value={q} onChange={e => onInput(e.target.value)} />
          {q && <button className="fsm-clear" title="Очистить" onClick={() => { setQ(''); load('') }}><Icon name="close" size={14} /></button>}
        </div>
        <div className="fsm-body">
          {items === null && <div className="fsm-skel"><i /><i /><i /></div>}
          {items !== null && <>
            <div className="fsm-sec">{q.trim() ? 'Результаты поиска' + (list.length ? ' — ' + list.length : '') : 'Сообщества Ponoi'}</div>
            {list.length === 0 && <div className="fsm-empty">
              <div className="fsm-empty-ic"><Icon name="compass" size={34} /></div>
              <b>Ничего не найдено</b>
              <span>Проверьте название — или попросите у друга код приглашения: вступить можно и по нему.</span>
            </div>}
            {list.map(s => {
              const initials = (s.name || 'S').slice(0, 2).toUpperCase()
              return (
                <div key={s.id} className="fsm-card" onClick={() => join(s)}>
                  <span className="fsm-av" style={s.avatar_url ? { backgroundImage: `url(${s.avatar_url})` } : undefined}>{!s.avatar_url && initials}</span>
                  <span className="fsm-tx">
                    <span className="fsm-nm">{s.name}</span>
                    <span className="fsm-meta">
                      {s.members > 0 && <><span className="fsm-dot" />{s.members} {plural(s.members, 'участник', 'участника', 'участников')}</>}
                      {s.joined && <span className="fsm-mine"><Icon name="check" size={12} /> Вы участник</span>}
                    </span>
                  </span>
                  <button className={'fsm-join' + (s.joined ? ' open' : '')} disabled={busyId === s.id}
                    onClick={e => { e.stopPropagation(); join(s) }}>
                    {busyId === s.id ? '…' : s.joined ? 'Открыть' : 'Присоединиться'}
                  </button>
                </div>
              )
            })}
          </>}
        </div>
      </div>
    </div>
  )
}

const CTX_ITEMS = [
  { k: 'read', label: 'Прочитать всё', icon: 'check' },
  { k: 'invite', label: 'Пригласить друга', icon: 'plus' },
  { k: 'notif', label: 'Настройки уведомлений', icon: 'bell' },
  { k: 'mute', label: 'Заглушить сервер', icon: 'bell-off' },
  { k: 'tag', label: 'Взять тег сервера', icon: 'tag' },
  { k: 'folder', label: 'Переместить в папку', icon: 'folder' },
  { k: 'copyid', label: 'Копировать ID сервера', icon: 'id-card' },
  { k: 'settings', label: 'Настройки сервера', icon: 'gear' },
  { k: 'delete', label: 'Удалить сервер', icon: 'trash', danger: true },
] as const

export function ServerCtxMenu({ x, y, isOwner, muted, onClose, onAction }:
  { x: number; y: number; isOwner: boolean; muted?: boolean; onClose: () => void; onAction: (k: string) => void }) {
  const clamp = useClampToViewport(x, y)
  useEffect(() => {
    const h = () => onClose()
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [onClose])
  return (
    <div className="ctxmenu" ref={clamp.ref} style={clamp.style} onClick={e => e.stopPropagation()}>
      {CTX_ITEMS.filter(i => isOwner || (i.k !== 'delete' && i.k !== 'settings')).map(i => (
        <div key={i.k} className={'ctxmenu-item' + ((i as any).danger ? ' danger' : '')}
          onClick={() => { onAction(i.k); onClose() }}>
          <span className="ctxmenu-ic"><Icon name={i.k === 'mute' && muted ? 'bell' : i.icon} size={16} /></span>{i.k === 'mute' ? (muted ? 'Включить уведомления' : 'Заглушить сервер') : i.label}
        </div>
      ))}
    </div>
  )
}

export function ServerSettingsModal({ server, uid, onClose, onRename, onDelete, onChanged }:
  { server: Server; uid: string; onClose: () => void; onRename: (name: string) => void; onDelete: () => void; onChanged?: () => void }) {
  const [tab, setTab] = useState<'main' | 'roles' | 'channels'>('main')
  const [accent, setAccent] = useState(server.accent || '#5865f2')
  const [avatar, setAvatar] = useState<string | null>(server.avatar_url ?? null)
  const [name, setName] = useState(server.name)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const initials = (server.name || 'S').slice(0, 2).toUpperCase()
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !uid) return
    setBusy(true)
    try {
      const url = await uploadTo('avatars', uid, f)
      setAvatar(url)
      await updateServer(server.id, { avatar_url: url })
      onChanged?.()
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
      <div className="modal-title">Настройки сервера — {server.name}</div>
      <div className="modal-tabs">
        <button className={'modal-tab' + (tab === 'main' ? ' on' : '')} onClick={() => setTab('main')}>Основное</button>
        <button className={'modal-tab' + (tab === 'roles' ? ' on' : '')} onClick={() => setTab('roles')}>Роли и права</button>
        <button className={'modal-tab' + (tab === 'channels' ? ' on' : '')} onClick={() => setTab('channels')}>Каналы</button>
      </div>

      {tab === 'main' && <>
        <div className="modal-sect">Аватарка сервера</div>
        <div className="modal-avwrap left">
          <div className="modal-av sq" style={{ backgroundImage: avatar ? `url(${avatar})` : undefined }}>{!avatar && initials}</div>
          <button className="modal-avbtn" onClick={() => fileRef.current?.click()}>{busy ? '…' : <><Icon name="image" size={16} /> Сменить</>}</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        </div>
        <label className="modal-lbl">Название сервера</label>
        <div className="modal-inline">
          <input className="modal-in" value={name} onChange={e => setName(e.target.value)} />
          <button className="modal-primary" disabled={!name.trim() || name === server.name} onClick={() => onRename(name.trim())}>Сохранить</button>
        </div>
        <div className="modal-sect">Тема сервера (акцент)</div>
        <div className="modal-inline">
          <input type="color" className="modal-color" value={accent} onChange={e => setAccent(e.target.value)} />
          <button className="modal-primary" onClick={async () => { await updateServer(server.id, { accent }); onChanged?.() }}>Применить</button>
          <button className="modal-ghost" onClick={async () => { setAccent('#5865f2'); await updateServer(server.id, { accent: null }); onChanged?.() }}>Сбросить</button>
          <span className="modal-hint">акцент применяется, когда открыт этот сервер</span>
        </div>
      </>}

      {tab === 'roles' && <div className="modal-note">Роли и права настраиваются в «Настройках сервера» → вкладка «Роли»: там можно создавать роли, менять цвета и права, выдавать роли участникам.</div>}
      {tab === 'channels' && <div className="modal-note">Каналы создаются и удаляются на боковой панели сервера (＋ канал).</div>}

      <div className="modal-foot">
        <button className="modal-danger" onClick={async () => { if (await confirmUi('Удалить сервер «' + server.name + '»? Это необратимо.', { okText: 'Удалить сервер' })) onDelete() }}>Удалить сервер</button>
        <button className="modal-ghost" onClick={onClose}>Закрыть</button>
      </div>
    </Overlay>
  )
}

export function ServerNotifModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const [mode, setMode] = useState<NotifMode>(notifModeOf(server.id))
  const [until, setUntil] = useState<number | null>(muteUntilOf(server.id))
  function pick(m: NotifMode, muteMs?: number | null) {
    setMode(m); setUntil(m === 'mute' && muteMs ? Date.now() + muteMs : null)
    setNotifMode(server.id, m, m === 'mute' && muteMs ? Date.now() + muteMs : undefined)
  }
  const opts: { m: NotifMode; hint: string }[] = [
    { m: 'all', hint: 'уведомлять о каждом сообщении' },
    { m: 'mentions', hint: 'только когда тебя упомянули (@имя или @everyone)' },
    { m: 'mute', hint: 'сервер полностью заглушен — ни уведомлений, ни точки' },
  ]
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
      <div className="modal-title">Уведомления — {server.name}</div>
      <div className="modal-sub">Настройка действует только для тебя, на этом устройстве.</div>
      <div className="notif-opts">
        {opts.map(o => (
          <label key={o.m} className={'notif-opt' + (mode === o.m ? ' on' : '')} onClick={() => pick(o.m)}>
            <span className={'notif-radio' + (mode === o.m ? ' on' : '')} />
            <span className="notif-body">
              <span className="notif-nm">{NOTIF_LABEL[o.m]}</span>
              <span className="notif-hint">{o.hint}</span>
            </span>
            {o.m === 'mute' && <Icon name="bell-off" size={16} />}
          </label>
        ))}
      </div>
      {mode === 'mute' && <MuteDurationRow untilMs={until} onPick={ms => pick('mute', ms)} />}
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Готово</button>
      </div>
    </Overlay>
  )
}

// v1.259.0: то же самое, но для одного канала — со своим состоянием «Как на сервере»
// (наследует режим сервера, пока явно не переопределили только этот канал).
export function ChannelNotifModal({ server, channel, onClose }: { server: Server; channel: Channel; onClose: () => void }) {
  const [mode, setMode] = useState<NotifMode | 'default'>(() => chOverrideOf(channel.id) ?? 'default')
  const [until, setUntil] = useState<number | null>(chMuteUntilOf(channel.id))
  function pick(m: NotifMode | 'default', muteMs?: number | null) {
    setMode(m); setUntil(m === 'mute' && muteMs ? Date.now() + muteMs : null)
    setChNotifMode(channel.id, m, m === 'mute' && muteMs ? Date.now() + muteMs : undefined)
  }
  const opts: { m: NotifMode | 'default'; label: string; hint: string }[] = [
    { m: 'default', label: 'Как на сервере', hint: 'сейчас — «' + NOTIF_LABEL[notifModeOf(server.id)].toLowerCase() + '»' },
    { m: 'all', label: NOTIF_LABEL.all, hint: 'уведомлять о каждом сообщении в этом канале' },
    { m: 'mentions', label: NOTIF_LABEL.mentions, hint: 'только когда тебя упомянули (@имя или @роль)' },
    { m: 'mute', label: NOTIF_LABEL.mute, hint: 'канал полностью заглушен — ни уведомлений, ни точки' },
  ]
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
      <div className="modal-title">Уведомления — #{channel.name}</div>
      <div className="modal-sub">Настройка действует только для тебя, на этом устройстве.</div>
      <div className="notif-opts">
        {opts.map(o => (
          <label key={o.m} className={'notif-opt' + (mode === o.m ? ' on' : '')} onClick={() => pick(o.m)}>
            <span className={'notif-radio' + (mode === o.m ? ' on' : '')} />
            <span className="notif-body">
              <span className="notif-nm">{o.label}</span>
              <span className="notif-hint">{o.hint}</span>
            </span>
            {o.m === 'mute' && <Icon name="bell-off" size={16} />}
          </label>
        ))}
      </div>
      {mode === 'mute' && <MuteDurationRow untilMs={until} onPick={ms => pick('mute', ms)} />}
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Готово</button>
      </div>
    </Overlay>
  )
}


// Настройки конфиденциальности сервера — персональные, синхронизируются через
// user_prefs (миграция 39), как остальные личные настройки.
export function ServerPrivacyModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const [prefs, setPrefs] = useState<{ dm: boolean; activity: boolean }>(() => {
    const p = getUserPrefs().srv_privacy[server.id]
    return p ? { dm: p.dm, activity: p.activity } : { dm: true, activity: true }
  })
  function save(p: { dm: boolean; activity: boolean }) {
    setPrefs(p)
    patchUserPrefs({ srv_privacy: { ...getUserPrefs().srv_privacy, [server.id]: p } })
  }
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
      <div className="modal-title" style={{ textAlign: 'left' }}>Настройки конфиденциальности</div>
      <div className="modal-sub" style={{ textAlign: 'left' }}>{server.name}</div>
      <div className="priv-row">
        <div className="priv-t"><b>Личные сообщения</b><span>Разрешить личные сообщения от других участников этого сервера.</span></div>
        <button className={'tgl' + (prefs.dm ? ' on' : '')} onClick={() => save({ ...prefs, dm: !prefs.dm })} />
      </div>
      <div className="priv-row">
        <div className="priv-t"><b>Статус активности</b><span>Делиться статусом вашей игровой активности с участниками этого сервера.</span></div>
        <button className={'tgl' + (prefs.activity ? ' on' : '')} onClick={() => save({ ...prefs, activity: !prefs.activity })} />
      </div>
      <div className="cset-hint">Эти настройки применяются только к серверу «{server.name}».</div>
      <div className="modal-foot"><button className="modal-ghost" onClick={onClose}>Готово</button></div>
    </Overlay>
  )
}

// Модалка «Создать категорию» — 1-в-1 как в Discord.
export function CreateCategoryModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, priv: boolean) => void }) {
  const [name, setName] = useState('')
  const [priv, setPriv] = useState(false)
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
      <div className="modal-title" style={{ textAlign: 'left' }}>Создать категорию</div>
      <label className="modal-lbl">Название категории</label>
      <div className="cch-name">
        <Icon name="folder" size={16} />
        <input autoFocus placeholder="Новая категория" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim(), priv) }} />
      </div>
      <div className="cch-priv"><span>🔒</span> Приватная категория<button className={'tgl' + (priv ? ' on' : '')} onClick={() => setPriv(!priv)} /></div>
      <div className="cset-hint">Только выбранные участники и участники с выбранными ролями смогут просматривать эту категорию.</div>
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Отмена</button>
        <button className="modal-primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), priv)}>Создать категорию</button>
      </div>
    </Overlay>
  )
}
// Модалка «Присоединиться к серверу» — 1-в-1 как в Discord (v1.46.0).
export function JoinServerModal({ onClose, onBack, onDiscover, onJoin }:
  { onClose: () => void; onBack: () => void; onDiscover: () => void; onJoin: (code: string) => Promise<void> | void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  async function submit() {
    if (!code.trim() || busy) return
    setBusy(true)
    try { await onJoin(code.trim()) } finally { setBusy(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal jsm" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="jsm-head">
          <div className="modal-title">Присоединиться к серверу</div>
          <div className="modal-sub">Введите приглашение, чтобы присоединиться к существующему серверу.</div>
        </div>
        <label className="modal-lbl">Ссылка-приглашение <span className="csrv-req">*</span></label>
        <input className="modal-in" autoFocus placeholder="https://ponoiai.github.io/ponoi/hjk2m3np" value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        <div className="jsm-ex-t">Приглашения должны выглядеть так:</div>
        <div className="jsm-ex">
          <span>hjk2m3np</span>
          <span>https://ponoiai.github.io/ponoi/hjk2m3np</span>
        </div>
        <button className="jsm-disc" onClick={onDiscover}>
          <span className="jsm-disc-ic"><Icon name="compass" size={22} /></span>
          <span className="jsm-disc-tx">
            <b>Нет приглашения?</b>
            <span>Загляните в доступные для обнаружения сообщества в «Путешествии по серверам».</span>
          </span>
          <span className="jsm-disc-arr">›</span>
        </button>
        <div className="jsm-foot">
          <button className="modal-ghost" onClick={onBack}>Назад</button>
          <button className="modal-primary" disabled={!code.trim() || busy} onClick={submit}>Присоединиться к серверу</button>
        </div>
      </div>
    </div>
  )
}
