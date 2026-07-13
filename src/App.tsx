

import { useEffect, useRef, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Home } from './components/Home'
import { Toasts, toastOk } from './lib/toast'
import { loadFavs, toggleFav } from './lib/emoji'
import { ConfirmHost } from './lib/confirm'
import { Icon } from './components/icons'
import { CHANGELOG } from './lib/changelog'
import { openMsgLink } from './lib/deepLink'
import { Capacitor } from '@capacitor/core'
import { checkApkUpdate, getDismissedApkVersion, dismissApkVersion, type ApkUpdate } from './lib/apkUpdate'
import { useClampToViewport } from './lib/clampPos'
import { useNetDegraded, useNetDegradedForMs } from './lib/netStatus'
import { EmergencyChat } from './components/EmergencyChat'

// v1.275.0: через сколько непрерывной деградации предлагать аварийный чат —
// достаточно долго, чтобы не дёргать на секундный сбой, но не тянуть, если
// основной сервер правда лежит.
const EMERGENCY_SUGGEST_MS = 45_000

// v1.59.0: версия приложения, подставляется Vite из package.json (см. vite.config.ts)
declare const __APP_VERSION__: string

// Десктоп без системной рамки (v1.28.0): тонкий тёмный тайтлбар рисуем сами,
// а нативные кнопки «свернуть/развернуть/закрыть» отдаёт Windows-overlay
// (см. electron/main.cjs, titleBarOverlay). Вся полоска — drag-регион.
const isDesktop = typeof window !== 'undefined' && !!(window as any).ponoiDesktop?.isDesktop
// v1.213.0: настоящий APK (Capacitor-обёртка), не браузер/PWA — у той свой
// путь обновления (см. apkUpdate.ts).
const isApkNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

// v1.213.0: баннер «Доступно обновление» для APK — у десктопа авто-обновление
// уже качает и ставит само (UpdateBanner ниже), у APK самое большее, что можно —
// сверить версию и дать прямую ссылку на .apk с последнего GitHub Release;
// установку (и её подтверждение) всё равно делает сама Android.
function ApkUpdateBanner() {
  const [upd, setUpd] = useState<ApkUpdate | null>(null)
  useEffect(() => {
    let alive = true
    checkApkUpdate(__APP_VERSION__).then(u => {
      if (!alive || !u) return
      if (getDismissedApkVersion() === u.version) return
      setUpd(u)
    })
    return () => { alive = false }
  }, [])
  if (!upd) return null
  return (
    <div className="upd-card">
      <div className="upd-ico"><Icon name="download" size={18} /></div>
      <div className="upd-tx">
        <b>Доступно обновление — v{upd.version}</b>
        <span>Скачай APK и установи поверх текущей версии</span>
      </div>
      <a className="upd-go" href={upd.url} target="_blank" rel="noopener noreferrer">Скачать</a>
      <button className="upd-x" title="Скрыть" onClick={() => { dismissApkVersion(upd.version); setUpd(null) }}><Icon name="close" size={14} /></button>
    </div>
  )
}

// Карточка авто-обновления (v1.29.0): живой прогресс скачивания, по готовности —
// кнопка «Перезапустить». Вместо системных немых уведомлений.
// v1.222.0: карточку можно свернуть к краю экрана (стрелка сбоку) вместо полного
// скрытия — если сейчас не до перезапуска, она «заползает в стену», оставляя
// маленький хвостик-ползунок; клик по нему возвращает карточку обратно.
function UpdateBanner() {
  const [u, setU] = useState<{ state: string; percent?: number; version?: string } | null>(null)
  const [hidden, setHidden] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const d = (window as any).ponoiDesktop
    if (!d?.onUpdate) return
    d.onUpdate((data: any) => {
      if (data?.state === 'error') { setU(null); return }   // v1.47.1: ошибка — тихо убираем карточку
      setU(prev => ({ ...(prev ?? { state: 'downloading' }), ...data }))
      if (data?.state === 'ready') setHidden(false)
    })
  }, [])
  if (!u || hidden) return null
  const pct = Math.max(0, Math.min(100, Math.round(u.percent ?? 0)))
  const ready = u.state === 'ready'
  return (
    <>
      <div className={'upd-card' + (ready ? ' ready' : '') + (collapsed ? ' collapsed' : '')}>
        <div className="upd-ico"><Icon name={ready ? 'rotate' : 'download'} size={18} /></div>
        <div className="upd-tx">
          <b>{ready ? 'Обновление готово' : 'Скачиваем обновление'}{u.version ? ' — v' + u.version : ''}</b>
          {ready
            ? <span>Перезапусти Ponoi, чтобы применить</span>
            : <><span>{pct}%</span><div className="upd-bar"><i style={{ width: pct + '%' }} /></div></>}
        </div>
        {ready && <button className="upd-go" onClick={() => (window as any).ponoiDesktop?.applyUpdate?.()}>Перезапустить</button>}
        <button className="upd-collapse" title="Свернуть к краю" onClick={() => setCollapsed(true)}><Icon name="chevron-right" size={14} /></button>
        <button className="upd-x" title="Скрыть" onClick={() => setHidden(true)}><Icon name="close" size={14} /></button>
      </div>
      <button className={'upd-handle' + (collapsed ? ' show' : '')} title="Обновление отложено — показать" onClick={() => setCollapsed(false)}>
        <Icon name={ready ? 'rotate' : 'download'} size={16} />
      </button>
    </>
  )
}

