// Настоящие компоненты на экране телефона. Запуск: npm run look:real
//
// Владелец: «у тебя на примерах красивей чем в реальности».
//
// Он был прав, и вина моя. Снимки делались с РАЗМЕТКИ, которую я писал руками
// «по мотивам» компонентов. Такая разметка всегда аккуратнее настоящей: в ней
// нет лишних обёрток, нет второго класса от условия, нет подложек профиля и
// значков состояния. Стенд показывал моё представление о приложении.
//
// Здесь на страницу монтируются НАСТОЯЩИЕ компоненты внутри настоящих
// провайдеров. Что нарисует React — то и попадёт на снимок.
//
// ЧЕГО ЗДЕСЬ НЕТ: сети и входа в аккаунт. Поэтому снимаются только экраны,
// которые поднимаются без сессии, — настройки. Список бесед падает на user.id,
// и подставная сессия в хранилище его не спасает: клиент базы её проверяет и
// отбрасывает. Для тех экранов нужен слой подставных данных вместо клиента, и
// это отдельная работа. Писать сюда «проверено» про них было бы враньём.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '../lib/settings'
import { AuthProvider } from '../auth/AuthProvider'
import { Settings } from './Settings'
import { AppWorkshop } from './AppWorkshop'
import { Toasts } from '../lib/toast'

const что = new URLSearchParams(location.search).get('что') || 'настройки'

function Экран() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <Toasts />
        {/* Мастерская — отдельным экраном, а не через настройки: до неё иначе
            надо доклацать через раздел, а снимок должен показывать сам
            редактор, а не путь к нему. */}
        {что === 'мастерская'
          ? <div className="pqs2-body" style={{ height: '100%', padding: 16, overflow: 'auto' }}>
              <AppWorkshop onClose={() => {}} />
            </div>
          : <Settings username="guchipon" avatarUrl={null} onClose={() => {}} />}
      </AuthProvider>
    </SettingsProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Экран />)
