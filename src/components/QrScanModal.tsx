import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastErr, toastOk } from '../lib/toast'
import { parseQr, qrDeviceLabel, codeHash } from '../lib/qrLogin'
import { qrInfo, approveQrLogin } from '../lib/qrLoginNet'

// v1.542.0: вход по коду — сторона телефона.
//
// Владелец: «можно отсканировать и без пароля зайдёшь».
//
// ГЛАВНОЕ ЗДЕСЬ — НЕ КАМЕРА, А ВОПРОС. Прочитать код несложно; опасно другое:
// человек наводит камеру и мгновенно отдаёт свою сессию, не поняв, кому. Поэтому
// между «увидел код» и «отдал вход» стоит экран, где написано, ЧТО именно
// впускают, и где кнопка «нет» стоит первой по руке.
//
// Что сверяется перед отправкой (в qrLoginNet.ts): открытый ключ, прочитанный
// КАМЕРОЙ, против того, что лежит в заявке на сервере. Не сойдётся — не
// отправляем ничего. Именно это не даёт серверу подсунуть свой ключ и прочитать
// сессию.

type Шаг = 'камера' | 'вопрос' | 'готово'

export function QrScanModal({ onClose }: { onClose: () => void }) {
  const [шаг, setШаг] = useState<Шаг>('камера')
  const [ошибка, setОшибка] = useState<string | null>(null)
  const [нашли, setНашли] = useState<{ hash: string; pub: string; device: string } | null>(null)
  const [занят, setЗанят] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  const поток = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (шаг !== 'камера') return
    let жив = true
    let кадр = 0

    // Камеру обязательно гасить самим. Оставленный поток — это горящий огонёк
    // рядом с объективом и съеденная батарея; человек закрыл окно и уверен, что
    // на него больше не смотрят.
    const стоп = () => {
      if (кадр) cancelAnimationFrame(кадр)
      if (поток.current) {
        for (const t of поток.current.getTracks()) t.stop()
        поток.current = null
      }
    }

    void (async () => {
      try {
        // Задняя камера: код показывают на другом экране, и селфи-камерой его
        // наводить неудобно до невозможности.
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        })
        if (!жив) { for (const t of s.getTracks()) t.stop(); return }
        поток.current = s
        const v = video.current
        if (!v) return
        v.srcObject = s
        await v.play()

        const { default: jsQR } = await import('jsqr')
        const холст = document.createElement('canvas')
        const g = холст.getContext('2d', { willReadFrequently: true })

        const шаг1 = () => {
          if (!жив || !g || !video.current) return
          const v2 = video.current
          if (v2.videoWidth > 0) {
            // Уменьшаем кадр: распознавание идёт на каждом кадре, и на полном
            // разрешении телефон греется, а код от этого не читается лучше.
            const ш = 480
            const в = Math.round(v2.videoHeight * (ш / v2.videoWidth))
            холст.width = ш; холст.height = в
            g.drawImage(v2, 0, 0, ш, в)
            const пиксели = g.getImageData(0, 0, ш, в)
            const код = jsQR(пиксели.data, ш, в, { inversionAttempts: 'dontInvert' })
            const наш = код && parseQr(код.data)
            if (наш) {
              void разобрать(наш.code, наш.pub)
              return
            }
          }
          кадр = requestAnimationFrame(шаг1)
        }
        кадр = requestAnimationFrame(шаг1)
      } catch (e) {
        if (жив) setОшибка(проКамеру(e))
      }
    })()

    return () => { жив = false; стоп() }
  }, [шаг])

  async function разобрать(code: string, pub: string) {
    try {
      const hash = await codeHash(code)
      const инфо = await qrInfo(hash)
      if (!инфо) { setОшибка('Код устарел — попроси компьютер показать новый'); return }
      if (инфо.pc_pub !== pub) { setОшибка('Код не сходится с заявкой. Вход отменён'); return }
      setНашли({ hash, pub, device: qrDeviceLabel(инфо.device) })
      setШаг('вопрос')
    } catch (e) {
      setОшибка(понятно(e))
    }
  }

  async function впустить() {
    if (!нашли || занят) return
    setЗанят(true)
    try {
      await approveQrLogin(нашли.hash, нашли.pub)
      setШаг('готово')
      toastOk('Готово — компьютер сейчас войдёт')
    } catch (e) { toastErr(понятно(e)) } finally { setЗанят(false) }
  }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal qrs" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>

        {шаг === 'камера' && <>
          <div className="modal-title" style={{ margin: 0 }}>Наведи на код</div>
          <div className="qrs-cam">
            <video ref={video} playsInline muted className="qrs-video" />
            <div className="qrs-frame" />
          </div>
          {ошибка
            ? <div className="auth2-err">{ошибка}</div>
            : <div className="qrs-hint">Код показан на экране компьютера, на странице входа</div>}
        </>}

        {шаг === 'вопрос' && нашли && <>
          <div className="qrs-ask-ico"><Icon name="monitor" size={26} /></div>
          <div className="modal-title" style={{ margin: 0 }}>Впустить это устройство?</div>
          <div className="qrs-dev">{нашли.device}</div>
          <div className="qrs-warn">
            Если это не ты сейчас открыл Ponoi на компьютере — нажми «Нет».
            Подтверждение впустит это устройство в твой аккаунт без пароля.
          </div>
          <div className="lyr-btns">
            <button className="pqs2-btn" onClick={onClose}>Нет</button>
            <button className="pqs2-btn primary" disabled={занят} onClick={() => void впустить()}>
              {занят ? '…' : 'Да, это я'}
            </button>
          </div>
        </>}

        {шаг === 'готово' && <>
          <div className="qrs-ask-ico ok"><Icon name="check" size={26} /></div>
          <div className="modal-title" style={{ margin: 0 }}>Впустили</div>
          <div className="qrs-hint">Компьютер войдёт через пару секунд</div>
          <div className="lyr-btns"><button className="pqs2-btn primary" onClick={onClose}>Закрыть</button></div>
        </>}
      </div>
    </div></Portal>
  )
}

function проКамеру(e: unknown): string {
  const t = String((e as { name?: string; message?: string })?.name || (e as { message?: string })?.message || e)
  if (/NotAllowedError|Permission/i.test(t)) return 'Нужен доступ к камере — разреши его в настройках приложения'
  if (/NotFoundError|Requested device not found/i.test(t)) return 'Камера не найдена'
  if (/NotReadableError/i.test(t)) return 'Камера занята другим приложением'
  return 'Не вышло открыть камеру'
}

function понятно(e: unknown): string {
  const t = String((e as { message?: string })?.message || e || '')
  if (/login_qr_|function.*does not exist|schema cache/i.test(t)) {
    return 'Вход по коду ещё не включён на сервере — нужна миграция 109_qr_login.sql'
  }
  return t || 'Что-то пошло не так'
}
