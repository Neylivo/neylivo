

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

export default function App() {
  const { session, loading } = useAuth()
  return <>
    <Toasts />
    <ConfirmHost />
    {isDesktop && <header className="titlebar">
      <span className="tb-logo">P</span>
      <span className="tb-name">Ponoi</span>
    </header>}
    {isDesktop && <UpdateBanner />}
    <div className="app-viewport">
      {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
    </div>
  </>
}
