// v1.333.0: смена голоса в звонке — движок эффектов.
//
// Почему это здесь, а не в плагине. Плагин живёт в Web Worker'е: у него нет ни
// WebAudio, ни доступа к дорожке микрофона, и давать их — значит открыть плагину
// сам звук разговора. Поэтому эффекты делает приложение, а плагин (и кнопка в
// звонке) только выбирает, какой включить. Разрешение 'voice' у плагина значит
// ровно «переключать эффект», а не «слышать тебя».
//
// Все эффекты собраны из обычных узлов WebAudio и звучат честно тем, чем названы.
// Того, чего WebAudio не умеет без отдельной библиотеки (настоящий сдвиг высоты
// голоса — «сделать голос детским»), здесь нет: лучше пять работающих эффектов,
// чем шесть, из которых один притворяется.

export type VoiceEffect = 'none' | 'robot' | 'echo' | 'radio' | 'chorus' | 'deep'

export const VOICE_EFFECTS: { id: VoiceEffect; label: string; hint: string }[] = [
  { id: 'none',   label: 'Обычный',   hint: 'Твой голос как есть' },
  { id: 'robot',  label: 'Робот',     hint: 'Механический голос — кольцевая модуляция' },
  { id: 'echo',   label: 'Эхо',       hint: 'Голос с повтором, как в пустом зале' },
  { id: 'radio',  label: 'Рация',     hint: 'Узкая полоса и хрип, как в переговорном устройстве' },
  { id: 'chorus', label: 'Хор',       hint: 'Несколько расстроенных копий голоса разом' },
  { id: 'deep',   label: 'Подводный', hint: 'Глухо и плавающе, будто говоришь под водой' },
]

export const isVoiceEffect = (v: unknown): v is VoiceEffect =>
  VOICE_EFFECTS.some(e => e.id === v)

/**
 * Цепочка обработки микрофона. Выход (MediaStreamDestination) создаётся один раз
 * и живёт до конца звонка — поэтому смена эффекта не требует перепубликации
 * дорожки в LiveKit: собеседник ничего не переподключает, звук просто меняется.
 */
export class VoiceChain {
  readonly ctx: AudioContext
  private readonly src: MediaStreamAudioSourceNode
  private readonly dest: MediaStreamAudioDestinationNode
  private readonly out: GainNode          // общая громкость (ползунок «Громкость микрофона»)
  private inner: AudioNode[] = []         // узлы текущего эффекта — их и пересобираем
  private effect: VoiceEffect = 'none'

  constructor(track: MediaStreamTrack, gain = 1) {
    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    this.ctx = new Ctx()
    this.ctx.resume().catch(() => {})
    this.src = this.ctx.createMediaStreamSource(new MediaStream([track]))
    this.out = this.ctx.createGain()
    this.out.gain.value = gain
    this.dest = this.ctx.createMediaStreamDestination()
    this.out.connect(this.dest)
    this.build('none')
  }

  /** Дорожка, которую надо публиковать вместо исходной. */
  get track(): MediaStreamTrack | null { return this.dest.stream.getAudioTracks()[0] ?? null }

  get current(): VoiceEffect { return this.effect }

  setGain(pct: number) { this.out.gain.value = Math.max(0, Math.min(3, pct / 100)) }

  setEffect(e: VoiceEffect) {
    if (e === this.effect) return
    this.build(e)
  }

  close() {
    this.teardown()
    try { this.src.disconnect() } catch {}
    this.ctx.close().catch(() => {})
  }

  private teardown() {
    try { this.src.disconnect() } catch {}
    for (const n of this.inner) {
      try { (n as any).stop?.() } catch {}
      try { n.disconnect() } catch {}
    }
    this.inner = []
  }

