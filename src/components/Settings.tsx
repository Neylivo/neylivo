import { toastErr, toastOk } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../lib/settings'
import { fetchProfile, saveProfile, petKindOf, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { uploadTo } from '../lib/storage'
import { ProfilePet } from './ProfilePet'
import { Icon } from './icons'
import { comboFromEvent, isComboComplete } from '../lib/keybind'
import { loadChatBgPrefs, setChatBgPrefs, setChatBgPhoto, clearChatBgPhoto, getChatBgUrl } from '../lib/chatBg'

const CATS = [
  { k: 'account', label: 'Мой аккаунт' },
  { k: 'appearance', label: 'Внешний вид' },
  { k: 'chat', label: 'Чат' },
  { k: 'notifications', label: 'Уведомления' },
  { k: 'voice', label: 'Голос и видео' },
  { k: 'keybinds', label: 'Горячие клавиши' },
  { k: 'language', label: 'Язык' },
  { k: 'display', label: 'Дисплей' },
  { k: 'privacy', label: 'Конфиденциальность' },
  { k: 'activity', label: 'Активность' },
  { k: 'advanced', label: 'Дополнительно' },
] as const

const LANGS = [
  { id: 'ru', flag: '🇷🇺', name: 'Русский', sub: 'Russian' },
  { id: 'en', flag: '🇬🇧', name: 'English', sub: 'English' },
  { id: 'dolb', flag: '🤪', name: 'Долбоёбский', sub: 'на свой страх и риск' },
  { id: 'staro', flag: '📜', name: 'Старорусскій', sub: 'дореформенный' },
]

const FONTS = [
  { id: '', name: 'Системный' },
  { id: "'Inter', sans-serif", name: 'Inter' },
  { id: "'Roboto', sans-serif", name: 'Roboto' },
  { id: "'Open Sans', sans-serif", name: 'Open Sans' },
  { id: "'Georgia', serif", name: 'Georgia' },
  { id: "'JetBrains Mono', monospace", name: 'Моноширинный' },
  { id: "'Comic Sans MS', cursive", name: 'Comic Sans' },
]

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={'pqs-toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}><span /></button>
}
function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="pqs-optrow">
      <div><div className="pqs-optt">{title}</div>{desc && <div className="pqs-optd">{desc}</div>}</div>
      <div>{children}</div>
    </div>
  )
}

function KeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [cap, setCap] = useState(false)
  useEffect(() => {
    if (!cap) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      const combo = comboFromEvent(e)
      if (isComboComplete(combo)) { onChange(combo); setCap(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cap, onChange])
  return (
    <button className={'pqs-keycap' + (cap ? ' rec' : '')} onClick={() => setCap(c => !c)}>
      {cap ? 'Нажми клавиши…' : <span className="pqs-kbd">{value || '—'}</span>}
    </button>
  )
}


function ChatBgCard() {
  const [bg, setBg] = useState(loadChatBgPrefs())
  const [thumb, setThumb] = useState<string | null>(getChatBgUrl())
  const [busy, setBusy] = useState(false)
  const fRef = useRef<HTMLInputElement>(null)
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setBusy(true)
    try { setBg(await setChatBgPhoto(f)); setThumb(getChatBgUrl()) }
    catch (err: any) { toastErr(err?.message ?? String(err)) }
    finally { setBusy(false); if (fRef.current) fRef.current.value = '' }
  }
  return (
    <div className="pqs-acc-card2">
      <div className="pqs-sec-t">Фон чата</div>
      <Row title="Фоновое фото" desc="Поставить своё фото фоном чата (размытое, чтобы текст читался)">
        <Toggle on={bg.on} onChange={v => setBg(setChatBgPrefs({ on: v }))} />
      </Row>
      <div className="pqs-pet-pick">
        <div className="pqs-pet-thumb">{thumb ? <img src={thumb} alt="" /> : 'нет фото'}</div>
        <button className="pqs-code-copy" onClick={() => fRef.current?.click()}>{busy ? 'Загрузка…' : 'Выбрать фото'}</button>
        <button className="pqs-save" onClick={async () => { setBg(await clearChatBgPhoto()); setThumb(null) }}>Сбросить фон</button>
        <input ref={fRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>
      <Row title="Размытие" desc={bg.blur + ' px'}>
        <input type="range" min={0} max={30} value={bg.blur} onChange={e => setBg(setChatBgPrefs({ blur: Number(e.target.value) }))} />
      </Row>
      <Row title="Затемнение" desc={bg.tint + '%'}>
        <input type="range" min={0} max={80} value={bg.tint} onChange={e => setBg(setChatBgPrefs({ tint: Number(e.target.value) }))} />
      </Row>
    </div>
  )
}

export function Settings({ username, avatarUrl, onClose }:
  { username: string; avatarUrl?: string | null; onClose: () => void }) {
  const { user } = useAuth()
  const { settings, set, setCustom, accents, themes } = useSettings()
  const [cat, setCat] = useState<string>('account')
  const [name, setName] = useState(username)                 // ник (отображаемое имя) — свободный, может повторяться
  const [uname, setUname] = useState('')                      // юзернейм — уникальный, по нему добавляют в друзья
  const [nameChangedAt, setNameChangedAt] = useState<string | null>(null) // юзернейм меняется раз в 2 недели
  const [orig, setOrig] = useState({ name: username, uname: '', about: '', primary: DEFAULT_PROFILE.primary, accent: DEFAULT_PROFILE.accent }) // исходные значения — для плашки «несохранённые изменения»
  // v1.40.0: цвета профиля — тоже черновик: применяются только по «Сохранить изменения», как в Discord
  const [primary, setPrimary] = useState(DEFAULT_PROFILE.primary)
  const [accent, setAccent] = useState(DEFAULT_PROFILE.accent)
  const [prof, setProf] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const [about, setAbout] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)      // v1.42.0: идёт сохранение — кнопки заблокированы
  const [shake, setShake] = useState(false)    // v1.42.0: тряска плашки при попытке закрыть без сохранения
  const dirtyRef = useRef(false)
  const [petBusy, setPetBusy] = useState(false)
  const petRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    let ok = true
    fetchProfile(user.id).then(p => { if (ok) { setProf(p); setAbout(p.about); setPrimary(p.primary); setAccent(p.accent); setOrig(o => ({ ...o, about: p.about, primary: p.primary, accent: p.accent })) } })
    // v1.42.0: надёжная загрузка. Трёхступенчатый фолбэк по миграциям (сначала без
    // username_changed_at, потом без display_name), а если строки профиля нет совсем
    // или юзернейм пуст (сбой при регистрации) — чиним профиль сами. Поля не бывают пустыми.
    ;(async () => {
      let r: any = await supabase.from('profiles').select('username, display_name, username_changed_at').eq('id', user.id).maybeSingle()
      if (r.error) r = await supabase.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle()
      if (r.error) r = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
      let d: any = r.data
      if (!d?.username) {
        const fb = localStorage.getItem('ponoi_username') || (user.email ? user.email.split('@')[0] : '')
        if (fb) { await supabase.from('profiles').upsert({ id: user.id, username: fb }); d = { ...(d ?? {}), username: fb } }
      }
      if (!ok || !d) return
      const nick = d.display_name || d.username || ''
      setUname(d.username ?? ''); setName(nick)
      setNameChangedAt(d.username_changed_at ?? null)
      setOrig(o => ({ ...o, name: nick, uname: d.username ?? '' }))
    })()
    return () => { ok = false }
  }, [user])

  async function patchProf(patch: Partial<ProfilePrefs>) {
    setProf(p => ({ ...p, ...patch }))
    if (user) await saveProfile(user.id, patch)
  }
  async function pickPet(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !user) return
    setPetBusy(true)
    try {
      const url = await uploadTo('avatars', user.id, f)
      await patchProf({ petUrl: url, petKind: petKindOf(f), petOn: true })
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setPetBusy(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // v1.42.0: с несохранёнными изменениями настройки не закрываются — плашка трясётся (как в Discord)
      if (dirtyRef.current) { setShake(true); window.setTimeout(() => setShake(false), 600) }
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line
  }, [onClose])

  // v1.39.0: плашка «несохранённые изменения» — как в настройках сервера
  const dirty = name !== orig.name || uname !== orig.uname || about !== orig.about || primary !== orig.primary || accent !== orig.accent
  dirtyRef.current = dirty
  function resetAll() { setName(orig.name); setUname(orig.uname); setAbout(orig.about); setPrimary(orig.primary); setAccent(orig.accent) }
  // v1.42.0: закрытие с несохранёнными изменениями — только через «Сбросить» или «Сохранить»
  function tryClose() {
    if (dirty) { setShake(true); window.setTimeout(() => setShake(false), 600); return }
    onClose()
  }

  async function saveAccount() {
    if (busy) return
    setBusy(true)
    try {
    const newNick = name.trim()
    const newUname = uname.trim()
    if (newUname && newUname !== orig.uname) {
      // Юзернейм уникален и меняется не чаще раза в 2 недели (жёстко проверяется и в базе)
      const lockUntil = nameChangedAt ? new Date(nameChangedAt).getTime() + 14 * 86400000 : 0
      if (lockUntil > Date.now()) {
        const days = Math.max(1, Math.ceil((lockUntil - Date.now()) / 86400000))
        toastErr(`Юзернейм можно менять раз в 2 недели. Осталось дней: ${days}`)
        return
      }
      const { data: taken } = await supabase.rpc('username_taken', { uname: newUname })
      if (taken) { toastErr('Этот юзернейм уже занят'); return }
      const { error } = await supabase.from('profiles').update({ username: newUname }).eq('id', user!.id)
      if (error) {
        const m = String(error.message || '')
        toastErr(m.includes('username_change_too_soon') ? 'Юзернейм можно менять раз в 2 недели'
          : (m.includes('duplicate') || m.includes('unique')) ? 'Этот юзернейм уже занят' : m)
        return
      }
      setNameChangedAt(new Date().toISOString())
    }
    if (newNick !== orig.name) {
      // Ник (отображаемое имя) — свободный: меняется когда угодно, может совпадать у разных людей
      const { error } = await supabase.from('profiles').update({ display_name: newNick || null }).eq('id', user!.id)
      if (error) { toastErr(error.message ?? String(error)); return }
      localStorage.setItem('ponoi_username', newNick || newUname || username)
    }
    await patchProf({ about, primary, accent })
    const finalUname = newUname || orig.uname
    const finalNick = newNick || finalUname
    setName(finalNick); setUname(finalUname)
    setOrig({ name: finalNick, uname: finalUname, about, primary, accent })
    // Мгновенно обновляем имя во всём приложении (Home слушает это событие) — без перезагрузки.
    window.dispatchEvent(new CustomEvent('ponoi-profile-updated', { detail: { nick: newNick || newUname || username, handle: newUname || orig.uname } }))
    toastOk('Изменения сохранены')
    setSaved(true); setTimeout(() => setSaved(false), 1500)
    } finally { setBusy(false) }
  }

  return (
    <div className="pqs">
      <div className="pqs-sidebar">
        <div className="pqs-side-inner">
          <div className="pqs-side-h">Настройки пользователя</div>
          {CATS.map(c => (
            <div key={c.k} className={'pqs-cat' + (cat === c.k ? ' on' : '')} onClick={() => setCat(c.k)}>{c.label}</div>
          ))}
          <div className="pqs-cat danger" onClick={() => supabase.auth.signOut()}>Выйти</div>
        </div>
      </div>
      <div className="pqs-content">
        <button className="pqs-close" onClick={tryClose} title="Закрыть (Esc)"><Icon name="close" size={18} /><span>ESC</span></button>
        {dirty && <div className={'cset-savebar' + (shake ? ' shake' : '')} style={{ zIndex: 1000 }}>
          <span>Есть несохранённые изменения!</span>
          <button className="cset-reset" onClick={resetAll} disabled={busy}>Сбросить</button>
          <button className="cset-save" onClick={saveAccount} disabled={busy}>{busy ? 'Сохранение…' : saved ? 'Сохранено ✓' : 'Сохранить изменения'}</button>
        </div>}
        <div className="pqs-inner">
          {cat === 'account' && <>
            <h2>Мой аккаунт</h2>
            <div className="pqs-code-card">
              <div className="pqs-code-h">Юзернейм</div>
              <div className="pqs-code-sub">Поделись своим юзернеймом, чтобы тебя добавили в друзья.</div>
              <div className="pqs-code-row">
                <span className="pqs-code-val">{uname || username}</span>
                <span className="pqs-code-hint">твой юзернейм</span>
                <button className="pqs-code-copy" onClick={() => navigator.clipboard?.writeText(uname || username)}>Копировать</button>
              </div>
            </div>
            <div className="pqs-acc-card">
              <div className="pqs-acc-banner" style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
              <div className="pqs-acc-row">
                <div className="pqs-acc-av" style={{ background: settings.accent }}>
                  {avatarUrl ? <img src={avatarUrl} alt={username} /> : username.slice(0, 1).toUpperCase()}
                </div>
                <div className="pqs-acc-names">
                  <div className="pqs-acc-name">{name || username}</div>
                  <div className="pqs-acc-uname">{uname}</div>
                </div>
              </div>
            </div>
            <div className="pqs-acc-card2">
              <div className="pqs-sec-t">Тема профиля</div>
              <div className="pqs-code-sub">Два цвета твоей карточки профиля (баннер: основной → акцент). Применяется к мини- и большому профилю после «Сохранить изменения».</div>
              <div className="pqs-ptheme-row">
                <label className="pqs-ptheme"><input type="color" value={primary} onChange={e => setPrimary(e.target.value)} /> Основной цвет</label>
                <label className="pqs-ptheme"><input type="color" value={accent} onChange={e => setAccent(e.target.value)} /> Акцент</label>
              </div>
              <div className="pqs-ptheme-preview" style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
              <button className="pqs-save" onClick={() => { setPrimary('#5865f2'); setAccent('#5865f2') }}>Сбросить</button>
            </div>

            <div className="pqs-acc-card2">
              <div className="pqs-sec-t">Питомец профиля</div>
              <div className="pqs-code-sub">Маленький питомец в правом нижнем углу твоего профиля (мини и большого). Можно фото, GIF, видео или 3D-модель (.glb/.gltf). Ставить не обязательно.</div>
              <Row title="Показывать питомца" desc="Включи, чтобы поставить питомца на профиль">
                <Toggle on={prof.petOn} onChange={v => patchProf({ petOn: v })} />
              </Row>
              <div className="pqs-pet-pick">
                <div className="pqs-pet-thumb">{prof.petUrl ? (prof.petKind === 'video' ? <video src={prof.petUrl} muted /> : <img src={prof.petUrl} alt="" />) : '—'}</div>
                <button className="pqs-code-copy" onClick={() => petRef.current?.click()}>{petBusy ? 'Загрузка…' : 'Выбрать файл'}</button>
                <button className="pqs-save" onClick={() => patchProf({ petUrl: null, petKind: 'none', petOn: false })}>Убрать</button>
                <input ref={petRef} type="file" accept="image/*,video/*,.glb,.gltf" hidden onChange={pickPet} />
              </div>
              <div className="pqs-code-sub">Поддерживается: фото (PNG/JPG/WebP), GIF, видео (MP4/WebM — лучше короткое и зациклённое) и 3D-модель (.glb/.gltf — её можно вращать мышью).</div>
              <Row title="Размер" desc={prof.petSize + ' px'}>
                <input type="range" min={80} max={260} value={prof.petSize} onChange={e => patchProf({ petSize: Number(e.target.value) })} />
              </Row>
              <div className="pqs-lbl">Позиция</div>
              <div className="pqs-pet-pos">
                {([['above','Над кнопкой'],['br','Снизу справа'],['bl','Снизу слева'],['tr','Сверху справа'],['tl','Сверху слева'],['free','Свободно (тащи мышкой)']] as const).map(([k,l]) => (
                  <button key={k} className={'pqs-pet-posbtn' + (prof.petPos === k ? ' on' : '')} onClick={() => patchProf({ petPos: k })}>{l}</button>
                ))}
              </div>
              <div className="pqs-pet-previews">
                <div>
                  <div className="pqs-pet-plabel">Мини-профиль (1:1)</div>
                  <div className="pqs-pet-card mini" style={{ position: 'relative' }}>
                    <div className="pqs-pet-banner" style={{ background: `linear-gradient(90deg, ${prof.primary}, ${prof.accent})` }} />
                    <ProfilePet p={prof} scale={0.35} />
                  </div>
                </div>
                <div>
                  <div className="pqs-pet-plabel">Большой профиль (1:1)</div>
                  <div className="pqs-pet-card big" style={{ position: 'relative' }}>
                    <div className="pqs-pet-banner" style={{ background: `linear-gradient(90deg, ${prof.primary}, ${prof.accent})` }} />
                    <ProfilePet p={prof} scale={0.5} />
                  </div>
                </div>
              </div>
            </div>

            <label className="pqs-lbl">Ник (отображаемое имя)</label>
            <input className="pqs-in" value={name} onChange={e => setName(e.target.value)} placeholder="Как тебя видят другие" />
            <div className="pqs-code-sub" style={{ marginTop: 4 }}>Ник видят все в чатах и профиле. Он может совпадать у разных людей, менять можно когда угодно.</div>
            <label className="pqs-lbl">Юзернейм</label>
            <input className="pqs-in" value={uname} onChange={e => setUname(e.target.value)} />
            <div className="pqs-code-sub" style={{ marginTop: 4 }}>Юзернейм уникален — по нему тебя добавляют в друзья. Менять можно раз в 2 недели.</div>
            <label className="pqs-lbl">О себе</label>
            <textarea className="pqs-in" rows={3} value={about} onChange={e => setAbout(e.target.value)} placeholder="Расскажи о себе…" />
            <div className="pqs-email">
              <div className="pqs-lbl">Email</div>
              <div className="pqs-email-val">{(user?.email ?? '').replace(/^(.).*(@.*)$/, (_m, a, b) => a + '••••••' + b) || '••••••@••••.•••'}</div>
            </div>
          </>}

          {cat === 'appearance' && <>
            <h2>Внешний вид</h2>
            <ChatBgCard />

            <div className="pqs-custom">
              <div className="pqs-custom-h">Своя тема</div>
              <div className="pqs-custom-sub">Задай цвет на каждую поверхность — можно собрать Discord целиком. Всё применяется сразу.</div>
              {([
                ['dark', 'Тёмный фон'], ['content', 'Основной фон'], ['panel', 'Панель'],
                ['hover', 'Наведение'], ['active', 'Активный'], ['accent', 'Акцент'],
              ] as const).map(([k, label]) => (
                <div key={k} className="pqs-custom-row">
                  <span>{label}</span>
                  <input type="color" value={(settings.custom as any)[k]} onChange={e => setCustom({ [k]: e.target.value, on: true } as any)} />
                  <button className="pqs-custom-x" title="Сбросить поверхность" onClick={() => { const d = (settings.theme && themes.find(t => t.key === settings.theme)) || themes[0]; setCustom({ [k]: (d as any)[k] } as any) }}>✕</button>
                </div>
              ))}
              <div className="pqs-custom-row">
                <span>Затемнение текстур (читаемость)</span>
                <input type="range" min={0} max={100} value={settings.custom.dim} onChange={e => setCustom({ dim: Number(e.target.value) })} />
                <span className="pqs-custom-pct">{settings.custom.dim}%</span>
              </div>
              <div className="pqs-custom-foot">
                <label className="pqs-custom-toggle"><input type="checkbox" checked={settings.custom.on} onChange={e => setCustom({ on: e.target.checked })} /> Использовать свою тему</label>
                <button className="pqs-save" onClick={() => setCustom({ on: false })}>Сбросить</button>
              </div>
            </div>

            <div className="pqs-sec-t">Тема</div>
            <div className="pqs-preset-grid">
              {themes.map(t => (
                <button key={t.key} className={'pqs-preset' + (settings.theme === t.key && !settings.custom.on ? ' on' : '')}
                  onClick={() => { set('theme', t.key); set('accent', t.accent); setCustom({ on: false }) }}>
                  <span className="pqs-preset-sw" style={{ background: t.content, borderColor: t.accent }}>
                    <span style={{ background: t.accent }} />
                  </span>
                  <span className="pqs-preset-nm">{t.name}</span>
                </button>
              ))}
            </div>

            <Row title="Размер шрифта" desc={settings.fontPx + 'px'}>
              <input type="range" min={12} max={20} step={1} value={settings.fontPx} onChange={e => set('fontPx', Number(e.target.value))} />
            </Row>
            <Row title="Компактный режим" desc="Уменьшает отступы между сообщениями">
              <Toggle on={settings.compact} onChange={v => set('compact', v)} />
            </Row>
            <Row title="Анимации интерфейса" desc="Отключить для снижения нагрузки">
              <Toggle on={settings.animations} onChange={v => set('animations', v)} />
            </Row>
            <Row title="Автосмена темы" desc="Днём (8:00–20:00) — светлая тема, ночью — выбранная. По умолчанию выключено">
              <Toggle on={settings.autoTheme} onChange={v => set('autoTheme', v)} />
            </Row>

            <div className="pqs-sec-t">Шрифт и форма</div>
            <label className="pqs-lbl">Шрифт интерфейса</label>
            <select className="pqs-in" value={settings.fontFamily} onChange={e => set('fontFamily', e.target.value)}>
              {FONTS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <Row title="Скругление углов" desc={settings.radius + 'px'}>
              <input type="range" min={0} max={20} value={settings.radius} onChange={e => set('radius', Number(e.target.value))} />
            </Row>
            <Row title="Отступ между сообщениями" desc={settings.msgGap + 'px'}>
              <input type="range" min={0} max={24} value={settings.msgGap} onChange={e => set('msgGap', Number(e.target.value))} />
            </Row>
          </>}

          {cat === 'chat' && <>
            <h2>Чат</h2>
            <Row title="24-часовой формат времени" desc="Например, 14:30 вместо 2:30 PM">
              <Toggle on={settings.time24} onChange={v => set('time24', v)} />
            </Row>
            <Row title="Показывать аватары" desc="Аватар автора рядом с сообщением">
              <Toggle on={settings.showAvatars} onChange={v => set('showAvatars', v)} />
            </Row>
            <Row title="Группировать сообщения" desc="Объединять подряд идущие сообщения одного автора">
              <Toggle on={settings.groupMessages} onChange={v => set('groupMessages', v)} />
            </Row>
            <Row title="Крупные эмодзи" desc="Сообщения только из эмодзи показывать крупно">
              <Toggle on={settings.bigEmoji} onChange={v => set('bigEmoji', v)} />
            </Row>
            <div className="pqs-sec-t">Отправка сообщений</div>
            <div className="pqs-preset-grid">
              <button className={'pqs-preset' + (settings.sendKey === 'enter' ? ' on' : '')} onClick={() => set('sendKey', 'enter')}>
                <span className="pqs-preset-nm">Enter — отправить</span>
              </button>
              <button className={'pqs-preset' + (settings.sendKey === 'ctrl' ? ' on' : '')} onClick={() => set('sendKey', 'ctrl')}>
                <span className="pqs-preset-nm">Ctrl/⌘ + Enter — отправить</span>
              </button>
            </div>
          </>}

          {cat === 'notifications' && <>
            <h2>Уведомления</h2>
            <Row title="Системные уведомления"><Toggle on={settings.notifSystem} onChange={v => set('notifSystem', v)} /></Row>
            <Row title="Звуки уведомлений"><Toggle on={settings.notifSounds} onChange={v => set('notifSounds', v)} /></Row>
            <Row title="Упоминания" desc="Уведомлять только о @упоминаниях"><Toggle on={settings.mentionsOnly} onChange={v => set('mentionsOnly', v)} /></Row>
            <Row title="Счётчик на иконке" desc="Показывать количество непрочитанных"><Toggle on={settings.unreadBadge} onChange={v => set('unreadBadge', v)} /></Row>
          </>}

          {cat === 'voice' && <>
            <h2>Голос и видео</h2>
            <Row title="Громкость микрофона" desc={settings.micVol + '%'}>
              <input type="range" min={0} max={100} value={settings.micVol} onChange={e => set('micVol', Number(e.target.value))} />
            </Row>
            <Row title="Громкость динамика" desc={settings.spkVol + '%'}>
              <input type="range" min={0} max={100} value={settings.spkVol} onChange={e => set('spkVol', Number(e.target.value))} />
            </Row>
            <div className="pqs-note">Выбор устройств и обработка голоса применяются при звонке (LiveKit).</div>
          </>}

          {cat === 'keybinds' && <>
            <h2>Горячие клавиши</h2>
            <div className="pqs-sec-t">Настраиваемые</div>
            <Row title="Открыть Музыку" desc="Быстрый переход в Ponoi Music">
              <KeyCapture value={settings.keyMusic} onChange={v => set('keyMusic', v)} />
            </Row>
            <Row title="Открыть личные сообщения" desc="Быстрый переход на главный экран (ЛС)">
              <KeyCapture value={settings.keyHome} onChange={v => set('keyHome', v)} />
            </Row>
            <div className="pqs-sec-t">Саундпад</div>
            <Row title="Сохранить момент (15 сек)" desc="В звонке: сохранить последние 15 секунд разговора в саундпад">
              <KeyCapture value={settings.sbKey} onChange={v => set('sbKey', v)} />
            </Row>
            <div className="pqs-sec-t">Стандартные</div>
            <div className="pqs-keys">
              {[['Ctrl / ⌘ + K', 'Быстрый переход'], ['Enter', 'Отправить'], ['Shift + Enter', 'Новая строка'], ['Esc', 'Закрыть']].map(([k, d]) => (
                <div key={k} className="pqs-key"><span className="pqs-kbd">{k}</span><span>{d}</span></div>
              ))}
            </div>
          </>}

          {cat === 'language' && <>
            <h2>Язык</h2>
            <div className="pqs-code-sub">Перевод применяется сразу ко всему интерфейсу. English покрывает основные надписи, шуточные языки переводятся «на лету». Сообщения пользователей не переводятся.</div>
            <div className="pqs-langs">
              {LANGS.map(l => (
                <button key={l.id} className={'pqs-lang' + (settings.lang === l.id ? ' on' : '')} onClick={() => set('lang', l.id)}>
                  <span className="pqs-lang-flag">{l.flag}</span>
                  <span className="pqs-lang-name">{l.name}</span>
                  <span className="pqs-lang-sub">{l.sub}</span>
                  {settings.lang === l.id && <span className="pqs-lang-badge"><Icon name="check" size={14} /></span>}
                </button>
              ))}
            </div>
          </>}

          {cat === 'display' && <>
            <h2>Дисплей</h2>
            <Row title="Масштаб интерфейса" desc={settings.zoom + '%'}>
              <input type="range" min={70} max={130} step={5} value={settings.zoom} onChange={e => set('zoom', Number(e.target.value))} />
            </Row>
            <button className="pqs-save" onClick={() => set('zoom', 100)}>Сбросить масштаб</button>
          </>}

          {cat === 'privacy' && <>
            <h2>Конфиденциальность</h2>
            <Row title="ЛС от всех пользователей"><Toggle on={settings.dmAll} onChange={v => set('dmAll', v)} /></Row>
            <Row title="ЛС с участниками сервера"><Toggle on={settings.dmMembers} onChange={v => set('dmMembers', v)} /></Row>
            <Row title="Сбор данных об использовании" desc="Помогает улучшить приложение"><Toggle on={settings.dataCollect} onChange={v => set('dataCollect', v)} /></Row>
          </>}

          {cat === 'activity' && <>
            <h2>Активность</h2>
            <Row title="Своя активность" desc="Показывать пользовательский статус"><Toggle on={settings.actOn} onChange={v => set('actOn', v)} /></Row>
            {settings.actOn && <input className="pqs-in" value={settings.actText} onChange={e => set('actText', e.target.value)} placeholder="Например: Играет в Figma" />}
          </>}

          {cat === 'advanced' && <>
            <h2>Дополнительно</h2>
            <Row title="Режим разработчика" desc="Показывать ID и отладочную информацию"><Toggle on={settings.devmode} onChange={v => set('devmode', v)} /></Row>
            <button className="pqs-danger" onClick={async () => { if (await confirmUi('Очистить все локальные данные? Настройки, темы и локальные кэши будут сброшены.', { okText: 'Очистить' })) { localStorage.clear(); location.reload() } }}>Очистить все данные</button>
          </>}
        </div>
      </div>
    </div>
  )
}