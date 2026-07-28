import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

// Список устройств берём напрямую у браузера, а НЕ через getLocalDevices из
// lib/livekit: та тянет за собой всю библиотеку звонков (полмегабайта) ради
// одного перечисления — открытие настроек не должно этого стоить.
async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === kind) }
  catch { return [] }
}

// v1.334.0: «Проверим» — проверка микрофона и камеры прямо в настройках, как в
// Discord. До этого раздел «Голос и видео» состоял из двух ползунков и надписи
// «применяются при звонке»: понять, слышит ли тебя микрофон, можно было только
// позвонив живому человеку. В DESIGN_PARITY проверка микрофона при этом числилась
// сделанной — это была неправда.
//
// Меряем настоящий сигнал с устройства через AnalyserNode: полоска движется от
// голоса, а не от таймера. Пока проверка выключена — микрофон не захвачен вовсе,
// индикатор записи в системе не горит.

const BARS = 22

/** Устройства ввода: тот же ключ, что читает звонок (см. joinRoom в lib/livekit.ts). */
function DevicePicker({ kind, label, hint }: { kind: 'mic' | 'cam'; label: string; hint: string }) {
  const [list, setList] = useState<MediaDeviceInfo[] | null>(null)
  const [cur, setCur] = useState(() => localStorage.getItem('ponoi_dev_' + kind) ?? '')

  useEffect(() => {
    listDevices(kind === 'mic' ? 'audioinput' : 'videoinput').then(setList)
  }, [kind])

  function pick(id: string) {
    setCur(id)
    if (id) localStorage.setItem('ponoi_dev_' + kind, id)
    else localStorage.removeItem('ponoi_dev_' + kind)
  }

  // Браузер прячет названия устройств, пока доступ ни разу не выдавали, — в
  // списке остаются пустые строки. Говорим об этом прямо, иначе выглядит как
  // недоработка приложения.
  const nameless = !!list?.length && list.every(d => !d.label)

  return (
    <div className="pqs-optrow">
      <div>
        <div className="pqs-optt">{label}</div>
        <div className="pqs-optd">{nameless ? 'Названия устройств покажет браузер после первого «Проверим» ниже' : hint}</div>
      </div>
      <select className="modal-in" style={{ maxWidth: 260 }} value={cur} onChange={e => pick(e.target.value)}>
        <option value="">По умолчанию</option>
        {(list ?? []).map(d => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || (kind === 'mic' ? 'Микрофон' : 'Камера')}</option>
        ))}
      </select>
    </div>
  )
}

