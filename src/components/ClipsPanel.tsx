import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastErr, toastOk } from '../lib/toast'
import { useSettings } from '../lib/settings'
import { usePresence } from '../lib/presence'
import {
  CLIP_MIN_SEC, CLIP_MAX_SEC, clampSeconds, clipLabel, clipName,
} from '../lib/clipBuffer'

// v1.538.0: настройки записи последних секунд экрана — как в Medal.
//
// Владелец: «сохранять от 5 секунд до 3 минут того, что происходило на экране,
// а настройки сделать удобными, понятными и красивыми».
//
// Что здесь считается «понятными». Каждая настройка объясняет ПОСЛЕДСТВИЕ, а не
// себя: не «битрейт 4000 кбит/с», а «сколько весит минута записи». Человек
// выбирает не число, а то, чего хочет, и видит цену выбора сразу.
//
// Почему это только на компьютере. Запись экрана есть у настольного приложения:
// в браузере она требует разрешения на каждый запуск, а на телефоне её нет
// вовсе. Показывать переключатель, который не сработает, — обман; поэтому в
// вебе раздел честно говорит, где это работает.
const КАЧЕСТВО = [
  { id: 'low', name: 'Экономно', height: 720, fps: 30, bitrate: 2_500_000, note: '≈ 18 МБ за минуту' },
  { id: 'mid', name: 'Обычное', height: 1080, fps: 30, bitrate: 5_000_000, note: '≈ 37 МБ за минуту' },
  { id: 'high', name: 'Чётко', height: 1080, fps: 60, bitrate: 8_000_000, note: '≈ 60 МБ за минуту' },
] as const

const desktop = (): any => (window as any).ponoiDesktop

export function ClipsPanel() {
  const { settings, set } = useSettings()
  const { gameOf } = usePresence()
  const [state, setState] = useState<{ running: boolean; folder: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const есть = !!desktop()?.clipStart
  const сек = clampSeconds(settings.clipSeconds ?? 30)
  const кач = КАЧЕСТВО.find(k => k.id === (settings.clipQuality || 'mid')) ?? КАЧЕСТВО[1]

  useEffect(() => {
    if (!есть) return
    let жив = true
    void desktop().clipState().then((s: any) => { if (жив) setState(s) })
    return () => { жив = false }
  }, [есть])

  async function включить(on: boolean) {
    set('clipsOn', on)
    if (!есть) return
    setBusy(true)
    try {
      if (on) {
        const r = await desktop().clipStart({ seconds: сек, fps: кач.fps, height: кач.height, bitrate: кач.bitrate })
        if (!r?.ok) throw new Error(r?.why || 'не вышло начать запись')
        toastOk('Запись идёт. Последние ' + clipLabel(сек) + ' всегда под рукой.')
      } else {
        await desktop().clipStop()
      }
      setState(await desktop().clipState())
    } catch (e) { toastErr(e); set('clipsOn', false) } finally { setBusy(false) }
  }

  async function сохранить() {
    if (!есть || busy) return
    setBusy(true)
    try {
      const игра = gameOf('me' as unknown as string)?.name ?? null
      const r = await desktop().clipSave({ seconds: сек, name: clipName(new Date(), игра) })
      if (!r?.ok) throw new Error(r?.why || 'не вышло сохранить')
      toastOk('Клип сохранён: ' + String(r.path).split(/[\\/]/).pop())
    } catch (e) { toastErr(e) } finally { setBusy(false) }
  }

  return (
    <div className="clips-panel">
      <h2>Клипы с экрана</h2>
      <div className="pqs2-desc">
        Приложение всё время держит в памяти последние секунды экрана и никуда их не сохраняет.
        Случилось что-то интересное — нажимаешь, и эти секунды оказываются на диске. Заранее
        включать запись не нужно: она уже идёт.
      </div>

      {!есть && <div className="cset-hint">
        Запись экрана работает в настольном приложении Ponoi. В браузере её нет: там пришлось бы
        каждый раз заново спрашивать разрешение, и «уже записанного» не существовало бы.
      </div>}

      <div className="clip-main">
        <div className="clip-toggle">
          <div>
            <div className="clip-toggle-t">Держать последние секунды</div>
            <div className="clip-toggle-s">
              {state?.running ? 'Идёт запись — сохранить можно в любой момент' : 'Сейчас выключено'}
            </div>
          </div>
          <button className={'pqs-toggle' + (settings.clipsOn ? ' on' : '')}
            disabled={!есть || busy} onClick={() => void включить(!settings.clipsOn)}><span /></button>
        </div>

        <label className="clip-lbl">Сколько секунд хранить</label>
        <div className="clip-range">
          <input type="range" min={CLIP_MIN_SEC} max={CLIP_MAX_SEC} step={5} value={сек}
            disabled={!есть}
            onChange={e => set('clipSeconds', clampSeconds(Number(e.target.value)))} />
          <span className="clip-val">{clipLabel(сек)}</span>
        </div>
        <div className="clip-hint">
          От {CLIP_MIN_SEC} секунд до {clipLabel(CLIP_MAX_SEC)}. Чем больше — тем больше памяти
          занято постоянно: примерно {Math.round(кач.bitrate / 8 / 1024 / 1024 * сек)} МБ при
          выбранном качестве.
        </div>

        <label className="clip-lbl">Качество</label>
        <div className="clip-quality">
          {КАЧЕСТВО.map(k => (
            <button key={k.id} type="button" disabled={!есть}
              className={'clip-q' + (кач.id === k.id ? ' on' : '')}
              onClick={() => set('clipQuality', k.id)}>
              <span className="clip-q-n">{k.name}</span>
              <span className="clip-q-d">{k.height}p · {k.fps} кадров</span>
              <span className="clip-q-s">{k.note}</span>
            </button>
          ))}
        </div>

        <div className="clip-actions">
          <button className="pqs2-btn primary" disabled={!есть || !state?.running || busy}
            onClick={() => void сохранить()}>
            <Icon name="video" size={15} /> Сохранить последние {clipLabel(сек)}
          </button>
          <button className="pqs2-btn" disabled={!есть}
            onClick={() => desktop()?.clipFolder?.()}>
            <Icon name="folder" size={15} /> Открыть папку
          </button>
        </div>
        {state?.folder && <div className="clip-hint">Клипы лежат в {state.folder}</div>}
      </div>
    </div>
  )
}
