import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/icons'
import { supabase } from '../lib/supabase'
import { qrLeftSec, qrExpired } from '../lib/qrLogin'
import { startQrLogin, claimQrLogin, type QrRequest } from '../lib/qrLoginNet'
import { drawQr } from '../lib/qrDraw'

// v1.542.0: вход по коду с телефона — сторона компьютера.
//
// Владелец: «когда надо через ПК зайти, а залогинен в телефоне, можно
// отсканировать и без пароля зайдёшь».
//
// Здесь показывается QR и ожидается ответ. Ключ, которым телефон зашифрует
// сессию, живёт только в этой вкладке: он ни разу не уходит на сервер, а его
// открытая половина печатается прямо в квадратиках — см. qrLoginNet.ts.
//
// Почему код обновляется сам каждые две минуты. Показанный QR — это ключ от
// аккаунта на ближайшие две минуты. Оставленный на ночь экран входа с вечным
// кодом означал бы, что войти может любой, кто мимо прошёл и сфотографировал.

export function QrLoginPanel({ onClose }: { onClose: () => void }) {
  const [заявка, setЗаявка] = useState<QrRequest | null>(null)
  const [ошибка, setОшибка] = useState<string | null>(null)
  const [осталось, setОсталось] = useState(0)
  const [входим, setВходим] = useState(false)
  const canvas = useRef<HTMLCanvasElement | null>(null)

  // Новая заявка: при открытии и каждый раз, когда прошлая истекла.
  const создать = async () => {
    setОшибка(null)
    try {
      const з = await startQrLogin()
      setЗаявка(з)
      setОсталось(qrLeftSec(з.созданаМс))
    } catch (e) {
      setОшибка(понятно(e))
    }
  }

  useEffect(() => { void создать() }, [])

  useEffect(() => {
    if (!заявка || !canvas.current) return
    void drawQr(canvas.current, заявка.payload).catch(e => setОшибка(понятно(e)))
  }, [заявка])

  // Опрос и обратный отсчёт одним таймером: два таймера на один экран — это
  // два места, где можно забыть про уборку.
  useEffect(() => {
    if (!заявка || входим) return
    let жив = true
    const t = window.setInterval(async () => {
      if (!жив) return
      setОсталось(qrLeftSec(заявка.созданаМс))
      if (qrExpired(заявка.созданаМс)) { void создать(); return }
      try {
        const сессия = await claimQrLogin(заявка)
        if (!сессия || !жив) return
        setВходим(true)
        const { error } = await supabase.auth.setSession(сессия)
        if (error) throw error
        // Дальше приложение само заметит появившуюся сессию и покажет главный
        // экран — отдельного «перейти» тут не нужно.
      } catch (e) {
        if (жив) { setОшибка(понятно(e)); setВходим(false) }
      }
    }, 1500)
    return () => { жив = false; window.clearInterval(t) }
  }, [заявка, входим])

  return (
    <div className="qr2">
      <button type="button" className="qr2-back" onClick={onClose}>
        <Icon name="chevron-left" size={18} /> Назад
      </button>
      <h1>Вход по коду</h1>
      <p className="auth2-sub">Открой Ponoi на телефоне, где ты уже вошёл, и наведи камеру</p>

      <div className="qr2-box">
        {заявка
          ? <canvas ref={canvas} className="qr2-canvas" aria-label="Код для входа" />
          : <div className="qr2-wait">Готовим код…</div>}
        {входим && <div className="qr2-ok"><Icon name="check" size={22} /> Телефон подтвердил, входим…</div>}
      </div>

      {ошибка && <div className="auth2-err">{ошибка}</div>}

      <div className="qr2-steps">
        <div className="qr2-step"><span>1</span> На телефоне: Настройки → Устройства и безопасность</div>
        <div className="qr2-step"><span>2</span> Нажми «Сканировать код входа»</div>
        <div className="qr2-step"><span>3</span> Подтверди, что это ты</div>
      </div>

      <div className="qr2-hint">
        {осталось > 0
          ? 'Код обновится через ' + осталось + ' с — так его нельзя подсмотреть заранее.'
          : 'Обновляем код…'}
      </div>
      <div className="auth2-legal">
        Пароль при этом не передаётся никуда. Телефон шифрует вход ключом, который
        нарисован в самом коде и не покидает этот компьютер.
      </div>
    </div>
  )
}

/** Человеческое из того, что вернул сервер. */
function понятно(e: unknown): string {
  const t = String((e as { message?: string })?.message || e || '')
  if (/login_qr_start|login_qr_claim|function.*does not exist|schema cache/i.test(t)) {
    return 'Вход по коду ещё не включён на сервере — нужна миграция 109_qr_login.sql'
  }
  if (/Failed to fetch|NetworkError/i.test(t)) return 'Нет связи с сервером'
  return t || 'Что-то пошло не так'
}
