// Настоящее приложение для снимков сайта. Собирается scripts/site-shots.mjs.
//
// Монтируется тот же <Home/>, что видит человек после входа, внутри тех же
// провайдеров. Отличается ровно одно: клиент базы подменён на подставной
// (src/lib/__fake_supabase.ts), поэтому экраны поднимаются без сети и без
// чужого аккаунта, а рисует их настоящий код из src/components.
//
// Что снимать — задаётся в адресе (?что=…), см. scripts/site-shots.mjs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '../lib/settings'
import { AuthProvider } from '../auth/AuthProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { Home } from './Home'
import { useAuth } from '../auth/AuthProvider'
import { Toasts } from '../lib/toast'
import '../styles.css'
import '../neylivo-ui.css'

const тема = (window as any).__ТЕМА || 'dark'
document.documentElement.dataset.theme = тема
document.body.dataset.theme = тема

/**
 * Тот же порядок, что в App.tsx: пока вход не поднялся, <Home/> не монтируется.
 *
 * Без этого DMHome падает на `user!.id` в первый же кадр — восклицательный знак
 * там стоит не зря, экран действительно не рассчитан на «пользователя ещё нет».
 * Приложение это учитывает, а мой стенд сначала нет; поймал на первом прогоне.
 */
function Врата() {
  const { user, loading } = useAuth()
  if (loading || !user) return null
  return <Home />
}

// БЕЗ React.StrictMode, и это не небрежность: он монтирует всё дважды, и лента
// сообщений на стенде из-за этого оставалась пустой — снимок сервера выходил с
// экраном «Добро пожаловать», хотя сообщения приезжали (видно по журналу
// подставной базы). Приложение работает в StrictMode нормально; ломается
// именно стенд, где второй прогон эффектов накладывается на подставные данные.
createRoot(document.getElementById('root')!).render(
  <>
    <ErrorBoundary>
      <SettingsProvider>
        <AuthProvider>
          <Toasts />
          <Врата />
        </AuthProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </>,
)
