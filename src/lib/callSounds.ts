// Звуки звонка + плавное нарастание громкости при подключении.
// По умолчанию всё генерируется WebAudio-осцилляторами — никаких аудиофайлов в
// бандле. v1.166.0: рингтон и гудки можно заменить своим файлом (Настройки ->
// Звуки) — тогда вместо мелодии из нот крутится загруженный <audio>, громкость
// та же, что у динамиков в звонке.
// Один общий AudioContext на приложение: через master-гейн идёт звук
// участников звонка (это позволяет делать мягкий fade-in), короткие
// сигналы играются напрямую.
import { getSettings } from './settings'
import { getUserPrefs } from './userPrefs'

let _ctx: AudioContext | null = null
export function audioCtx(): AudioContext {
  if (!_ctx) _ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  if (_ctx.state === 'suspended') _ctx.resume()
  return _ctx
}

let _master: GainNode | null = null
/** Общий гейн для голоса участников — сквозь него делается fade-in звонка. */
export function master(): GainNode {
  const ctx = audioCtx()
  if (!_master) { _master = ctx.createGain(); _master.gain.value = 1; _master.connect(ctx.destination) }
  return _master
}

/** Плавное нарастание громкости при подключении к звонку — не бьёт по ушам. */
export function fadeInCall(sec = 1.4) {
  const ctx = audioCtx()
  const m = master()
  const t = ctx.currentTime
  m.gain.cancelScheduledValues(t)
  m.gain.setValueAtTime(0.0001, t)
  m.gain.exponentialRampToValueAtTime(1, t + sec)
}

/** Короткая мелодия из нот: [частота, длительность в сек][]. */
// v1.199.0: раньше vol тут игнорировал «Громкость динамика» (её учитывал только
// свой загруженный файл через loopCustom) и базовые значения были слишком тихими.
function play(notes: [number, number][], type: OscillatorType = 'sine', vol = 0.32) {
  try {
    const ctx = audioCtx()
    const v = vol * (getSettings().spkVol / 100)
    let t = ctx.currentTime + 0.01
    for (const [freq, dur] of notes) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(v, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g); g.connect(ctx.destination)
      o.start(t); o.stop(t + dur + 0.02)
      t += dur * 0.9
    }
  } catch { /* нет WebAudio — тишина, не страшно */ }
}

/** Участник присоединился: два восходящих тона (G4 → C5). */
export function sndJoin() { play([[392, 0.16], [523.25, 0.2]]) }
/** Участник вышел: два нисходящих тона (C5 → G4). */
export function sndLeave() { play([[523.25, 0.16], [392, 0.2]]) }
/** Микрофон выключен: низкий тон (E4). */
export function sndMute() { play([[329.63, 0.14]], 'sine', 0.28) }
/** Микрофон включён: тон выше ровно на кварту (A4) — сбалансированная пара. */
export function sndUnmute() { play([[440, 0.14]], 'sine', 0.28) }

// Свой файл вместо встроенной мелодии — крутится в цикле, громкость как у
// динамиков звонка (settings.spkVol).
function loopCustom(url: string): HTMLAudioElement {
  const a = new Audio(url)
  a.loop = true
  a.volume = getSettings().spkVol / 100
  a.play().catch(() => {})
  return a
}

// ---- v1.30.0: рингтон входящего и гудки исходящего звонка (как в Discord) ----
let ringInt: number | null = null
let ringAudio: HTMLAudioElement | null = null
/** Входящий звонок: зовущая мелодия, крутится по кругу, пока не ответили. */
export function startRingtone() {
  if (ringInt !== null || ringAudio) return
  const url = getUserPrefs().account.ringtoneUrl
  if (url) { ringAudio = loopCustom(url); return }
  const one = () => play([[659.25, 0.16], [523.25, 0.16], [659.25, 0.16], [523.25, 0.16], [783.99, 0.34]], 'sine', 0.34)
  one(); ringInt = window.setInterval(one, 2600)
}
export function stopRingtone() {
  if (ringInt !== null) { window.clearInterval(ringInt); ringInt = null }
  if (ringAudio) { ringAudio.pause(); ringAudio = null }
}

let backInt: number | null = null
let backAudio: HTMLAudioElement | null = null
/** Исходящий звонок: длинный мягкий гудок раз в ~3 секунды. */
export function startRingback() {
  if (backInt !== null || backAudio) return
  const url = getUserPrefs().account.ringbackUrl
  if (url) { backAudio = loopCustom(url); return }
  const one = () => play([[440, 0.8]], 'sine', 0.16)
  one(); backInt = window.setInterval(one, 3000)
}
export function stopRingback() {
  if (backInt !== null) { window.clearInterval(backInt); backInt = null }
  if (backAudio) { backAudio.pause(); backAudio = null }
}