// v1.272.0: устойчивый клиент — когда несколько запросов подряд к Supabase
// проваливаются (см. netStatus.ts), список серверов/друзей/каналов остаётся
// последним известным (из кэша), а не тихо становится пустым — но пользователь
// должен понимать ПОЧЕМУ ничего не обновляется, а не решить, что приложение
// сломано. Тонкая полоска сверху, не блокирует работу с уже загруженным.
function NetStatusBanner({ onOpenEmergency }: { onOpenEmergency: () => void }) {
  const degraded = useNetDegraded()
  const forMs = useNetDegradedForMs()
  if (!degraded) return null
  const long = forMs >= EMERGENCY_SUGGEST_MS
  return (
    <div className="net-banner">
      Нет связи с сервером — показываю последнее сохранённое, часть действий пока не сработает
      {long && <button className="net-banner-ec" onClick={onOpenEmergency}>🚨 Открыть аварийный чат</button>}
    </div>
  )
}

// v1.56.0: своя шапка вместо нативной рамки Windows — стрелки назад/вперёд слева,
// название раздела по центру, справа иконки и свои кнопки окна (как в Discord).
// Нативный titleBarOverlay убран (рисовался поверх приложения и ломался).
function Titlebar() {
  const [nav, setNav] = useState<{ title: string; canBack: boolean; canForward: boolean }>({ title: '', canBack: false, canForward: false })
  const [max, setMax] = useState(false)
  useEffect(() => {
    const h = (e: any) => setNav(e.detail)
    window.addEventListener('ponoi-nav-state', h as any)
    window.dispatchEvent(new Event('ponoi-nav-request'))
    const d = (window as any).ponoiDesktop
    d?.onMaximize?.((m: boolean) => setMax(m))
    return () => window.removeEventListener('ponoi-nav-state', h as any)
  }, [])
  const wc = () => (window as any).ponoiDesktop
  return (
    <header className="titlebar">
      <div className="tb-nav">
        <button className="tb-arrow" disabled={!nav.canBack} title="Назад"
          onClick={() => window.dispatchEvent(new Event('ponoi-nav-back'))}><Icon name="arrow-left" size={18} /></button>
        <button className="tb-arrow" disabled={!nav.canForward} title="Вперёд"
          onClick={() => window.dispatchEvent(new Event('ponoi-nav-forward'))}><Icon name="arrow-right" size={18} /></button>
      </div>
      <div className="tb-title">{nav.title}</div>
      <div className="tb-right">
        <button className="tb-ico" title="Быстрый переход (Ctrl+K)"
          onClick={() => window.dispatchEvent(new Event('ponoi-open-qs'))}><Icon name="search" size={16} /></button>
        <div className="tb-winctrls">
          <button className="tb-win" title="Свернуть" onClick={() => wc()?.winMinimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button className="tb-win" title={max ? 'Восстановить' : 'Развернуть'} onClick={() => wc()?.winToggleMax?.()}>
            {max
              ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="2.5" width="6" height="6" /><path d="M2.5 2.5V0.5H9.5V7.5H7.5" /></svg>
              : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>}
          </button>
          <button className="tb-win tb-close" title="Закрыть" onClick={() => wc()?.winClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M1 1l8 8M9 1l-8 8" /></svg>
          </button>
        </div>
      </div>
    </header>
  )
}

// v1.116.0: окно «Что нового» — открывается тройным кликом по версии в правом нижнем углу.
function ChangelogModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="chlog-overlay" onClick={onClose}>
      <div className="chlog" onClick={e => e.stopPropagation()}>
        <div className="chlog-head">
          <div>
            <div className="chlog-title">Что нового <span className="beta-tag" title="Ponoi сейчас в бета-тестировании — возможны баги">БЕТА</span></div>
            <div className="chlog-sub">История обновлений Ponoi — все версии пока бета</div>
          </div>
          <button className="chlog-x" title="Закрыть" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="chlog-body">
          {CHANGELOG.map(v => (
            <div key={v.version} className="chlog-ver">
              <div className="chlog-ver-h">
                <span className="chlog-badge">v{v.version}</span>
                <span className="beta-tag">бета</span>
                {v.version === __APP_VERSION__ && <span className="chlog-cur">текущая</span>}
                <span className="chlog-date">{v.date}</span>
              </div>
              <ul className="chlog-list">
                {v.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// v1.137.0: правый клик по кастом-эмодзи в любом сообщении (сервер/ЛС) — меню
// «В избранное». Слушает событие 'ponoi-emoji-ctx' из рендерера сообщений (md.tsx).
function EmojiCtxHost() {
  const { user } = useAuth()
  const [ctx, setCtx] = useState<{ name: string; x: number; y: number } | null>(null)
  const [, setVer] = useState(0)
  useEffect(() => {
    const h = (e: any) => setCtx(e.detail)
    const h2 = () => setVer(v => v + 1)
    window.addEventListener('ponoi-emoji-ctx', h as any)
    window.addEventListener('ponoi-emoji-favs', h2)
    return () => { window.removeEventListener('ponoi-emoji-ctx', h as any); window.removeEventListener('ponoi-emoji-favs', h2) }
  }, [])
  const clamp = useClampToViewport(ctx?.x ?? 0, ctx?.y ?? 0)
  if (!ctx || !user) return null
  const fav = loadFavs().has(ctx.name)
  return <>
    <div className="ep2-ctx-ov" onClick={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null) }} />
    <div className="ep2-ctx" ref={clamp.ref} style={clamp.style}>
      <button onClick={async () => { const added = await toggleFav(user.id, ctx.name); toastOk(added ? ':' + ctx.name + ': — в избранном, ищи в пикере под звёздочкой' : ':' + ctx.name + ': убран из избранного'); setCtx(null) }}>
        <Icon name="star" size={14} /> {fav ? 'Убрать из избранного' : 'В избранное'}
      </button>
    </div>
  </>
}

export default function App() {
  const { session, loading } = useAuth()
  // v1.161.0: диплинк ponoi://msg/... — приложение было открыто/поднято таким URL
  // (десктоп, см. electron/main.cjs). Разбираем и переходим к сообщению.
  useEffect(() => { (window as any).ponoiDesktop?.onDeepLink?.((url: string) => openMsgLink(url)) }, [])
  // v1.116.0: три быстрых клика по версии — окно «Что нового»
  const [showLog, setShowLog] = useState(false)
  // v1.275.0: доступен даже если сам основной вход/сессия не грузится (loading
  // может зависнуть именно из-за той же недоступности Supabase) — поэтому
  // рендерится вне {loading ? ... : ...} ниже, а не только внутри Home.
  const [showEmergency, setShowEmergency] = useState(false)
  const verClicks = useRef<number[]>([])
  function verClick() {
    const now = Date.now()
    verClicks.current = [...verClicks.current.filter(t => now - t < 1200), now]
    if (verClicks.current.length >= 3) { verClicks.current = []; setShowLog(true) }
  }
  return <>
    <Toasts />
    <ConfirmHost />
    <EmojiCtxHost />
    {isDesktop && <Titlebar />}
    {isDesktop && <UpdateBanner />}
    {isApkNative && <ApkUpdateBanner />}
    <NetStatusBanner onOpenEmergency={() => setShowEmergency(true)} />
    <div className="app-viewport">
      {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
    </div>
    {showEmergency && <EmergencyChat onClose={() => setShowEmergency(false)} />}
    {/* v1.59.0: текущая версия мелким шрифтом в правом нижнем углу.
        v1.231.0: Ponoi сейчас в бета-тестировании — метка БЕТА рядом с версией
        везде, где она показывается (тут и в окне «Что нового»). */}
    <div className="app-ver" onClick={verClick} title="Три клика — что нового в Ponoi">v{__APP_VERSION__} <span className="beta-tag">бета</span></div>
    {showLog && <ChangelogModal onClose={() => setShowLog(false)} />}
  </>
}
