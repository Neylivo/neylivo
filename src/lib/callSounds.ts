// Звуки звонка + плавное нарастание громкости при подключении.
// Всё генерируется WebAudio-осцилляторами — никаких аудиофайлов в бандле.
// Один общий AudioContext на приложение: через master-гейн идёт звук
// участников звонка (это позволяет делать мягкий fade-in), короткие
// сигналы играются напрямую.

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
function play(notes: [number, number][], type: OscillatorType = 'sine', vol = 0.14) {
  try {
    const ctx = audioCtx()
    let t = ctx.currentTime + 0.01
    for (const [freq, dur] of notes) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02)
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
export function sndMute() { play([[329.63, 0.14]], 'sine', 0.12) }
/** Микрофон включён: тон выше ровно на кварту (A4) — сбалансированная пара. */
export function sndUnmute() { play([[440, 0.14]], 'sine', 0.12) }
