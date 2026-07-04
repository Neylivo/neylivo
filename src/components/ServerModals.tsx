import { toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import type { Server } from '../types'
import { uploadTo } from '../lib/storage'
import { updateServer } from '../lib/servers'
import { notifModeOf, setNotifMode, NOTIF_LABEL, type NotifMode } from '../lib/srvNotify'
import { Icon } from './icons'

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

export function FindServerModal({ onClose, onFind }:
  { onClose: () => void; onFind: (q: string) => Promise<Server[]> }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Server[]>([])
  const [searched, setSearched] = useState(false)
  async function run(v: string) {
    setQ(v)
    if (!v.trim()) { setResults([]); setSearched(false); return }
    setResults(await onFind(v.trim())); setSearched(true)
  }
  return (
    <Overlay onClose={onClose}>
      <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
      <div className="modal-title">Найти сервер</div>
      <div className="modal-sub">По ID или названию</div>
      <input className="modal-in" autoFocus placeholder="ID или название сервера" value={q} onChange={e => run(e.target.value)} />
      <div className="modal-results">
        {searched && results.length === 0 && <div className="modal-empty">Ничего не найдено</div>}
        {results.map(s => (
          <div key={s.id} className="modal-result">{s.name}</div>
        ))}
      </div>
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Закрыть</button>
      </div>
    </Overlay>
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
  useEffect(() => {
    const h = () => onClose()
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [onClose])
  return (
    <div className="ctxmenu" style={{ left: x, top: y }} onClick={e => e.stopPropagation()}>
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

      {tab === 'roles' && <div className="modal-note">Роли и права: скоро. Сейчас владелец сервера управляет всем, участники — обычные.</div>}
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
  function pick(m: NotifMode) { setMode(m); setNotifMode(server.id, m) }
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
      <div className="modal-foot">
        <button className="modal-ghost" onClick={onClose}>Готово</button>
      </div>
    </Overlay>
  )
}


// Настройки конфиденциальности сервера — персональные, хранятся в localStorage (как в Discord).
export function ServerPrivacyModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const KEY = 'ponoi_privacy_' + server.id
  const [prefs, setPrefs] = useState<{ dm: boolean; activity: boolean }>(() => {
    try { return { dm: true, activity: true, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return { dm: true, activity: true } }
  })
  function save(p: { dm: boolean; activity: boolean }) { setPrefs(p); localStorage.setItem(KEY, JSON.stringify(p)) }
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
      <div className="cset-hint">Эти настройки применяются только к серверу «{server.name}» и хранятся на этом устройстве.</div>
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
