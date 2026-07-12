import { toastErr, toastOk } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useSettings, type Settings as AppSettings, type CustomTheme } from '../lib/settings'
import { fetchProfile, saveProfile, petKindOf, DEFAULT_PROFILE, nickFontOf, msgFontOf, type ProfilePrefs } from '../lib/profilePrefs'
import { uploadTo } from '../lib/storage'
import { isVideoUrl, trimVideoTo5s } from '../lib/videoAvatar'
import { PlateBg } from './PlateBg'
import { ProfilePet } from './ProfilePet'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { comboFromEvent, isComboComplete } from '../lib/keybind'
import { loadChatBgPrefs, setChatBgPrefs, setChatBgPhoto, clearChatBgPhoto, getChatBgUrl } from '../lib/chatBg'
import { fileFontCoverage, urlFontCoverage } from '../lib/fontCoverage'
import { readFileAsDataUrl, DEFAULT_ICON_URL, MAX_ICON_BYTES } from '../lib/appIcon'
import { getUserPrefs, patchUserPrefs } from '../lib/userPrefs'
import { DevPortal } from './DevPortal'
import { IS_MOBILE } from '../lib/mobile'
import { listBlockedByMe, unblockUser, type BlockedEntry } from '../lib/block'

// v1.50.0: настройки 1-в-1 как в новом Discord — панель поверх приложения,
// слева сайдбар (карточка профиля, поиск, разделы с иконками и подпунктами),
// справа прокручиваемое содержимое секциями со строками «Изменить».
const NAV: { group: string | null; items: { k: string; label: string; icon: string; subs?: { k: string; label: string }[] }[] }[] = [
  { group: null, items: [
    { k: 'account', label: 'Учётная запись', icon: 'user', subs: [
      { k: 'acc-info', label: 'Информация об учётной записи' },
      { k: 'acc-security', label: 'Пароль и безопасность' },
    ] },
    { k: 'profile', label: 'Профиль', icon: 'edit' },
    { k: 'privacy', label: 'Данные и конфиденциальность', icon: 'shield' },
    { k: 'notifications', label: 'Уведомления', icon: 'bell' },
  ] },
  { group: 'Настройки приложения', items: [
    { k: 'appearance', label: 'Внешний вид', icon: 'image' },
    { k: 'chat', label: 'Чат', icon: 'message' },
    { k: 'voice', label: 'Голос и видео', icon: 'mic' },
    { k: 'sounds', label: 'Звуки', icon: 'volume' },
    { k: 'keybinds', label: 'Горячие клавиши', icon: 'zap' },
    { k: 'language', label: 'Язык', icon: 'compass' },
    { k: 'display', label: 'Дисплей', icon: 'expand' },
    { k: 'activity', label: 'Активность', icon: 'gamepad' },
    { k: 'advanced', label: 'Дополнительно', icon: 'gear' },
  ] },
  { group: 'Разработчикам', items: [
    { k: 'devportal', label: 'Мои приложения', icon: 'code' },
  ] },
]

