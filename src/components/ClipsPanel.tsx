import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { confirmUi } from '../lib/confirm'
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

interface ClipFile { name: string; path: string; bytes: number; at: number }

const desktop = (): any => (window as any).ponoiDesktop

export function ClipsPanel() {
  const { settings, set } = useSettings()
  const { gameOf } = usePresence()
  const [state, setState] = useState<{ running: boolean; folder: string; hotkey?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [clips, setClips] = useState<ClipFile[] | null>(null)
  const [смотрим, setСмотрим] = useState<ClipFile | null>(null)

  const есть = !!desktop()?.clipStart
  const сек = clampSeconds(settings.clipSeconds ?? 30)
  const кач = КАЧЕСТВО.find(k => k.id === (settings.clipQuality || 'mid')) ?? КАЧЕСТВО[1]

  const обновитьСписок = () => {
    if (!есть) return
    void desktop().clipList().then((l: ClipFile[]) => setClips(l || []))
  }

  useEffect(() => {
    if (!есть) return
    let жив = true
    void desktop().clipState().then((s: any) => { if (жив) setState(s) })
    void desktop().clipList().then((l: ClipFile[]) => { if (жив) setClips(l || []) })
    // v1.539.0: клип, сохранённый по F7, должен появиться в списке сам.
    // Иначе человек нажимает клавишу, ничего не видит и жмёт ещё раз — получая
    // второй клип того же места.
    const off = desktop().onClipSaved?.((r: { ok: boolean; path?: string; why?: string }) => {
      if (!жив) return
      if (r?.ok) { toastOk('Клип сохранён: ' + String(r.path).split(/[\\/]/).pop()); обновитьСписок() }
      else toastErr(r?.why || 'не вышло сохранить клип')
    })
    return () => { жив = false; off?.() }
  }, [есть])

  // Главному процессу нужны настройки для F7: он сохраняет клип, когда окна
  // может и не быть на экране. Держать их второй копией там значило бы получить
  // «сохранил 30 секунд, а в настройках стояло 90».
  //
  // Отсюда уходит длина и название игры, но не готовое имя файла: имя должно
  // получить время НАЖАТИЯ, а не время этой отправки, иначе второй клип по F7
  // затрёт первый.
  const игра = gameOf('me' as unknown as string)?.name ?? ''
  useEffect(() => {
    if (!есть) return
    void desktop().clipHotkey?.({ seconds: сек, game: игра })
  }, [есть, сек, игра])

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
      const r = await desktop().clipSave({ seconds: сек, name: clipName(new Date(), игра) })
      if (!r?.ok) throw new Error(r?.why || 'не вышло сохранить')
      toastOk('Клип сохранён: ' + String(r.path).split(/[\\/]/).pop())
      обновитьСписок()
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
        {/* Про клавишу говорим только если она правда наша: F7 мог занять кто-то
            другой, и тогда обещание в настройках было бы обманом. */}
        <div className="clip-hint">
          {state?.hotkey
            ? 'Или нажми ' + state.hotkey + ' — работает поверх игры, переключаться в Ponoi не надо.'
            : 'Горячую клавишу F7 занимает другая программа, поэтому сохранять можно только отсюда.'}
        </div>
        {state?.folder && <div className="clip-hint">Клипы лежат в {state.folder}</div>}
      </div>

      {есть && <>
        <div className="pqs-sec-t">Записанные клипы</div>
        {clips === null && <div className="cset-hint">Смотрю папку…</div>}
        {clips && clips.length === 0 && <div className="cset-hint">
          Пока ни одного. {state?.hotkey ? 'Нажми ' + state.hotkey + ' во время игры' : 'Нажми кнопку выше'} — сюда
          попадут последние {clipLabel(сек)}.
        </div>}
        <div className="clip-list">
          {(clips ?? []).map(c => (
            <div key={c.name} className="clip-item">
              <button type="button" className="clip-item-main" onClick={() => setСмотрим(c)}>
                <span className="clip-item-play"><Icon name="video" size={18} /></span>
                <span className="clip-item-meta">
                  <span className="clip-item-nm">{c.name.replace(/\.webm$/i, '')}</span>
                  <span className="clip-item-sub">
                    {new Date(c.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{(c.bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ
                  </span>
                </span>
              </button>
              <button className="pqs2-btn" title="Показать в папке"
                onClick={() => desktop().clipReveal(c.name)}><Icon name="folder" size={15} /></button>
              <button className="pqs2-btn danger" title="Удалить"
                onClick={async () => {
                  if (!await confirmUi('Удалить клип «' + c.name + '»?', { okText: 'Удалить', danger: true })) return
                  const r = await desktop().clipRemove(c.name)
                  if (r?.ok) { toastOk('Клип удалён'); обновитьСписок() } else toastErr(r?.why || 'не вышло удалить')
                }}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      </>}

      {смотрим && <Portal><div className="modal-overlay" onClick={() => setСмотрим(null)}>
        <div className="modal clip-view" onClick={e => e.stopPropagation()}>
          <button className="modal-x" onClick={() => setСмотрим(null)}><Icon name="close" size={18} /></button>
          <div className="modal-title" style={{ margin: 0 }}>{смотрим.name.replace(/\.webm$/i, '')}</div>
          {/* Просмотр прямо здесь: открывать проводник ради «глянуть, что попало
              в клип» — это лишний шаг ровно там, где человек торопится. */}
          <video className="clip-video" src={'file:///' + смотрим.path.replace(/\\/g, '/')}
            controls autoPlay />
          <div className="lyr-btns">
            <button className="pqs2-btn" onClick={() => desktop().clipReveal(смотрим.name)}>
              <Icon name="folder" size={15} /> Показать в папке
            </button>
            <button className="pqs2-btn ghost" onClick={() => setСмотрим(null)}>Закрыть</button>
          </div>
        </div>
      </div></Portal>}
    </div>
  )
}
