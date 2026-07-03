import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { SettingsProvider } from './lib/settings'
import './styles.css'
import { initChatBg } from './lib/chatBg'

initChatBg()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </SettingsProvider>
  </React.StrictMode>,
)


// Скрытый лог в консоли — приветствие для любопытных 🐾
try {
  console.log('%cPonoi', 'color:#5865f2;font-size:28px;font-weight:800;')
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