export function MicTest() {
  const [on, setOn] = useState(false)
  const [monitor, setMonitor] = useState(false)
  // Состояние — только число зажжённых сегментов: перерисовывать React 60 раз в
  // секунду ради дробного числа незачем, глазу видно ровно сегменты.
  const [lit, setLit] = useState(0)
  const [peak, setPeak] = useState(0)        // самый громкий момент за проверку
  const peakRef = useRef(0)
  const [err, setErr] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const monitorRef = useRef<GainNode | null>(null)
  const rafRef = useRef(0)

  // Останавливаем всё при уходе со страницы: иначе микрофон остался бы
  // захваченным, и в системе продолжал бы гореть значок записи.
  useEffect(() => () => stop(), [])

  function stop() {
    cancelAnimationFrame(rafRef.current)
    monitorRef.current?.disconnect()
    monitorRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    setLit(0)
    setOn(false)
  }

  async function start() {
    setErr(null)
    try {
      const saved = localStorage.getItem('ponoi_dev_mic') || undefined
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: saved, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      await ctx.resume().catch(() => {})
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.6
      src.connect(analyser)

      // Услышать себя — отдельно и по желанию: без наушников это заводится в
      // свист, поэтому по умолчанию выключено и об этом написано рядом.
      const mon = ctx.createGain()
      // Начальное значение — по текущему выбору, а не всегда 0: иначе после
      // «Остановить» и повторного «Проверим» галочка осталась бы отмеченной,
      // а слышно себя не было бы (эффект ниже не сработает — состояние не менялось).
      mon.gain.value = monitor ? 1 : 0
      src.connect(mon).connect(ctx.destination)
      monitorRef.current = mon

      const buf = new Float32Array(analyser.fftSize)
      let shown = 0
      setPeak(0); peakRef.current = 0
      let lastPeakPush = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        // Среднеквадратичное — оно ближе к тому, что человек считает громкостью,
        // чем «самый большой отсчёт»: одиночный щелчок не растягивает полоску.
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        // Шкала децибельная, а не линейная. С линейной («умножить на 4») полоска
        // упиралась в максимум уже на средней громкости, а тихая речь еле шевелила
        // первый сегмент: слух устроен логарифмически, и настоящие индикаторы
        // уровня — тоже. Диапазон -60…0 дБ раскладывается на всю полоску:
        // еле слышный шум — 2 сегмента, обычная речь — около 14, крик — 20.
        const v = rms <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60))
        // Вверх — сразу, вниз — плавно: так полоска не дёргается на паузах между
        // словами и при этом честно показывает момент, когда ты заговорил.
        shown = v > shown ? v : shown * 0.86 + v * 0.14
        setLit(prev => { const n = Math.round(shown * BARS); return n === prev ? prev : n })
        if (v > peakRef.current) peakRef.current = v
        // Подпись под полоской меняется редко — обновляем её пару раз в секунду,
        // а не каждый кадр.
        const now = performance.now()
        if (now - lastPeakPush > 400) { lastPeakPush = now; setPeak(peakRef.current) }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      setOn(true)
    } catch (e: any) {
      const msg = String(e?.name === 'NotAllowedError'
        ? 'Браузер не дал доступ к микрофону — разреши его в настройках сайта.'
        : e?.name === 'NotFoundError'
          ? 'Микрофон не найден — проверь, подключён ли он.'
          : (e?.message ?? e))
      setErr(msg)
      stop()
    }
  }

  useEffect(() => {
    if (monitorRef.current) monitorRef.current.gain.value = monitor ? 1 : 0
  }, [monitor])

  // Пороги — в той же децибельной шкале, что и полоска (см. tick).
  const verdict = !on ? null
    : peak < 0.15 ? 'Пока тишина — скажи что-нибудь.'
    : peak < 0.45 ? 'Слышно, но тихо. Придвинься ближе или подними «Громкость микрофона» выше.'
    : peak > 0.93 ? 'Очень громко — звук может хрипеть. Убавь «Громкость микрофона».'
    : 'Отлично слышно.'

  return (
    <div className="mic-test">
      <div className="mic-test-h">
        <div>
          <div className="pqs-optt">Проверка микрофона</div>
          <div className="pqs-optd">Скажи что-нибудь — если полоска движется, тебя слышно.</div>
        </div>
        <button className={'pqs2-btn' + (on ? ' ghost' : '')} onClick={() => (on ? stop() : void start())}>
          <Icon name={on ? 'close' : 'mic'} size={15} /> {on ? 'Остановить' : 'Проверим'}
        </button>
      </div>

      <div className={'mic-bars' + (on ? ' live' : '')} role="img"
        aria-label={`Уровень сигнала: ${Math.round((lit / BARS) * 100)}%`}>
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} className={'mic-bar' + (i < lit ? ' on' : '') + (i > BARS * 0.82 ? ' hot' : i > BARS * 0.6 ? ' warm' : '')} />
        ))}
      </div>

      {verdict && <div className="mic-verdict">{verdict}</div>}
      {err && <div className="pqs-font-warn">⚠️ {err}</div>}

      {on && (
        <label className="mic-monitor">
          <input type="checkbox" checked={monitor} onChange={e => setMonitor(e.target.checked)} />
          <span>Слышать себя <span className="mut">— только в наушниках: через динамики пойдёт свист</span></span>
        </label>
      )}
    </div>
  )
}

/** Проверка камеры: то же по смыслу — видно себя или нет. */
export function CameraTest() {
  const [on, setOn] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => () => stop(), [])

  function stop() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setOn(false)
  }

  async function start() {
    setErr(null)
    try {
      const saved = localStorage.getItem('ponoi_dev_cam') || undefined
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: saved } })
      streamRef.current = stream
      setOn(true)
      // Видео появляется после отрисовки — присваиваем в следующем кадре, иначе
      // ref ещё пуст и картинки не будет.
      requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream })
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? 'Браузер не дал доступ к камере.' : (e?.message ?? String(e)))
      stop()
    }
  }

  return (
    <div className="mic-test">
      <div className="mic-test-h">
        <div>
          <div className="pqs-optt">Проверка камеры</div>
          <div className="pqs-optd">Показывает только тебе — картинка никуда не уходит.</div>
        </div>
        <button className={'pqs2-btn' + (on ? ' ghost' : '')} onClick={() => (on ? stop() : void start())}>
          <Icon name={on ? 'close' : 'video'} size={15} /> {on ? 'Выключить' : 'Показать'}
        </button>
      </div>
      {on && <video ref={videoRef} className="cam-preview" autoPlay playsInline muted />}
      {err && <div className="pqs-font-warn">⚠️ {err}</div>}
    </div>
  )
}

export function VoiceDevices() {
  return <>
    <DevicePicker kind="mic" label="Устройство ввода" hint="Микрофон, с которого тебя будет слышно в звонках" />
    <DevicePicker kind="cam" label="Камера" hint="Та же камера включится в звонке" />
  </>
}

// Совет: getLocalDevices отдаёт подписи устройств только после того, как доступ
// уже был выдан хотя бы раз — до этого в списке будут безымянные строки. Это
// ограничение браузера, а не наша недоработка: нажми «Проверим», и названия
// появятся.
