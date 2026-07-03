import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Home } from './components/Home'
import { Toasts } from './lib/toast'
import { ConfirmHost } from './lib/confirm'

export default function App() {
  const { session, loading } = useAuth()
  return <>
    <Toasts />
    <ConfirmHost />
    {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
  </>
}
