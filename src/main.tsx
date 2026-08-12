// v1.298.0: собственный Inter вместо запроса к Google при каждом запуске.
// Только кириллица и латиница: остальные подмножества (греческий, вьетнамский)
// в приложении не нужны и лишь утяжелили бы сборку.
import '@fontsource/inter/cyrillic-400.css'
import '@fontsource/inter/cyrillic-500.css'
import '@fontsource/inter/cyrillic-600.css'
import '@fontsource/inter/cyrillic-700.css'
import '@fontsource/inter/cyrillic-800.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-800.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { SettingsProvider } from './lib/settings'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'
import './neylivo-ui.css'
import { initChatBg } from './lib/chatBg'
import { applyBlurMessages, watchBlurTaps } from './lib/captureGuard'
import { держатьРамку } from './lib/frameGuard'

// v1.557.0: во вложении в чужую страницу приложение не запускается — см.
// lib/frameGuard.ts. Проверка стоит ПЕРВОЙ: смысл в том, чтобы ни один экран с
// перепиской не успел появиться внутри чужой рамки.
const вЧужойРамке = держатьРамку()

initChatBg()

// v1.556.0: скрытие сообщений включается ДО отрисовки приложения.
//
// Иначе первый кадр показал бы переписку открытой — то есть ровно в тот момент,
// когда её видно и человеку, и чужой камере, и записи экрана.
applyBlurMessages()
watchBlurTaps()

// PWA (v1.34.0): регистрируем service worker сразу — нужен для установки на телефон.
// Под Electron file:// сервис-воркеры недоступны, поэтому тихо пропускаем.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

/**
 * v1.442.0: поднять вход из запасной полки ДО того, как приложение спросит о нём.
 *
 * На Android localStorage переживает не всякое обновление, а клиент Supabase
 * читает сессию сразу при создании — то есть если восстанавливать после, он уже
 * успеет показать экран входа. Поэтому: сначала восстановление, потом импорт
 * всего, что тянет за собой клиент.
 *
 * В браузере запасной полки нет, restoreAuth возвращает false мгновенно и ничего
 * не задерживает.
 */
async function boot() {
  if (вЧужойРамке) return
  try {
    const { restoreAuth, authKeyFor } = await import('./lib/authStore')
    await restoreAuth([authKeyFor(import.meta.env.VITE_SUPABASE_URL as string)])
  } catch { /* нет запасной полки — работаем на одном localStorage */ }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <SettingsProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SettingsProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
void boot()


// Скрытый лог в консоли — приветствие для любопытных 🐾
try {
  console.log('%cNeyLivo', 'color:#5865f2;font-size:28px;font-weight:800;')
  console.log('%cПривет, любопытный! Раз ты открыл консоль — держи секретное рукопожатие: 🐾', 'color:#949ba4;font-size:13px;')
} catch {}


// Пауза всех CSS-анимаций, если вкладка неактивна дольше 30 секунд — экономит CPU и батарею.
let animHideTimer: number | undefined
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    animHideTimer = window.setTimeout(() => document.body.classList.add('anim-paused'), 30000)
  } else {
    window.clearTimeout(animHideTimer)
    document.body.classList.remove('anim-paused')
  }
})