  private build(e: VoiceEffect) {
    this.teardown()
    this.effect = e
    const c = this.ctx
    const keep = (n: AudioNode) => { this.inner.push(n); return n }

    switch (e) {
      case 'robot': {
        // Кольцевая модуляция: громкость голоса умножается на низкий тон. Даёт
        // тот самый «жестяной» голос, а не просто изменённый тембр.
        const ring = keep(c.createGain()) as GainNode
        ring.gain.value = 0                       // постоянную часть убираем, остаётся только модуляция
        const lfo = keep(c.createOscillator()) as OscillatorNode
        lfo.frequency.value = 50
        const depth = keep(c.createGain()) as GainNode
        depth.gain.value = 1
        lfo.connect(depth).connect(ring.gain)
        lfo.start()
        this.src.connect(ring).connect(this.out)
        break
      }
      case 'echo': {
        const dly = keep(c.createDelay(1)) as DelayNode
        dly.delayTime.value = 0.22
        const fb = keep(c.createGain()) as GainNode
        fb.gain.value = 0.35                      // затухает за несколько повторов, а не гудит вечно
        const wet = keep(c.createGain()) as GainNode
        wet.gain.value = 0.6
        dly.connect(fb).connect(dly)
        this.src.connect(dly).connect(wet).connect(this.out)
        this.src.connect(this.out)                // сухой голос остаётся, эхо добавляется поверх
        break
      }
      case 'radio': {
        const bp = keep(c.createBiquadFilter()) as BiquadFilterNode
        bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 3
        const shaper = keep(c.createWaveShaper()) as WaveShaperNode
        shaper.curve = distortionCurve(18)
        this.src.connect(bp).connect(shaper).connect(this.out)
        break
      }
      case 'chorus': {
        // Три копии с разной задержкой, каждая плавает своим LFO — голос звучит
        // так, будто говорят несколько человек сразу.
        this.src.connect(this.out)
        for (const [ms, rate] of [[18, 0.13], [27, 0.21], [35, 0.09]] as const) {
          const d = keep(c.createDelay(0.1)) as DelayNode
          d.delayTime.value = ms / 1000
          const lfo = keep(c.createOscillator()) as OscillatorNode
          lfo.frequency.value = rate
          const amt = keep(c.createGain()) as GainNode
          amt.gain.value = 0.004
          lfo.connect(amt).connect(d.delayTime)
          lfo.start()
          const g = keep(c.createGain()) as GainNode
          g.gain.value = 0.5
          this.src.connect(d).connect(g).connect(this.out)
        }
        break
      }
      case 'deep': {
        const lp = keep(c.createBiquadFilter()) as BiquadFilterNode
        lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 1
        const lfo = keep(c.createOscillator()) as OscillatorNode
        lfo.frequency.value = 0.25
        const amt = keep(c.createGain()) as GainNode
        amt.gain.value = 250
        lfo.connect(amt).connect(lp.frequency)
        lfo.start()
        this.src.connect(lp).connect(this.out)
        break
      }
      case 'none':
      default:
        this.src.connect(this.out)
        break
    }
  }
}

/** Кривая мягкого перегруза для «рации» — стандартная формула, без внешних либ. */
function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x))
  }
  return curve
}

// Выбранный эффект помнится между звонками — как выбранный микрофон. Настройка
// про это устройство, поэтому localStorage, а не user_prefs.
const KEY = 'ponoi_voice_fx'
export function savedVoiceEffect(): VoiceEffect {
  try {
    const v = localStorage.getItem(KEY)
    return isVoiceEffect(v) ? v : 'none'
  } catch { return 'none' }
}
export function rememberVoiceEffect(e: VoiceEffect) {
  try { localStorage.setItem(KEY, e) } catch {}
}

// ── Текущая цепочка звонка ────────────────────────────────────────────────
// Звонок в приложении один, поэтому и цепочка одна. Держим её здесь, чтобы до
// неё дотягивались и кнопка в звонке, и плагин с разрешением 'voice', не
// прокидывая ссылку через десяток компонентов.
let active: VoiceChain | null = null
const listeners = new Set<() => void>()

export function setActiveChain(c: VoiceChain | null) {
  active = c
  listeners.forEach(l => { try { l() } catch {} })
}
export function activeEffect(): VoiceEffect { return active?.current ?? 'none' }
/** @returns false — если звонка сейчас нет и менять нечего. */
export function setVoiceEffect(e: VoiceEffect): boolean {
  if (!active) return false
  active.setEffect(e)
  listeners.forEach(l => { try { l() } catch {} })
  return true
}
export function subscribeVoiceFx(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
