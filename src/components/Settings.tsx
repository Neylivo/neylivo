import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../lib/settings'
import { friendCode } from '../lib/friendCode'
import { fetchProfile, saveProfile, petKindOf, DEFAULT_PROFILE, type ProfilePrefs } from '../lib/profilePrefs'
import { uploadTo } from '../lib/storage'
import { ProfilePet } from './ProfilePet'
import { Icon } from './icons'
import { comboFromEvent, isComboComplete } from '../lib/keybind'

const CATS = [
  { k: 'account', label: 'Мой аккаунт' },
  { k: 'appearance', label: 'Внешний вид' },
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
  { id: 'burm', flag: '🐱', name: 'Бурмалды', sub: 'кошачий диалект' },
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

export function Settings({ username, avatarUrl, onClose }:
  { username: string; avatarUrl?: string | null; onClose: () => void }) {
  const { user } = useAuth()
  const { settings, set, setCustom, accents, themes } = useSettings()
  const [cat, setCat] = useState<string>('account')
  const [name, setName] = useState(username)
  const [prof, setProf] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const [about, setAbout] = useState('')
  const [saved, setSaved] = useState(false)
  const [petBusy, setPetBusy] = useState(false)
  const petRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    let ok = true
    fetchProfile(user.id).then(p => { if (ok) { setProf(p); setAbout(p.about) } })
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
    } catch (err: any) { alert(err.message ?? String(err)) }
    finally { setPetBusy(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function saveAccount() {
    if (name.trim() && name !== username) await supabase.from('profiles').update({ username: name.trim() }).eq('id', user!.id)
    await patchProf({ about })
    setSaved(true); setTimeout(() => setSaved(false), 1500)
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
        <button className="pqs-close" onClick={onClose} title="Закрыть (Esc)"><Icon name="close" size={18} /><span>ESC</span></button>
        <div className="pqs-inner">
          {cat === 'account' && <>
            <h2>Мой аккаунт</h2>
            <div className="pqs-code-card">
              <div className="pqs-code-h">Код друга</div>
              <div className="pqs-code-sub">Поделись своим кодом, чтобы тебя добавили в друзья.</div>
              <div className="pqs-code-row">
                <span className="pqs-code-val">{friendCode(username, user!.id)}</span>
                <span className="pqs-code-hint">твой код</span>
                <button className="pqs-code-copy" onClick={() => navigator.clipboard?.writeText(friendCode(username, user!.id))}>Копировать</button>
              </div>
            </div>
            <div className="pqs-acc-card">
              <div className="pqs-acc-banner" style={{ background: `linear-gradient(90deg, ${prof.primary}, ${prof.accent})` }} />
              <div className="pqs-acc-row">
                <div className="pqs-acc-av" style={{ background: settings.accent }}>
                  {avatarUrl ? <img src={avatarUrl} alt={username} /> : username.slice(0, 1).toUpperCase()}
                </div>
                <div className="pqs-acc-name">{username}</div>
              </div>
            </div>
            <div className="pqs-acc-card2">
              <div className="pqs-sec-t">Тема профиля</div>
              <div className="pqs-code-sub">Два цвета твоей карточки профиля (баннер: основной → акцент). Применяется к мини- и большому профилю.</div>
              <div className="pqs-ptheme-row">
                <label className="pqs-ptheme"><input type="color" value={prof.primary} onChange={e => patchProf({ primary: e.target.value })} /> Основной цвет</label>
                <label className="pqs-ptheme"><input type="color" value={prof.accent} onChange={e => patchProf({ accent: e.target.value })} /> Акцент</label>
              </div>
              <div className="pqs-ptheme-preview" style={{ background: `linear-gradient(90deg, ${prof.primary}, ${prof.accent})` }} />
              <button className="pqs-save" onClick={() => patchProf({ primary: '#5865f2', accent: '#5865f2' })}>Сбросить</button>
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

            <label className="pqs-lbl">Имя пользователя</label>
            <input className="pqs-in" value={name} onChange={e => setName(e.target.value)} />
            <label className="pqs-lbl">О себе</label>
            <textarea className="pqs-in" rows={3} value={about} onChange={e => setAbout(e.target.value)} placeholder="Расскажи о себе…" />
            <button className="pqs-save" onClick={saveAccount}>{saved ? <>Сохранено <Icon name="check" size={14} /></> : 'Сохранить'}</button>
            <div className="pqs-email">
              <div className="pqs-lbl">Email</div>
              <div className="pqs-email-val">{(user?.email ?? '').replace(/^(.).*(@.*)$/, (_m, a, b) => a + '••••••' + b) || '••••••@••••.•••'}</div>
            </div>
          </>}

          {cat === 'appearance' && <>
            <h2>Внешний вид</h2>

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
            <div className="pqs-keys">
              {[['Alt + J', 'Открыть ponAI'], ['Alt + M', 'Открыть Музыку'], ['Ctrl / ⌘ + K', 'Быстрый переход'], ['Enter', 'Отправить'], ['Shift + Enter', 'Новая строка'], ['Esc', 'Закрыть']].map(([k, d]) => (
                <div key={k} className="pqs-key"><span className="pqs-kbd">{k}</span><span>{d}</span></div>
              ))}
            </div>
            <div className="pqs-sec-t">Саундпад</div>
            <Row title="Сохранить момент (15 сек)" desc="В звонке: сохранить последние 15 секунд разговора в саундпад">
              <KeyCapture value={settings.sbKey} onChange={v => set('sbKey', v)} />
            </Row>
          </>}

          {cat === 'language' && <>
            <h2>Язык</h2>
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
            <button className="pqs-danger" onClick={() => { if (confirm('Очистить все локальные данные?')) { localStorage.clear(); location.reload() } }}>Очистить все данные</button>
          </>}
        </div>
      </div>
    </div>
  )
}