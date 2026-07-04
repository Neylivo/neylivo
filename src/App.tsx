

import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Home } from './components/Home'
import { Toasts } from './lib/toast'
import { ConfirmHost } from './lib/confirm'

// Десктоп без системной рамки (v1.28.0): тонкий тёмный тайтлбар рисуем сами,
// а нативные кнопки «свернуть/развернуть/закрыть» отдаёт Windows-overlay
// (см. electron/main.cjs, titleBarOverlay). Вся полоска — drag-регион.
const isDesktop = typeof window !== 'undefined' && !!(window as any).ponoiDesktop?.isDesktop

export default function App() {
  const { session, loading } = useAuth()
  return <>
    <Toasts />
    <ConfirmHost />
    {isDesktop && <header className="titlebar">
      <span className="tb-logo">P</span>
      <span className="tb-name">Ponoi</span>
    </header>}
    <div className="app-viewport">
      {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
    </div>
  </>
}
