
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../lib/settings'
import { friendCode } from '../lib/friendCode'

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
  { id: 'dolb', flag: '🤪', name: 'Долбёжка', sub: 'Meme' },
  { id: 'staro', flag: '📜', name: 'Старославянский', sub: 'Old Slavic' },
  { id: 'burm', flag: '🇲🇲', name: 'Бирманский', sub: 'Burmese' },
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

export function Settings({ username, avatarUrl, onClose }:
  { username: string; avatarUrl?: string | null; onClose: () => void }) {
  const { user } = useAuth()
  const { settings, set, accents } = useSettings()
  const [cat, setCat] = useState<string>('account')
  const [name, setName] = useState(username)
  const [about, setAbout] = useState(() => localStorage.getItem('ponoi_about_' + (user?.id ?? '')) || '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function saveAccount() {
    if (name.trim() && name !== username) await supabase.from('profiles').update({ username: name.trim() }).eq('id', user!.id)
    localStorage.setItem('ponoi_about_' + user!.id, about)
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
        <button className="pqs-close" onClick={onClose} title="Закрыть (Esc)">✕<span>ESC</span></button>
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
              <div className="pqs-acc-banner" style={{ background: `linear-gradient(90deg, ${settings.accent}, #eb459e)` }} />
              <div className="pqs-acc-row">
                <div className="pqs-acc-av" style={{ background: settings.accent }}>
                  {avatarUrl ? <img src={avatarUrl} alt={username} /> : username.slice(0, 1).toUpperCase()}
                </div>
                <div className="pqs-acc-name">{username}</div>
              </div>
            </div>
            <label className="pqs-lbl">Имя пользователя</label>
            <input className="pqs-in" value={name} onChange={e => setName(e.target.value)} />
            <label className="pqs-lbl">О себе</label>
            <textarea className="pqs-in" rows={3} value={about} onChange={e => setAbout(e.target.value)} placeholder="Расскажи о себе…" />
            <button className="pqs-save" onClick={saveAccount}>{saved ? 'Сохранено ✓' : 'Сохранить'}</button>
            <div className="pqs-email">
              <div className="pqs-lbl">Email</div>
              <div className="pqs-email-val">{(user?.email ?? '').replace(/^(.).*(@.*)$/, (_m, a, b) => a + '••••••' + b) || '••••••@••••.•••'}</div>
            </div>
          </>}

          {cat === 'appearance' && <>
            <h2>Внешний вид</h2>
            <Row title="Тема">
              <div className="pqs-themes">
                {(['dark', 'midnight', 'light'] as const).map(t => (
                  <button key={t} className={'pqs-theme ' + t + (settings.theme === t ? ' on' : '')} onClick={() => set('theme', t)}>
                    {t === 'dark' ? 'Тёмная' : t === 'midnight' ? 'Тёмная-тёмная' : 'Светлая'}
                  </button>
                ))}
              </div>
            </Row>
            <Row title="Акцентный цвет">
              <div className="pqs-accents">
                {accents.map(a => (
                  <button key={a} className={'pqs-acc-dot' + (settings.accent === a ? ' on' : '')} style={{ background: a }} onClick={() => set('accent', a)} />
                ))}
              </div>
            </Row>
            <Row title="Компактный режим" desc="Уменьшает отступы между сообщениями">
              <Toggle on={settings.compact} onChange={v => set('compact', v)} />
            </Row>
            <Row title="Размер шрифта" desc={Math.round(settings.fontScale * 100) + '%'}>
              <input type="range" min={85} max={130} value={settings.fontScale * 100} onChange={e => set('fontScale', Number(e.target.value) / 100)} />
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
          </>}

          {cat === 'language' && <>
            <h2>Язык</h2>
            <div className="pqs-langs">
              {LANGS.map(l => (
                <button key={l.id} className={'pqs-lang' + (settings.lang === l.id ? ' on' : '')} onClick={() => set('lang', l.id)}>
                  <span className="pqs-lang-flag">{l.flag}</span>
                  <span className="pqs-lang-name">{l.name}</span>
                  <span className="pqs-lang-sub">{l.sub}</span>
                  {settings.lang === l.id && <span className="pqs-lang-badge">✓</span>}
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
