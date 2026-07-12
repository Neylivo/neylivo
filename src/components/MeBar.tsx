
import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo } from '../lib/storage'
import { AvatarWithStatus } from './AvatarWithStatus'
import { PlateBg } from './PlateBg'
import { fetchProfile, cachedProfile, nickFontOf } from '../lib/profilePrefs'
import { trimVideoTo5s } from '../lib/videoAvatar'
import { usePresence, STATUS_LABEL } from '../lib/presence'
import { ActivityLabel } from './ActivityLabel'
import { Settings } from './Settings'
import { MiniProfile } from './MiniProfile'
import { Icon } from './icons'
import { IS_MOBILE } from '../lib/mobile'

// Нижняя панель пользователя. Статус и активность вручную больше не ставятся:
// статус автоматический (в приложении — «В сети»), активность — только авто (игра/музыка).
export function MeBar({ username, avatarUrl, onAvatar }: { username: string; avatarUrl?: string | null; onAvatar?: (url: string) => void }) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // v1.95.0: «кубик» (nameplate) — фон/обводка своей панельки, живёт в profiles.
  const [plate, setPlate] = useState<{ url: string | null; kind: string; outline: string | null }>(() => {
    const c = cachedProfile(user?.id); return c ? { url: c.plateUrl, kind: c.plateKind, outline: c.plateOutline } : { url: null, kind: 'none', outline: null }
  })   // v1.142.0: «кубик» сразу из кэша — не мелькает
  const [nickFam, setNickFam] = useState<string | undefined>(() => { const c = cachedProfile(user?.id); return c ? nickFontOf(c) : undefined })  // v1.110.0: шрифт ника (v1.142.0: сразу из кэша)
  useEffect(() => {
    if (!user) return
    const load = () => { fetchProfile(user.id).then(p => { setPlate({ url: p.plateUrl, kind: p.plateKind, outline: p.plateOutline }); setNickFam(nickFontOf(p)) }) }
    load()
    const h = (e: Event) => { if ((e as CustomEvent).detail?.id === user.id) load() }
    window.addEventListener('ponoi-profile', h)
    return () => window.removeEventListener('ponoi-profile', h)
  }, [user?.id])
  const [micOff, setMicOff] = useState(false)
  const [deaf, setDeaf] = useState(false)
  // Микро-анимации (<=300мс): тряска микрофона при муте, «сжатие» наушников при дефе.
  const [micAnim, setMicAnim] = useState(false)
  const [deafAnim, setDeafAnim] = useState(false)

  // v1.43.0: в активном звонке кнопки управляют настоящим микрофоном/звуком.
  const [cst, setCst] = useState<{ mic: boolean; deaf: boolean; connected: boolean } | null>(null)
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setCst(d?.connected ? d : null) }
    window.addEventListener('ponoi-call-state', h)
    return () => window.removeEventListener('ponoi-call-state', h)
  }, [])
  const micIsOff = cst ? !cst.mic : micOff
  const deafIsOn = cst ? cst.deaf : deaf

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    let f = e.target.files?.[0]
    if (!f || !user) return
    setBusy(true)
    try {
      if (f.type.startsWith('video')) f = await trimVideoTo5s(f)   // видео-аватар: не длиннее 5 сек
      const url = await uploadTo('avatars', user.id, f)
      const { data, error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Не сохранилось — нет доступа к изменению профиля')
      onAvatar?.(url)
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  const { myStatus, activityOf, gameOf } = usePresence()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [miniOpen, setMiniOpen] = useState(false)   // свой мини-профиль над панелью (как в Discord)
  const meRef = useRef<HTMLDivElement>(null)   // v1.140.0: мерим панельку — мини-профиль открывается ровно над ней
  // v1.212.0: на телефоне тап по своей панельке открывает ПОЛНОЭКРАННЫЙ профиль
  // (ProfileCard) напрямую, как в мобильном Discord — маленький попап MiniProfile
  // на тачскрине неудобен. Слушает Home.tsx (см. ponoi-open-my-profile).
  const openMe = () => { if (IS_MOBILE) window.dispatchEvent(new CustomEvent('ponoi-open-my-profile')); else setMiniOpen(v => !v) }
  return (
    <div ref={meRef} className={'me' + (plate.outline ? ' plate-outline' : '')} style={plate.outline ? { ['--plate-oc' as any]: plate.outline } : undefined}>
      {plate.url && plate.kind !== 'none' && <PlateBg url={plate.url} kind={plate.kind} />}
      <span className="me-lift" onClick={openMe} title="Мой профиль" style={{ cursor: 'pointer' }}>
        <AvatarWithStatus name={username} url={avatarUrl} size={32} status={myStatus} mobile={IS_MOBILE} />
      </span>
      <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={pick} />
      <span className="me-nm me-lift" onClick={openMe} style={{ cursor: 'pointer', fontFamily: nickFam }} title="Мой профиль">
        {busy ? 'Загрузка…' : username}<br /><small className="mut">{(() => {
          // v1.125.0: игра в своей панельке — компактно, как в Discord: зелёный геймпад +
          // НАЗВАНИЕ ИГРЫ заглавными, без «Играет в», без режима и без таймера.
          const g = user ? gameOf(user.id) : null
          if (g) return <span className="me-game"><span className="mag-ico"><Icon name="gamepad" size={12} /></span><span className="me-game-nm">{g.name}</span></span>
          const a = user ? activityOf(user.id) : null
          return a ? <ActivityLabel activity={a} /> : STATUS_LABEL[myStatus]
        })()}</small>
      </span>
      <button className={'me-ic me-mic me-lift' + (micIsOff ? ' off' : '') + (micAnim ? ' anim-shake' : '')}
        onClick={() => { if (cst) { if (cst.mic) setMicAnim(true); window.dispatchEvent(new CustomEvent('ponoi-call-toggle', { detail: { what: 'mic' } })); return } setMicOff(m => { if (!m) setMicAnim(true); return !m }) }}
        onAnimationEnd={() => setMicAnim(false)}
        title="Микрофон">{micIsOff ? <Icon name="mic-off" size={18} /> : <Icon name="mic" size={18} />}</button>
      <button className={'me-ic me-deaf me-lift' + (deafIsOn ? ' off' : '') + (deafAnim ? ' anim-squeeze' : '')}
        onClick={() => { if (cst) { if (!cst.deaf) setDeafAnim(true); window.dispatchEvent(new CustomEvent('ponoi-call-toggle', { detail: { what: 'deaf' } })); return } setDeaf(d => { if (!d) setDeafAnim(true); return !d }) }}
        onAnimationEnd={() => setDeafAnim(false)}
        title="Звук">{deafIsOn ? <Icon name="headphones-off" size={18} /> : <Icon name="headphones" size={18} />}</button>
      <button className="me-out me-lift" onClick={() => setSettingsOpen(true)} title="Настройки пользователя"><Icon name="gear" size={18} /></button>
      {settingsOpen && <Settings username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} onClose={() => setSettingsOpen(false)} />}
      {miniOpen && user && <MiniProfile
        data={{ userId: user.id, name: username, avatarUrl, status: myStatus, anchor: 'me',
          x: meRef.current?.getBoundingClientRect().left ?? 8,
          y: meRef.current?.getBoundingClientRect().top ?? (window.innerHeight - 60) }}
        meControls onPickAvatar={() => fileRef.current?.click()}
        onClose={() => setMiniOpen(false)} />}
    </div>
  )
}