const LANGS = [
  { id: 'ru', flag: '🇷🇺', name: 'Русский', sub: 'Russian' },
  { id: 'en', flag: '🇬🇧', name: 'English', sub: 'English' },
  { id: 'dolb', flag: '🤪', name: 'Долбоёбский', sub: 'на свой страх и риск' },
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

export function Settings({ username, avatarUrl, onClose, onAvatar }:
  { username: string; avatarUrl?: string | null; onClose: () => void; onAvatar?: (url: string) => void }) {
  const { user } = useAuth()
  const { settings, set, themes } = useSettings()
  // v1.63.0: черновик настроек приложения — изменения (масштаб, шрифт, тема и т.д.)
  // применяются НЕ мгновенно, а только после кнопки «Сохранить изменения».
  const [draft, setDraft] = useState<Partial<AppSettings>>({})
  const view: AppSettings = { ...settings, ...draft }
  function setD<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setDraft(d => {
      const nd: Partial<AppSettings> = { ...d, [k]: v }
      if (JSON.stringify(v) === JSON.stringify(settings[k])) delete nd[k] // вернули исходное — из черновика убираем
      return nd
    })
  }
  function setCustomD(patch: Partial<CustomTheme>) { setD('custom', { ...view.custom, ...patch }) }
  // v1.245.0: тот же черновик-паттерн — для настроек профиля без файлов (приватность
  // ЛС/звонков, видимость игровой статистики, Steam ID, вкл/выкл-размер-позиция
  // питомца, обводка «кубика», выбор встроенного шрифта). Сама ЗАГРУЗКА файла
  // (шрифт/фон/питомец) и тег сервера сознательно остаются мгновенными — см.
  // patchProf() ниже и комментарий v1.178.0 в ServerSettings.tsx: с ними уже
  // пробовали общий черновик и откатили, люди теряли загруженный файл, случайно
  // закрыв настройки без «Сохранить».
  const [profDraft, setProfDraft] = useState<Partial<ProfilePrefs>>({})
  function setProfD<K extends keyof ProfilePrefs>(k: K, v: ProfilePrefs[K]) {
    setProfDraft(d => {
      const nd: Partial<ProfilePrefs> = { ...d, [k]: v }
      if (JSON.stringify(v) === JSON.stringify(prof[k])) delete nd[k]
      return nd
    })
  }
  function setProfDPatch(patch: Partial<ProfilePrefs>) { for (const [k, v] of Object.entries(patch)) setProfD(k as keyof ProfilePrefs, v as any) }
  const [cat, setCat] = useState<string>('account')
  // v1.212.0: на телефоне настройки — одна панель за раз (как в мобильном
  // Discord), а не сжатый в 78vw сайдбар поверх контента. true — список
  // разделов на весь экран; false — открытый раздел на весь экран со стрелкой
  // назад. На десктопе не используется (там обе панели видны одновременно).
  const [mobNavOpen, setMobNavOpen] = useState(true)
  const [navQ, setNavQ] = useState('')                        // поиск по разделам в сайдбаре
  const [name, setName] = useState(username)                 // ник (отображаемое имя) — свободный, может повторяться
  const [uname, setUname] = useState('')                      // юзернейм — уникальный, по нему добавляют в друзья
  const [nameChangedAt, setNameChangedAt] = useState<string | null>(null) // юзернейм меняется раз в 2 недели
  const [orig, setOrig] = useState({ name: username, uname: '', about: '', primary: DEFAULT_PROFILE.primary, accent: DEFAULT_PROFILE.accent }) // исходные значения — для плашки «несохранённые изменения»
  const [primary, setPrimary] = useState(DEFAULT_PROFILE.primary)
  const [accent, setAccent] = useState(DEFAULT_PROFILE.accent)
  const [prof, setProf] = useState<ProfilePrefs>(DEFAULT_PROFILE)
  const profView: ProfilePrefs = { ...prof, ...profDraft }
  const [about, setAbout] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)      // идёт сохранение — кнопки заблокированы
  const [shake, setShake] = useState(false)    // тряска плашки при попытке закрыть без сохранения
  const [iconBusy, setIconBusy] = useState(false)   // v1.160.0: свой логотип приложения — идёт чтение файла
  const iconInputRef = useRef<HTMLInputElement>(null)
  const dirtyRef = useRef(false)
  const [petBusy, setPetBusy] = useState(false)
  const petRef = useRef<HTMLInputElement>(null)
  // v1.165.0: SteamID64 — привязка нужна только для статистики Dota 2 (OpenDota).
  // v1.220.0: перенесён из приватного user_prefs в публичный profiles (prof.steamId) —
  // иначе статистику Dota никто, кроме владельца, всё равно не смог бы посчитать.
  function saveSteamId(v: string) { setProfD('steamId', v.trim() || null) }
  // v1.166.0: свои звуки — уведомление о сообщении, рингтон входящего, гудки
  // исходящего. Приватная account-настройка (см. src/lib/userPrefs.ts), синхронизируется
  // на все устройства. Пусто — играет встроенный тон/мелодия (src/lib/notify.ts, callSounds.ts).
  const [notifSoundUrl, setNotifSoundUrl] = useState(() => getUserPrefs().account.notifSoundUrl || '')
  const [ringtoneUrl, setRingtoneUrl] = useState(() => getUserPrefs().account.ringtoneUrl || '')
  const [ringbackUrl, setRingbackUrl] = useState(() => getUserPrefs().account.ringbackUrl || '')
  const notifSoundRef = useRef<HTMLInputElement>(null)
  const ringtoneRef = useRef<HTMLInputElement>(null)
  const ringbackRef = useRef<HTMLInputElement>(null)
  const [soundBusy, setSoundBusy] = useState<string | null>(null)
  const SOUND_SET: Record<string, (v: string) => void> = { notifSoundUrl: setNotifSoundUrl, ringtoneUrl: setRingtoneUrl, ringbackUrl: setRingbackUrl }
  async function pickSound(key: 'notifSoundUrl' | 'ringtoneUrl' | 'ringbackUrl', e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !user) return
    setSoundBusy(key)
    try {
      const url = await uploadTo('attachments', user.id, f)
      patchUserPrefs({ account: { ...getUserPrefs().account, [key]: url } })
      SOUND_SET[key](url)
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setSoundBusy(null); e.target.value = '' }
  }
  function resetSound(key: 'notifSoundUrl' | 'ringtoneUrl' | 'ringbackUrl') {
    patchUserPrefs({ account: { ...getUserPrefs().account, [key]: '' } })
    SOUND_SET[key]('')
  }
  function previewSound(url: string) { try { new Audio(url).play().catch(() => {}) } catch {} }
  // v1.50.0: строки «Изменить» и смена почты/пароля как в Discord
  const [showEmail, setShowEmail] = useState(false)
  const [editNick, setEditNick] = useState(false)
  const [editUname, setEditUname] = useState(false)
  const [editEmail, setEditEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [editPw, setEditPw] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  // v1.246.0: список заблокированных — «Данные и конфиденциальность» внизу, как в
  // Discord. Раньше заблокировать можно было (ПКМ на друге), а посмотреть список
  // и разблокировать — нигде.
  const [blockedList, setBlockedList] = useState<BlockedEntry[] | null>(null)
  useEffect(() => {
    if (!user) return
    listBlockedByMe(user.id).then(setBlockedList)
    // v1.252.0: заблокировал/разблокировал с другого устройства — список тут тоже обновится.
    const h = () => listBlockedByMe(user.id).then(setBlockedList)
    window.addEventListener('ponoi-blocked', h)
    return () => window.removeEventListener('ponoi-blocked', h)
  }, [user])
  async function doUnblock(e: BlockedEntry) {
    if (!user) return
    await unblockUser(user.id, e.id)
    setBlockedList(l => (l ?? []).filter(x => x.id !== e.id))
    toastOk(e.username + ' разблокирован(а)')
  }

  useEffect(() => {
    if (!user) return
    let ok = true
    fetchProfile(user.id).then(p => { if (ok) { setProf(p); setAbout(p.about); setPrimary(p.primary); setAccent(p.accent); setOrig(o => ({ ...o, about: p.about, primary: p.primary, accent: p.accent })) } })
    // Надёжная загрузка: трёхступенчатый фолбэк по миграциям, починка пустого юзернейма.
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

  // v1.57.0: перетаскивание питомца в режиме «Свободно» — позиция ОДНА для всех
  // мест показа профиля: тащишь на любом превью — меняется везде одинаково.
  function moveFreePet(_card: 'mini' | 'big', pos: { x: number; y: number }, _done: boolean) {
    setProfDPatch({ petPos: 'free', petFree: pos })
  }

  async function patchProf(patch: Partial<ProfilePrefs>) {
    if (!user) return
    // v1.255.0: раньше локальное состояние обновлялось СРАЗУ, до ответа от базы —
    // если saveProfile падал (миграция не применена, RLS, сеть), интерфейс всё
    // равно показывал новое значение, а по факту ничего не сохранилось. Теперь
    // ждём успеха и только тогда трогаем prof/profDraft; ошибка letит наверх
    // вызывающему (try/catch с тостом — либо здесь в saveAccount, либо у самих
    // кнопок загрузки файлов, которые уже оборачивают patchProf в try/catch).
    await saveProfile(user.id, patch)
    setProf(p => ({ ...p, ...patch }))
    // v1.245.0: мгновенный коммит (файл/тег) главнее любого черновика по тем же
    // полям — иначе после загрузки нового файла в интерфейсе ещё маячило бы старое
    // отложенное значение поверх только что сохранённого.
    setProfDraft(d => { const nd = { ...d }; for (const k of Object.keys(patch)) delete nd[k as keyof ProfilePrefs]; return nd })
  }
  // v1.95.0: аватар фото/видео (<=5 сек) и «кубик» (nameplate) прямо из настроек
  const avRef = useRef<HTMLInputElement>(null)
  const [avBusy, setAvBusy] = useState(false)
  const [avUrl, setAvUrl] = useState<string | null | undefined>(avatarUrl)
  const plateRef = useRef<HTMLInputElement>(null)
  const [plateBusy, setPlateBusy] = useState(false)
  async function pickAv(e: React.ChangeEvent<HTMLInputElement>) {
    let f = e.target.files?.[0]; if (!f || !user) return
    setAvBusy(true)
    try {
      if (f.type.startsWith('video')) f = await trimVideoTo5s(f)   // видео-аватар: не длиннее 5 сек
      const url = await uploadTo('avatars', user.id, f)
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)
      setAvUrl(url); onAvatar?.(url)
      window.dispatchEvent(new CustomEvent('ponoi-profile', { detail: { id: user.id } }))
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setAvBusy(false) }
  }
  async function pickPlate(e: React.ChangeEvent<HTMLInputElement>) {
    let f = e.target.files?.[0]; if (!f || !user) return
    setPlateBusy(true)
    try {
      if (f.type.startsWith('video')) f = await trimVideoTo5s(f)   // фон-видео «кубика»: не длиннее 5 сек
      const url = await uploadTo('avatars', user.id, f)
      await patchProf({ plateUrl: url, plateKind: f.type.startsWith('video') ? 'video' : 'image' })
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setPlateBusy(false) }
  }
  // v1.160.0: свой логотип приложения — хранится локально (data URL прямо в
  // настройках), без загрузки в Supabase: это личная настройка устройства,
  // применяется сразу (не через «Сохранить»), как и остальные загрузки файлов.
  async function pickAppIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { toastErr('Нужен файл изображения'); return }
    if (f.size > MAX_ICON_BYTES) { toastErr('Файл слишком большой — максимум 2 МБ'); return }
    setIconBusy(true)
    try { set('appIcon', await readFileAsDataUrl(f)) }
    catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setIconBusy(false) }
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
  // v1.110.0: свой файл шрифта для ника (.ttf/.otf/.woff/.woff2)
  const fontRef = useRef<HTMLInputElement>(null)
  const [fontBusy, setFontBusy] = useState(false)
  async function pickFont(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !user) return
    setFontBusy(true)
    try {
      const cov = await fileFontCoverage(f)
      const url = await uploadTo('avatars', user.id, f)
      await patchProf({ nickFontUrl: url })
      if (cov && !cov.cyrillic && settings.lang !== 'en') toastErr('В этом шрифте нет русских букв — русский ник останется обычным шрифтом')
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setFontBusy(false); e.target.value = '' }
  }
  // v1.112.0: свой файл шрифта для сообщений (.ttf/.otf/.woff/.woff2)
  const msgFontRef = useRef<HTMLInputElement>(null)
  const [msgFontBusy, setMsgFontBusy] = useState(false)
  async function pickMsgFont(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !user) return
    setMsgFontBusy(true)
    try {
      const cov = await fileFontCoverage(f)
      const url = await uploadTo('avatars', user.id, f)
      await patchProf({ msgFontUrl: url })
      if (cov && !cov.cyrillic && settings.lang !== 'en') toastErr('В этом шрифте нет русских букв — русский текст останется обычным шрифтом')
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setMsgFontBusy(false); e.target.value = '' }
  }

  // v1.115.0: предупреждение, если в выбранном своём шрифте нет кириллицы —
  // иначе русский текст молча рендерится системным шрифтом и кажется, что
  // «шрифт не работает» (частая ситуация: декоративные шрифты только с латиницей).
  const [nickCyr, setNickCyr] = useState<boolean | null>(null)
  const [msgCyr, setMsgCyr] = useState<boolean | null>(null)
  // v1.166.0: свой файл шрифта интерфейса — как ник/сообщения, но применяется сразу
  // (не через черновик), тот же паттерн, что и «Загрузить свой логотип».
  const appFontRef = useRef<HTMLInputElement>(null)
  const [appFontBusy, setAppFontBusy] = useState(false)
  const [appFontCyr, setAppFontCyr] = useState<boolean | null>(null)
  async function pickAppFont(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !user) return
    setAppFontBusy(true)
    try {
      const cov = await fileFontCoverage(f)
      setAppFontCyr(cov ? cov.cyrillic : null)
      const url = await uploadTo('avatars', user.id, f)
      set('fontFamilyUrl', url)
      if (cov && !cov.cyrillic && settings.lang !== 'en') toastErr('В этом шрифте нет русских букв — интерфейс останется обычным шрифтом')
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setAppFontBusy(false); e.target.value = '' }
  }
  useEffect(() => {
    let ok = true
    if (prof.nickFontUrl) urlFontCoverage(prof.nickFontUrl).then(c => { if (ok) setNickCyr(c ? c.cyrillic : null) })
    else setNickCyr(null)
    if (prof.msgFontUrl) urlFontCoverage(prof.msgFontUrl).then(c => { if (ok) setMsgCyr(c ? c.cyrillic : null) })
    else setMsgCyr(null)
    return () => { ok = false }
  }, [prof.nickFontUrl, prof.msgFontUrl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (dirtyRef.current) { setShake(true); window.setTimeout(() => setShake(false), 600) }
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line
  }, [onClose])

  const dirty = name !== orig.name || uname !== orig.uname || about !== orig.about || primary !== orig.primary || accent !== orig.accent
    || Object.keys(draft).length > 0 || Object.keys(profDraft).length > 0
  dirtyRef.current = dirty
  function resetAll() { setName(orig.name); setUname(orig.uname); setAbout(orig.about); setPrimary(orig.primary); setAccent(orig.accent); setDraft({}); setProfDraft({}) }
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
      const { error } = await supabase.from('profiles').update({ display_name: newNick || null }).eq('id', user!.id)
      if (error) { toastErr(error.message ?? String(error)); return }
      localStorage.setItem('ponoi_username', newNick || newUname || username)
    }
    // v1.63.0/v1.245.0: отложенные настройки (оформление + профиль без файлов)
    // применяются только здесь, ПОСЛЕ всех проверок выше — если юзернейм занят
    // или ник/юзернейм ещё нельзя менять, saveAccount вышел бы раньше (return),
    // и черновики остались бы нетронутыми, а не сохранились бы частично.
    if (Object.keys(draft).length > 0) {
      for (const [k, v] of Object.entries(draft)) set(k as any, v as any)
      setDraft({})
    }
    await patchProf({ about, primary, accent, ...profDraft })
    setProfDraft({})
    const finalUname = newUname || orig.uname
    const finalNick = newNick || finalUname
    // v1.253.0: ник на серверах (server_members.member_name) раньше писался один раз
    // при вступлении и никогда не обновлялся при смене обычного ника — список
    // участников и автодополнение @упоминаний годами показывали старое имя. Обновляем
    // везде, КРОМЕ серверов, где явно выставлен свой ник для сервера (nickname_override,
    // см. «Изменить ник на сервере» в ServerView.tsx) — его трогать не нужно.
    if (finalNick !== orig.name && user) {
      supabase.from('server_members').update({ member_name: finalNick })
        .eq('user_id', user.id).eq('nickname_override', false)
        .then(({ error }) => { if (error) console.warn('member_name sync failed', error.message) })
    }
    setName(finalNick); setUname(finalUname)
    setOrig({ name: finalNick, uname: finalUname, about, primary, accent })
    window.dispatchEvent(new CustomEvent('ponoi-profile-updated', { detail: { nick: newNick || newUname || username, handle: newUname || orig.uname } }))
    toastOk('Изменения сохранены')
    setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (e: any) {
      // v1.255.0: раньше тут не было catch вообще — если patchProf/saveProfile
      // падал (например, миграция ещё не применена), ошибка улетала в никуда:
      // ни тоста, ни отката busy — плашка «Сохранение…» просто зависала.
      toastErr(e?.message ?? String(e))
    } finally { setBusy(false) }
  }

  async function changeEmail() {
    const e = newEmail.trim()
    if (!e || !user) return
    const { error } = await supabase.auth.updateUser({ email: e })
    if (error) toastErr(error.message)
    else { toastOk('Письмо с подтверждением отправлено на ' + e); setEditEmail(false); setNewEmail('') }
  }
  async function changePw() {
    if (pwBusy) return
    if (pw1.length < 6) { toastErr('Пароль должен быть не короче 6 символов'); return }
    if (pw1 !== pw2) { toastErr('Пароли не совпадают'); return }
    setPwBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 })
      if (error) toastErr(error.message)
      else { toastOk('Пароль изменён'); setEditPw(false); setPw1(''); setPw2('') }
    } finally { setPwBusy(false) }
  }

  function jumpTo(k: string) {
    setCat('account')
    window.setTimeout(() => document.getElementById('pqs2-' + k)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const emailMasked = (user?.email ?? '').replace(/^[^@]+/, '**********') || '—'
  const curLabel = NAV.flatMap(g => g.items).find(i => i.k === cat)?.label ?? 'Настройки'

  return (
    <div className="pqs2-overlay" onClick={tryClose}>
      <div className={'pqs2' + (IS_MOBILE ? (mobNavOpen ? ' mob-nav' : ' mob-content') : '')} onClick={e => e.stopPropagation()}>
        <div className="pqs2-head">
          {IS_MOBILE && !mobNavOpen && (
            <button className="pqs2-back" onClick={() => setMobNavOpen(true)} title="Назад"><Icon name="chevron-left" size={20} /></button>
          )}
          <div className="pqs2-head-t">{IS_MOBILE && mobNavOpen ? 'Настройки' : curLabel}</div>
          <button className="pqs2-x" onClick={tryClose} title="Закрыть (Esc)"><Icon name="close" size={18} /></button>
        </div>
        <div className="pqs2-body">
          <div className="pqs2-side">
            <div className="pqs2-me" onClick={() => { setCat('profile'); setMobNavOpen(false) }} title="Редактировать профиль">
              <div className="pqs2-me-av" style={{ background: view.accent }}>
                {avatarUrl ? <img src={avatarUrl} alt="" /> : (name || username).slice(0, 1).toUpperCase()}
              </div>
              <div className="pqs2-me-tx">
                <b>{name || username}</b>
                <span>Редактировать профиль… <Icon name="edit" size={11} /></span>
              </div>
            </div>
            <div className="pqs2-search">
              <Icon name="search" size={15} />
              <input placeholder="Поиск" value={navQ} onChange={e => setNavQ(e.target.value)} />
            </div>
            <div className="pqs2-nav">
              {NAV.map((g, gi) => {
                const items = g.items.filter(i => !navQ.trim() || i.label.toLowerCase().includes(navQ.trim().toLowerCase()))
                if (items.length === 0) return null
                return (
                  <div key={gi}>
                    {gi > 0 && <div className="pqs2-navsep" />}
                    {g.group && <div className="pqs2-grp">{g.group}</div>}
                    {items.map(i => (
                      <div key={i.k}>
                        <button className={'pqs2-item' + (cat === i.k ? ' on' : '')} onClick={() => { setCat(i.k); setMobNavOpen(false) }}>
                          <span className="pqs2-item-ic"><Icon name={i.icon} size={16} /></span>{i.label}
                          {IS_MOBILE && <Icon name="chevron-right" size={16} className="pqs2-item-chev" />}
                        </button>
                        {i.subs && cat === i.k && <div className="pqs2-subs">
                          {i.subs.map(s => (
                            <button key={s.k} className="pqs2-sub" onClick={() => { jumpTo(s.k); setMobNavOpen(false) }}>{s.label}</button>
                          ))}
                        </div>}
                      </div>
                    ))}
                  </div>
                )
              })}
              <div className="pqs2-navsep" />
              <button className="pqs2-item danger" onClick={() => supabase.auth.signOut()}>
                <span className="pqs2-item-ic"><Icon name="signout" size={16} /></span>Выйти
              </button>
            </div>
          </div>
          <div className="pqs2-main">
            <div className={'cset-savebar' + (dirty ? '' : ' bye') + (shake ? ' shake' : '')} style={{ zIndex: 1000 }}>
              <span>Есть несохранённые изменения!</span>
              <button className="cset-reset" onClick={resetAll} disabled={busy}>Сбросить</button>
              <button className="cset-save" onClick={saveAccount} disabled={busy}>{busy ? 'Сохранение…' : saved ? 'Сохранено ✓' : 'Сохранить изменения'}</button>
            </div>
            <div className="pqs2-inner">
              {cat === 'account' && <>
                <h2 id="pqs2-acc-info">Информация об учётной записи</h2>
                <div className="pqs2-desc">Твои основные данные: ник, юзернейм и почта. Нажми «Изменить» рядом с полем, чтобы его поменять.</div>
                <div className="pqs2-rows">
                  <div className="pqs2-row">
                    <div className="pqs2-row-k">Ник (отображаемое имя)</div>
                    <div className="pqs2-row-v">{name || '—'}</div>
                    <button className="pqs2-btn" onClick={() => setEditNick(v => !v)}>Изменить</button>
                  </div>
                  {editNick && <div className="pqs2-editbox">
                    <input className="pqs-in" value={name} onChange={e => setName(e.target.value)} placeholder="Как тебя видят другие" />
                    <div className="pqs2-hint">Ник видят все в чатах и профиле, он может совпадать у разных людей. Сохранение — плашкой внизу.</div>
                  </div>}
                  <div className="pqs2-row">
                    <div className="pqs2-row-k">Имя пользователя</div>
                    <div className="pqs2-row-v">{uname || username}</div>
                    <button className="pqs2-btn" onClick={() => setEditUname(v => !v)}>Изменить</button>
                  </div>
                  {editUname && <div className="pqs2-editbox">
                    <input className="pqs-in" value={uname} onChange={e => setUname(e.target.value)} />
                    <div className="pqs2-hint">Юзернейм уникален — по нему тебя добавляют в друзья. Менять можно раз в 2 недели. Сохранение — плашкой внизу.</div>
                  </div>}
                  <div className="pqs2-row">
                    <div className="pqs2-row-k">Электронная почта</div>
                    <div className="pqs2-row-v">{showEmail ? (user?.email ?? '—') : emailMasked}
                      <a className="pqs2-link" onClick={() => setShowEmail(s => !s)}>{showEmail ? 'Скрыть' : 'Показать'}</a>
                    </div>
                    <button className="pqs2-btn" onClick={() => setEditEmail(v => !v)}>Изменить</button>
                  </div>
                  {editEmail && <div className="pqs2-editbox">
                    <input className="pqs-in" placeholder="Новая электронная почта" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                    <div className="pqs2-editrow">
                      <button className="pqs2-btn primary" disabled={!newEmail.trim()} onClick={changeEmail}>Отправить подтверждение</button>
                      <button className="pqs2-btn ghost" onClick={() => setEditEmail(false)}>Отмена</button>
                    </div>
                    <div className="pqs2-hint">На новый адрес придёт письмо — почта сменится после подтверждения.</div>
                  </div>}
                </div>
                <div className="pqs2-divider" />
                <h2 id="pqs2-acc-security">Пароль и безопасность</h2>
                <div className="pqs2-desc">Смена пароля в пару кликов. Советуем длинный пароль, который ты не используешь на других сайтах.</div>
                <div className="pqs2-rows">
                  <div className="pqs2-row">
                    <div className="pqs2-row-k">Пароль</div>
                    <button className="pqs2-btn" onClick={() => setEditPw(v => !v)}>Изменить</button>
                  </div>
                  {editPw && <div className="pqs2-editbox">
                    <input className="pqs-in" type="password" placeholder="Новый пароль" value={pw1} onChange={e => setPw1(e.target.value)} />
                    <input className="pqs-in" type="password" placeholder="Повторите новый пароль" value={pw2} onChange={e => setPw2(e.target.value)} style={{ marginTop: 8 }} />
                    <div className="pqs2-editrow">
                      <button className="pqs2-btn primary" disabled={pwBusy || !pw1 || !pw2} onClick={changePw}>{pwBusy ? 'Сохранение…' : 'Сменить пароль'}</button>
                      <button className="pqs2-btn ghost" onClick={() => { setEditPw(false); setPw1(''); setPw2('') }}>Отмена</button>
                    </div>
                  </div>}
                </div>
              </>}

              {cat === 'profile' && <>
                <h2>Профиль</h2>
                <div className="pqs2-desc">Так тебя видят другие: аватар, цвета карточки, шрифты и питомец.</div>
                <div className="pqs-acc-card">
                  <div className="pqs-acc-banner" style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
                  <div className="pqs-acc-row">
                    <div className="pqs-acc-av" style={{ background: view.accent, cursor: 'pointer' }} onClick={() => avRef.current?.click()} title="Сменить аватар">
                      {avUrl
                        ? (isVideoUrl(avUrl)
                          ? <video src={avUrl} muted loop autoPlay playsInline onTimeUpdate={e => { const el = e.currentTarget; if (el.currentTime >= 5) el.currentTime = 0 }} />
                          : <img src={avUrl} alt={username} />)
                        : username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="pqs-acc-names">
                      <div className="pqs-acc-name" style={{ fontFamily: nickFontOf(profView) }}>{name || username}</div>
                      <div className="pqs-acc-uname">{uname}</div>
                    </div>
                    <button className="pqs2-btn primary" style={{ marginLeft: 'auto' }} onClick={() => avRef.current?.click()}>{avBusy ? 'Загрузка…' : 'Сменить аватар'}</button>
                    <input ref={avRef} type="file" accept="image/*,video/*" hidden onChange={pickAv} />
                  </div>
                  <div className="pqs-code-sub" style={{ margin: '0 16px 12px' }}>Аватар — фото или видео до 5 сек (длинное видео обрежется автоматически). Видео-аватар оживает при наведении мыши.</div>
                </div>
                <label className="pqs-lbl">О себе</label>
                <textarea className="pqs-in" rows={3} value={about} onChange={e => setAbout(e.target.value)} placeholder="Расскажи о себе…" />
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
                  <div className="pqs-sec-t">Шрифт ника</div>
                  <div className="pqs-code-sub">Твой ник — своим шрифтом: в чате, списке участников, мини-профиле, полном профиле и панельке внизу слева. Выбери из набора (сохраняется плашкой внизу) или загрузи свой файл шрифта (.ttf, .otf, .woff, .woff2) — файл сохраняется сразу. Видно всем.</div>
                  <div className="pqs-font-grid">
                    {FONTS.map(f => (
                      <button key={f.id || 'sys'} className={'pqs-font-btn' + (!profView.nickFontUrl && (profView.nickFont ?? '') === f.id ? ' on' : '')}
                        onClick={() => setProfDPatch({ nickFont: f.id, nickFontUrl: null })}>
                        <span className="pqs-font-sample" style={f.id ? { fontFamily: f.id } : undefined}>{name || username}</span>
                        <small>{f.name}</small>
                      </button>
                    ))}
                    <button className={'pqs-font-btn' + (profView.nickFontUrl ? ' on' : '')} onClick={() => fontRef.current?.click()}>
                      <span className="pqs-font-sample" style={profView.nickFontUrl ? { fontFamily: nickFontOf(profView) } : undefined}>{fontBusy ? 'Загрузка…' : (name || username)}</span>
                      <small>{profView.nickFontUrl ? 'Свой шрифт — заменить' : 'Загрузить свой (.ttf/.otf/.woff2)'}</small>
                    </button>
                  </div>
                  {settings.lang !== 'en' && profView.nickFontUrl && nickCyr === false && <div className="pqs-font-warn">⚠️ В этом шрифте нет русских букв — русский ник показывается обычным шрифтом. Латиница и цифры работают.</div>}
                  {profView.nickFontUrl && <button className="pqs2-btn ghost" style={{ marginTop: 10 }} onClick={() => patchProf({ nickFontUrl: null }).catch(e => toastErr(e?.message ?? String(e)))}>Убрать свой шрифт</button>}
                  <input ref={fontRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={pickFont} />
                </div>

                <div className="pqs-acc-card2">
                  <div className="pqs-sec-t">Шрифт сообщений</div>
                  <div className="pqs-code-sub">Шрифт, которым пишутся твои сообщения в чате. Видно всем — но каждый может выключить чужие шрифты у себя («Внешний вид» → «Чужие шрифты в чате»). Выбор из набора — плашкой внизу, свой файл — сразу.</div>
                  <div className="pqs-font-grid">
                    {FONTS.map(f => (
                      <button key={f.id || 'sys'} className={'pqs-font-btn' + (!profView.msgFontUrl && (profView.msgFont ?? '') === f.id ? ' on' : '')}
                        onClick={() => setProfDPatch({ msgFont: f.id, msgFontUrl: null })}>
                        <span className="pqs-font-sample" style={f.id ? { fontFamily: f.id } : undefined}>Привет! Hello 123</span>
                        <small>{f.name}</small>
                      </button>
                    ))}
                    <button className={'pqs-font-btn' + (profView.msgFontUrl ? ' on' : '')} onClick={() => msgFontRef.current?.click()}>
                      <span className="pqs-font-sample" style={profView.msgFontUrl ? { fontFamily: msgFontOf(profView) } : undefined}>{msgFontBusy ? 'Загрузка…' : 'Привет! Hello 123'}</span>
                      <small>{profView.msgFontUrl ? 'Свой шрифт — заменить' : 'Загрузить свой (.ttf/.otf/.woff2)'}</small>
                    </button>
                  </div>
                  {settings.lang !== 'en' && profView.msgFontUrl && msgCyr === false && <div className="pqs-font-warn">⚠️ В этом шрифте нет русских букв — русский текст показывается обычным шрифтом. Латиница и цифры работают.</div>}
                  {profView.msgFontUrl && <button className="pqs2-btn ghost" style={{ marginTop: 10 }} onClick={() => patchProf({ msgFontUrl: null }).catch(e => toastErr(e?.message ?? String(e)))}>Убрать свой шрифт</button>}
                  <input ref={msgFontRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={pickMsgFont} />
                </div>

                <div className="pqs-acc-card2">
                  <div className="pqs-sec-t">Кубик профиля</div>
                  <div className="pqs-code-sub">Оформи «кубик» с ником и аватаркой (панель внизу слева и твоя строка в списке участников): фон — фото или видео до 5 сек (крутится при наведении), и/или цветная обводка. Видно всем.</div>
                  <div className={'plate-prev' + (profView.plateOutline ? ' plate-outline' : '')} style={profView.plateOutline ? { ['--plate-oc' as any]: profView.plateOutline } : undefined}>
                    {profView.plateUrl && profView.plateKind !== 'none' && <PlateBg url={profView.plateUrl} kind={profView.plateKind} />}
                    <div className="pqs-acc-av" style={{ background: view.accent }}>
                      {avUrl ? (isVideoUrl(avUrl) ? <video src={avUrl} muted loop playsInline preload="metadata" /> : <img src={avUrl} alt="" />) : username.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="plate-prev-nm" style={{ fontFamily: nickFontOf(profView) }}>{name || username}</span>
                  </div>
                  <div className="pqs2-editrow" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                    <button className="pqs2-btn primary" onClick={() => plateRef.current?.click()}>{plateBusy ? 'Загрузка…' : (profView.plateUrl ? 'Заменить фон' : 'Фон: фото или видео')}</button>
                    {profView.plateUrl && <button className="pqs2-btn ghost" onClick={() => patchProf({ plateUrl: null, plateKind: 'none' }).catch(e => toastErr(e?.message ?? String(e)))}>Убрать фон</button>}
                    <label className="pqs-ptheme"><input type="color" value={profView.plateOutline ?? '#5865f2'} onChange={e => setProfD('plateOutline', e.target.value)} /> Обводка</label>
                    {profView.plateOutline && <button className="pqs2-btn ghost" onClick={() => setProfD('plateOutline', null)}>Убрать обводку</button>}
                  </div>
                  <input ref={plateRef} type="file" accept="image/*,video/*" hidden onChange={pickPlate} />
                </div>

                <div className="pqs-acc-card2 pet2">
                  <div className="pet2-head">
                    <div>
                      <div className="pqs-sec-t" style={{ margin: 0 }}>Питомец профиля</div>
                      <div className="pet2-sub">Маленький питомец живёт в углу твоей карточки профиля. Фото, GIF, видео или 3D-модель — ставить не обязательно.</div>
                    </div>
                    <Toggle on={profView.petOn} onChange={v => setProfD('petOn', v)} />
                  </div>
                  {profView.petOn && <div className="pet2-body">
                    <div className="pet2-pickrow">
                      <button className="pet2-thumb" title="Выбрать файл" onClick={() => petRef.current?.click()}>
                        {profView.petUrl
                          ? (profView.petKind === 'video' ? <video src={profView.petUrl} muted autoPlay loop /> : <img src={profView.petUrl} alt="" />)
                          : <span className="pet2-thumb-empty"><Icon name="paw" size={22} /><em>Выбрать</em></span>}
                      </button>
                      <div className="pet2-pickinfo">
                        <div className="pet2-pickbtns">
                          <button className="pqs2-btn primary" onClick={() => petRef.current?.click()}>{petBusy ? 'Загрузка…' : (profView.petUrl ? 'Заменить файл' : 'Выбрать файл')}</button>
                          {profView.petUrl && <button className="pqs2-btn ghost" onClick={() => patchProf({ petUrl: null, petKind: 'none' }).catch(e => toastErr(e?.message ?? String(e)))}>Убрать</button>}
                        </div>
                        <div className="pet2-formats">PNG · JPG · WebP · GIF · видео MP4/WebM (короткое и зациклённое) · 3D-модель .glb/.gltf (можно вращать мышью)</div>
                      </div>
                      <input ref={petRef} type="file" accept="image/*,video/*,.glb,.gltf" hidden onChange={pickPet} />
                    </div>
                    <Row title="Размер" desc={profView.petSize + ' px'}>
                      <input type="range" min={80} max={260} value={profView.petSize} onChange={e => setProfD('petSize', Number(e.target.value))} />
                    </Row>
                    <div className="pqs-lbl">Позиция</div>
                    <div className="pqs-pet-pos">
                      {([['above','Над кнопкой'],['br','Снизу справа'],['bl','Снизу слева'],['tr','Сверху справа'],['tl','Сверху слева'],['free','Свободно (тащи мышкой)']] as const).map(([k,l]) => (
                        <button key={k} className={'pqs-pet-posbtn' + (profView.petPos === k ? ' on' : '')} onClick={() => setProfD('petPos', k)}>{l}</button>
                      ))}
                    </div>
                    {profView.petPos === 'free' && <div className="pet2-freehint">Перетащи питомца на любом превью — позиция одна для всех мест: и в мини-профиле, и в полном, при любом их размере и положении. Сохраняется плашкой внизу.</div>}
                    <div className="pqs-lbl">Реакция на клик</div>
                    <div className="pet2-sub" style={{ marginBottom: 8 }}>Кликни по питомцу где угодно (в чате, профиле) — он отреагирует. Попробуй прямо в превью ниже.</div>
                    <div className="pqs-pet-pos">
                      {([['bounce','Прыжок'],['spin','Кручение'],['pulse','Пульс'],['burst','Эмодзи-всплеск'],['none','Не реагирует']] as const).map(([k,l]) => (
                        <button key={k} className={'pqs-pet-posbtn' + (profView.petReaction === k ? ' on' : '')} onClick={() => setProfD('petReaction', k)}>{l}</button>
                      ))}
                    </div>
                    <div className="pqs-lbl">Предпросмотр</div>
                    <div className="pet2-previews">
                      <div className="pet2-pv mini">
                        <span className="pet2-pv-tag">Мини-профиль</span>
                        <div className="pet2-pv-banner" style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
                        <div className="pet2-pv-av" style={{ background: view.accent }}>
                          {avatarUrl ? <img src={avatarUrl} alt="" /> : (name || username).slice(0, 1).toUpperCase()}
                          <span className="pet2-pv-dot" />
                        </div>
                        <div className="pet2-pv-body">
                          <b>{name || username}</b>
                          <span className="pet2-pv-un">{uname || username}</span>
                          {about.trim() && <p className="pet2-pv-about">{about.trim().slice(0, 80)}</p>}
                          <div className="pet2-pv-btn">Сообщение</div>
                        </div>
                        <ProfilePet p={profView} scale={0.35} card="mini" bannerH={64} onFreeMove={moveFreePet} />
                      </div>
                      <div className="pet2-pv big">
                        <span className="pet2-pv-tag">Большой профиль</span>
                        <div className="pet2-pv-banner" style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
                        <div className="pet2-pv-av" style={{ background: view.accent }}>
                          {avatarUrl ? <img src={avatarUrl} alt="" /> : (name || username).slice(0, 1).toUpperCase()}
                          <span className="pet2-pv-dot" />
                        </div>
                        <div className="pet2-pv-body">
                          <b>{name || username}</b>
                          <span className="pet2-pv-un">{uname || username}</span>
                          {about.trim() && <p className="pet2-pv-about">{about.trim().slice(0, 140)}</p>}
                          <div className="pet2-pv-btn">Сообщение</div>
                        </div>
                        <ProfilePet p={profView} scale={0.5} card="big" bannerH={88} onFreeMove={moveFreePet} />
                      </div>
                    </div>
                  </div>}
                </div>
              </>}

              {cat === 'appearance' && <>
                <h2>Внешний вид</h2>
                <div className="pqs2-desc">Темы и оформление приложения. Выбери готовую тему — или собери свою из любых цветов.</div>
                <ChatBgCard />

                <div className="pqs-custom">
                  <div className="pqs-custom-h">Своя тема</div>
                  <div className="pqs-custom-sub">Задай цвет на каждую поверхность — можно собрать Discord целиком. Применится после кнопки «Сохранить».</div>
                  {([
                    ['dark', 'Тёмный фон'], ['content', 'Основной фон'], ['panel', 'Панель'],
                    ['hover', 'Наведение'], ['active', 'Активный'], ['accent', 'Акцент'],
                  ] as const).map(([k, label]) => (
                    <div key={k} className="pqs-custom-row">
                      <span>{label}</span>
                      <input type="color" value={(view.custom as any)[k]} onChange={e => setCustomD({ [k]: e.target.value, on: true } as any)} />
                      <button className="pqs-custom-x" title="Сбросить поверхность" onClick={() => { const d = (view.theme && themes.find(t => t.key === view.theme)) || themes[0]; setCustomD({ [k]: (d as any)[k] } as any) }}>✕</button>
                    </div>
                  ))}
                  <div className="pqs-custom-row">
                    <span>Затемнение текстур (читаемость)</span>
                    <input type="range" min={0} max={100} value={view.custom.dim} onChange={e => setCustomD({ dim: Number(e.target.value) })} />
                    <span className="pqs-custom-pct">{view.custom.dim}%</span>
                  </div>
                  <div className="pqs-custom-foot">
                    <label className="pqs-custom-toggle"><input type="checkbox" checked={view.custom.on} onChange={e => setCustomD({ on: e.target.checked })} /> Использовать свою тему</label>
                    <button className="pqs-save" onClick={() => setCustomD({ on: false })}>Сбросить</button>
                  </div>
                </div>

                <div className="pqs-sec-t">Тема</div>
                <div className="pqs-preset-grid">
                  {themes.map(t => (
                    <button key={t.key} className={'pqs-preset' + (view.theme === t.key && !view.custom.on ? ' on' : '')}
                      onClick={() => { setD('theme', t.key); setD('accent', t.accent); if (view.custom.on) setD('custom', { ...view.custom, on: false }) }}>
                      <span className="pqs-preset-sw" style={{ background: t.content, borderColor: t.accent }}>
                        <span style={{ background: t.accent }} />
                      </span>
                      <span className="pqs-preset-nm">{t.name}</span>
                    </button>
                  ))}
                </div>

                <div className="pqs-sec-t">Логотип приложения</div>
                <div className="pqs2-desc" style={{ marginTop: -6 }}>Свой логотип вместо стандартного — меняется везде: в панели серверов, на экране загрузки{(window as any).ponoiDesktop?.isDesktop ? ', и в панели задач Windows' : ''}.</div>
                <div className="pqs-iconrow">
                  <span className="pqs-iconprev"><img src={settings.appIcon || DEFAULT_ICON_URL} alt="" width={40} height={40} /></span>
                  <button className="modal-primary" onClick={() => iconInputRef.current?.click()}>{iconBusy ? 'Загрузка…' : 'Загрузить свой логотип'}</button>
                  {settings.appIcon && <button className="pqs2-btn ghost" onClick={() => set('appIcon', '')}>Сбросить</button>}
                  <input ref={iconInputRef} type="file" accept="image/*" hidden onChange={pickAppIcon} />
                </div>
                <div className="cset-hint" style={{ marginTop: 6 }}>PNG, JPG или SVG, до 2 МБ.</div>

                <Row title="Размер шрифта" desc={view.fontPx + 'px'}>
                  <input type="range" min={12} max={20} step={1} value={view.fontPx} onChange={e => setD('fontPx', Number(e.target.value))} />
                </Row>
                <Row title="Компактный режим" desc="Уменьшает отступы между сообщениями">
                  <Toggle on={view.compact} onChange={v => setD('compact', v)} />
                </Row>
                <Row title="Анимации интерфейса" desc="Отключить для снижения нагрузки">
                  <Toggle on={view.animations} onChange={v => setD('animations', v)} />
                </Row>
                <Row title="Автосмена темы" desc="Днём (8:00–20:00) — светлая тема, ночью — выбранная. По умолчанию выключено">
                  <Toggle on={view.autoTheme} onChange={v => setD('autoTheme', v)} />
                </Row>

                <div className="pqs-sec-t">Шрифт и форма</div>
                <label className="pqs-lbl">Шрифт интерфейса</label>
                <div className="pqs-code-sub">Меняет все надписи приложения: настройки, меню, панели. Видно только тебе. Ник и текст сообщений в чате не меняет — за них отвечают «Шрифт ника» и «Шрифт сообщений» в «Профиле» (их видят все).</div>
                <select className="pqs-in" value={view.fontFamily} onChange={e => { set('fontFamily', e.target.value); if (settings.fontFamilyUrl) set('fontFamilyUrl', '') }}>
                  {FONTS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <div className="pqs-iconrow" style={{ marginTop: 8 }}>
                  <button className="modal-primary" onClick={() => appFontRef.current?.click()}>{appFontBusy ? 'Загрузка…' : (settings.fontFamilyUrl ? 'Свой шрифт — заменить' : 'Загрузить свой шрифт (.ttf/.otf/.woff2)')}</button>
                  {settings.fontFamilyUrl && <button className="pqs2-btn ghost" onClick={() => set('fontFamilyUrl', '')}>Сбросить</button>}
                  <input ref={appFontRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={pickAppFont} />
                </div>
                {settings.lang !== 'en' && settings.fontFamilyUrl && appFontCyr === false && <div className="pqs-font-warn">⚠️ В этом шрифте нет русских букв — интерфейс останется обычным шрифтом.</div>}
                <Row title="Скругление углов" desc={view.radius + 'px'}>
                  <input type="range" min={0} max={20} value={view.radius} onChange={e => setD('radius', Number(e.target.value))} />
                </Row>
                <Row title="Отступ между сообщениями" desc={view.msgGap + 'px'}>
                  <input type="range" min={0} max={24} value={view.msgGap} onChange={e => setD('msgGap', Number(e.target.value))} />
                </Row>
              </>}

              {cat === 'chat' && <>
                <h2>Чат</h2>
                <div className="pqs2-desc">Как выглядят и отправляются сообщения: формат времени, аватары, эмодзи и клавиша отправки.</div>
                <Row title="24-часовой формат времени" desc="Например, 14:30 вместо 2:30 PM">
                  <Toggle on={view.time24} onChange={v => setD('time24', v)} />
                </Row>
                <Row title="Показывать аватары" desc="Аватар автора рядом с сообщением">
                  <Toggle on={view.showAvatars} onChange={v => setD('showAvatars', v)} />
                </Row>
                <Row title="Группировать сообщения" desc="Объединять подряд идущие сообщения одного автора">
                  <Toggle on={view.groupMessages} onChange={v => setD('groupMessages', v)} />
                </Row>
                <Row title="Крупные эмодзи" desc="Сообщения только из эмодзи показывать крупно">
                  <Toggle on={view.bigEmoji} onChange={v => setD('bigEmoji', v)} />
                </Row>
                <Row title="Чужие шрифты в чате" desc="Показывать шрифты ника и сообщений других пользователей">
                  <Toggle on={view.otherFonts} onChange={v => setD('otherFonts', v)} />
                </Row>
                <div className="pqs-sec-t">Отправка сообщений</div>
                <div className="pqs-preset-grid">
                  <button className={'pqs-preset' + (view.sendKey === 'enter' ? ' on' : '')} onClick={() => setD('sendKey', 'enter')}>
                    <span className="pqs-preset-nm">Enter — отправить</span>
                  </button>
                  <button className={'pqs-preset' + (view.sendKey === 'ctrl' ? ' on' : '')} onClick={() => setD('sendKey', 'ctrl')}>
                    <span className="pqs-preset-nm">Ctrl/⌘ + Enter — отправить</span>
                  </button>
                </div>
              </>}

              {cat === 'notifications' && <>
                <h2>Уведомления</h2>
                <div className="pqs2-desc">Какие события присылают уведомления и нужен ли звук.</div>
                <Row title="Системные уведомления"><Toggle on={view.notifSystem} onChange={v => setD('notifSystem', v)} /></Row>
                <Row title="Звуки уведомлений"><Toggle on={view.notifSounds} onChange={v => setD('notifSounds', v)} /></Row>
                <Row title="Упоминания" desc="Уведомлять только о @упоминаниях"><Toggle on={view.mentionsOnly} onChange={v => setD('mentionsOnly', v)} /></Row>
                <Row title="Счётчик на иконке" desc="Показывать количество непрочитанных"><Toggle on={view.unreadBadge} onChange={v => setD('unreadBadge', v)} /></Row>

                <div className="pqs-sec-t">Новые серверы</div>
                <div className="pqs2-desc">Режим уведомлений, с которым открывается сервер, на котором ты ещё ничего не выбирал(а) вручную. Уже настроенные серверы это не трогает.</div>
                <div className="pqs-seg">
                  {([['all', 'Все сообщения'], ['mentions', 'Только @упоминания'], ['mute', 'Без уведомлений']] as const).map(([v, label]) => (
                    <button key={v} className={'pqs-seg-btn' + (view.defaultServerNotif === v ? ' on' : '')}
                      onClick={() => setD('defaultServerNotif', v)}>{label}</button>
                  ))}
                </div>
              </>}

              {cat === 'voice' && <>
                <h2>Голос и видео</h2>
                <div className="pqs2-desc">Громкость микрофона и динамиков в звонках.</div>
                <Row title="Громкость микрофона" desc={view.micVol + '%'}>
                  <input type="range" min={0} max={100} value={view.micVol} onChange={e => setD('micVol', Number(e.target.value))} />
                </Row>
                <Row title="Громкость динамика" desc={view.spkVol + '%'}>
                  <input type="range" min={0} max={100} value={view.spkVol} onChange={e => setD('spkVol', Number(e.target.value))} />
                </Row>
                <div className="pqs-note">Выбор устройств и обработка голоса применяются при звонке (LiveKit).</div>

                <div className="pqs-sec-t">Режим ввода</div>
                <Row title="Голос по нажатию (push-to-talk)" desc="Микрофон говорит, только пока зажата клавиша — вместо обычного вкл/выкл">
                  <Toggle on={view.pttMode} onChange={v => setD('pttMode', v)} />
                </Row>
                {view.pttMode && <Row title="Клавиша" desc="Зажми во время звонка, чтобы говорить">
                  <KeyCapture value={view.keyPTT} onChange={v => setD('keyPTT', v)} />
                </Row>}
                {view.pttMode && !view.keyPTT && <div className="pqs-font-warn">⚠️ Клавиша не назначена — микрофон останется выключенным весь звонок.</div>}
              </>}

              {cat === 'sounds' && <>
                <h2>Звуки</h2>
                <div className="pqs2-desc">Замени встроенные тоны своими файлами — везде, где играет звук приложения. Пусто — играет обычный тон.</div>
                {([
                  { key: 'notifSoundUrl' as const, title: 'Звук уведомления', desc: 'Входящее сообщение', url: notifSoundUrl, ref: notifSoundRef },
                  { key: 'ringtoneUrl' as const, title: 'Рингтон', desc: 'Входящий звонок', url: ringtoneUrl, ref: ringtoneRef },
                  { key: 'ringbackUrl' as const, title: 'Гудки', desc: 'Исходящий звонок (пока не ответили)', url: ringbackUrl, ref: ringbackRef },
                ]).map(s => (
                  <div className="pqs-acc-card2" key={s.key}>
                    <div className="pqs-sec-t">{s.title}</div>
                    <div className="pqs-code-sub">{s.desc}</div>
                    <div className="pqs-iconrow">
                      <button className="modal-primary" onClick={() => s.ref.current?.click()}>
                        {soundBusy === s.key ? 'Загрузка…' : (s.url ? 'Заменить файл' : 'Загрузить свой файл')}
                      </button>
                      {s.url && <button className="pqs2-btn ghost" onClick={() => previewSound(s.url)}>Прослушать</button>}
                      {s.url && <button className="pqs2-btn ghost" onClick={() => resetSound(s.key)}>Сбросить</button>}
                      <input ref={s.ref} type="file" accept="audio/*" hidden onChange={e => pickSound(s.key, e)} />
                    </div>
                  </div>
                ))}
              </>}

              {cat === 'keybinds' && <>
                <h2>Горячие клавиши</h2>
                <div className="pqs2-desc">Быстрые действия с клавиатуры. Нажми на поле и введи своё сочетание.</div>
                <div className="pqs-sec-t">Настраиваемые</div>
                <Row title="Открыть Музыку" desc="Быстрый переход в Ponoi Music">
                  <KeyCapture value={view.keyMusic} onChange={v => setD('keyMusic', v)} />
                </Row>
                <Row title="Открыть личные сообщения" desc="Быстрый переход на главный экран (ЛС)">
                  <KeyCapture value={view.keyHome} onChange={v => setD('keyHome', v)} />
                </Row>
                <div className="pqs-sec-t">Саундпад</div>
                <Row title="Сохранить момент (15 сек)" desc="В звонке: сохранить последние 15 секунд разговора в саундпад">
                  <KeyCapture value={view.sbKey} onChange={v => setD('sbKey', v)} />
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
                <div className="pqs2-desc">Язык всех надписей приложения.</div>
                <div className="pqs-code-sub">Перевод применяется сразу ко всему интерфейсу и охватывает все надписи приложения. Сообщения пользователей не переводятся.</div>
                <div className="pqs-langs">
                  {LANGS.map(l => (
                    <button key={l.id} className={'pqs-lang' + (view.lang === l.id ? ' on' : '')} onClick={() => setD('lang', l.id)}>
                      <span className="pqs-lang-flag">{l.flag}</span>
                      <span className="pqs-lang-name">{l.name}</span>
                      <span className="pqs-lang-sub">{l.sub}</span>
                      {view.lang === l.id && <span className="pqs-lang-badge"><Icon name="check" size={14} /></span>}
                    </button>
                  ))}
                </div>
              </>}

              {cat === 'display' && <>
                <h2>Дисплей</h2>
                <div className="pqs2-desc">Масштаб интерфейса — сделай всё крупнее или мельче.</div>
                <Row title="Масштаб интерфейса" desc={view.zoom + '%'}>
                  <input type="range" min={70} max={130} step={5} value={view.zoom} onChange={e => setD('zoom', Number(e.target.value))} />
                </Row>
                <button className="pqs-save" onClick={() => setD('zoom', 100)}>Сбросить масштаб</button>
              </>}

              {cat === 'privacy' && <>
                <h2>Данные и конфиденциальность</h2>
                <div className="pqs2-desc">Кто может писать тебе в личку и звонить, какие данные хранит приложение.</div>

                <div className="pqs-sec-t">Сообщения</div>
                <div className="pqs2-desc">Кто может первым написать тебе в личные сообщения.</div>
                <div className="pqs-seg">
                  {([['all', 'Все'], ['friends', 'Только друзья'], ['none', 'Никто']] as const).map(([v, label]) => (
                    <button key={v} className={'pqs-seg-btn' + (profView.dmMessagePrivacy === v ? ' on' : '')}
                      onClick={() => setProfD('dmMessagePrivacy', v)}>{label}</button>
                  ))}
                </div>

                <div className="pqs-sec-t">Звонки</div>
                <div className="pqs2-desc">Кто может звонить тебе в личных сообщениях. «Избранные» — те, кого ты закрепил(а) в списке ЛС.</div>
                <div className="pqs-seg">
                  {([['all', 'Все'], ['friends', 'Только друзья'], ['favorites', 'Только избранные'], ['none', 'Никто']] as const).map(([v, label]) => (
                    <button key={v} className={'pqs-seg-btn' + (profView.dmCallPrivacy === v ? ' on' : '')}
                      onClick={() => setProfD('dmCallPrivacy', v)}>{label}</button>
                  ))}
                </div>

                <Row title="Сбор данных об использовании" desc="Помогает улучшить приложение"><Toggle on={view.dataCollect} onChange={v => setD('dataCollect', v)} /></Row>

                <div className="pqs-sec-t">Заблокированные — {blockedList?.length ?? 0}</div>
                <div className="pqs2-desc">Они не могут писать тебе, звонить и видеть твои сообщения — и наоборот. Разблокировать можно в любой момент.</div>
                {blockedList === null && <div className="pqs-code-sub">Загрузка…</div>}
                {blockedList?.length === 0 && <div className="pqs-code-sub">Список пуст.</div>}
                {blockedList && blockedList.length > 0 && <div className="pqs-acc-card2" style={{ padding: 6 }}>
                  {blockedList.map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px' }}>
                      <Avatar name={e.username} url={e.avatar_url} size={32} userId={e.id} />
                      <span style={{ flex: 1, fontWeight: 600 }}>{e.username}</span>
                      <button className="pqs2-btn ghost" onClick={() => doUnblock(e)}>Разблокировать</button>
                    </div>
                  ))}
                </div>}
              </>}

              {cat === 'activity' && <>
                <h2>Активность</h2>
                <div className="pqs2-desc">Показывай друзьям, во что играешь и чем занимаешься.</div>
                <Row title="Своя активность" desc="Показывать пользовательский статус"><Toggle on={view.actOn} onChange={v => setD('actOn', v)} /></Row>
                {view.actOn && <input className="pqs-in" value={view.actText} onChange={e => setD('actText', e.target.value)} placeholder="Например: Играет в Figma" />}
                <div className="pqs-sec-t">Статистика Dota 2</div>
                <div className="pqs2-desc">Valve не отдаёт MMR через GSI — привяжи SteamID64, и статистика (MMR, последние матчи) подтянется из открытого API OpenDota.</div>
                <input className="pqs-in" value={profView.steamId ?? ''} onChange={e => saveSteamId(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="76561198000000000" inputMode="numeric" />
                <div className="pqs-code-sub">Свой SteamID64 можно найти на <a href="https://steamid.io" target="_blank" rel="noreferrer">steamid.io</a> — вставь ссылку на профиль Steam.</div>

                <div className="pqs-sec-t">Кто видит статистику игр</div>
                <div className="pqs2-desc">Статистика CS2 и Dota 2 в твоём профиле (винрейт, K/D, последние матчи) — тебе она видна всегда, эта настройка только про остальных.</div>
                <div className="pqs-seg">
                  {([['all', 'Все'], ['friends', 'Только друзья'], ['none', 'Никто']] as const).map(([v, label]) => (
                    <button key={v} className={'pqs-seg-btn' + (profView.gameStatsVisibility === v ? ' on' : '')}
                      onClick={() => setProfD('gameStatsVisibility', v)}>{label}</button>
                  ))}
                </div>
              </>}

              {cat === 'advanced' && <>
                <h2>Дополнительно</h2>
                <div className="pqs2-desc">Инструменты для продвинутых: режим разработчика и очистка данных.</div>
                <Row title="Режим разработчика" desc="Показывать ID и отладочную информацию"><Toggle on={view.devmode} onChange={v => setD('devmode', v)} /></Row>
                <button className="pqs-danger" onClick={async () => { if (await confirmUi('Очистить все локальные данные? Настройки, темы и локальные кэши будут сброшены.', { okText: 'Очистить' })) { localStorage.clear(); location.reload() } }}>Очистить все данные</button>
              </>}
              {cat === 'devportal' && <DevPortal />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
