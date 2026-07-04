

import { useEffect, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Home } from './components/Home'
import { Toasts } from './lib/toast'
import { ConfirmHost } from './lib/confirm'
import { Icon } from './components/icons'

// Десктоп без системной рамки (v1.28.0): тонкий тёмный тайтлбар рисуем сами,
// а нативные кнопки «свернуть/развернуть/закрыть» отдаёт Windows-overlay
// (см. electron/main.cjs, titleBarOverlay). Вся полоска — drag-регион.
const isDesktop = typeof window !== 'undefined' && !!(window as any).ponoiDesktop?.isDesktop

// Карточка авто-обновления (v1.29.0): живой прогресс скачивания, по готовности —
// кнопка «Перезапустить». Вместо системных немых уведомлений.
function UpdateBanner() {
  const [u, setU] = useState<{ state: string; percent?: number; version?: string } | null>(null)
  const [hidden, setHidden] = useState(false)
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
    <div className={'upd-card' + (ready ? ' ready' : '')}>
      <div className="upd-ico"><Icon name={ready ? 'rotate' : 'download'} size={18} /></div>
      <div className="upd-tx">
        <b>{ready ? 'Обновление готово' : 'Скачиваем обновление'}{u.version ? ' — v' + u.version : ''}</b>
        {ready
          ? <span>Перезапусти Ponoi, чтобы применить</span>
          : <><span>{pct}%</span><div className="upd-bar"><i style={{ width: pct + '%' }} /></div></>}
      </div>
      {ready && <button className="upd-go" onClick={() => (window as any).ponoiDesktop?.applyUpdate?.()}>Перезапустить</button>}
      <button className="upd-x" title="Скрыть" onClick={() => setHidden(true)}><Icon name="close" size={14} /></button>
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

export default function App() {
  const { session, loading } = useAuth()
  return <>
    <Toasts />
    <ConfirmHost />
    {isDesktop && <Titlebar />}
    {isDesktop && <UpdateBanner />}
    <div className="app-viewport">
      {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
    </div>
  </>
}
