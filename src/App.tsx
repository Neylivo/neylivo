import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Home } from './components/Home'

export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="center">Загрузка…</div>
  if (!session) return <AuthScreen />
  return <Home />
}
