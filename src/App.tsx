import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Home } from './components/Home'
import { Toasts } from './lib/toast'

export default function App() {
  const { session, loading } = useAuth()
  return <>
    <Toasts />
    {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
  </>
}
