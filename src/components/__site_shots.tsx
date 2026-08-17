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
import App from '../App'
import { Home } from './Home'
import { useAuth } from '../auth/AuthProvider'
import { Toasts } from '../lib/toast'
import '../styles.css'
import '../neylivo-ui.css'

// Рабочий стол подделывается ДО импорта App: isDesktop в нём вычисляется один
// раз на модуле, и позже флаг уже ничего не изменит. Нужен, чтобы на стенде
// была настоящая полоса заголовка — на неё и наезжали наложения.
const тема = (window as any).__ТЕМА || 'dark'
document.documentElement.dataset.theme = тема
document.body.dataset.theme = тема

// v1.563.0: СВЕТЛОЙ ТЕМЫ НА СТЕНДЕ НЕ БЫЛО ВОВСЕ.
//
// Признака на теге мало. SettingsProvider при первом же кадре зовёт apply(), а
// та делает `root.setAttribute('data-theme', day ? 'light' : s.theme)` — то
// есть затирает поставленное здесь СОХРАНЁННОЙ настройкой, а по умолчанию она
// 'dark'. Проверено замером: server-light.png и server-dark.png совпадали по
// средней яркости до последней единицы (49,50,56) — «светлый» снимок был
// тёмным, и он в таком виде лежал на официальном сайте.
//
// Поэтому тему задаём НАСТОЯЩЕЙ настройкой, а не признаком: стенд проходит тот
// же путь, что человек, переключивший тему в настройках.
//
// systemTheme и autoTheme гасим ОБА и для тёмной тоже. Первая смотрит на
// prefers-color-scheme самой машины, вторая — на часы (8:00–20:00 = светлая).
// Оставь их — и снимки зависели бы от того, когда и на каком компьютере их
// сняли: днём тёмный снимок молча выходил бы светлым.
try {
  const было = JSON.parse(localStorage.getItem('ponoi_settings') || '{}')
  localStorage.setItem('ponoi_settings', JSON.stringify({
    ...было, theme: тема, autoTheme: false, systemTheme: false,
  }))
} catch { /* без localStorage стенд всё равно не поднимется */ }

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
  // Весь настоящий каркас, если попросили рабочий стол: полоса заголовка,
  // баннеры, наложения. Иначе только основной экран — снимкам он и нужен.
  return (window as any).__РАБСТОЛ ? <App /> : <Home />
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
