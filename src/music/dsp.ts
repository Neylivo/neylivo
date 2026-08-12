// v1.442.0: обработка звука в NeyLivo Music — эквалайзер, «глухо» и эхо.
//
// Что это и чего это НЕ делает. Цепочка строится вокруг обычного <audio>, то
// есть работает для треков, которые приложение играет само (свои файлы и
// найденные копии). Для YouTube и SoundCloud звук идёт внутри чужого окна
// (iframe), и добраться до него нельзя ничем — там обработка не применяется, и
// об этом надо говорить прямо, а не делать вид, что переключатель работает
// везде.
//
// Здесь только описание цепочки и чистая математика полос. Сама сборка узлов —
// в attachDsp ниже, но и её можно позвать с поддельным контекстом: все узлы
// создаются через переданный AudioContext.

export type EqPreset = 'off' | 'bass' | 'vocal' | 'treble' | 'flat' | 'night'

export interface DspSettings {
  /** Пресет эквалайзера. */
  eq: EqPreset
  /** «Глухо» — будто из соседней комнаты. */
  muffle: boolean
  /** Эхо: 0 — выключено, 1 — комната, 2 — зал. */
  echo: 0 | 1 | 2
}

export const DSP_DEFAULT: DspSettings = { eq: 'off', muffle: false, echo: 0 }

/** Полосы эквалайзера: середины частот. Три — их слышно и их легко объяснить. */
export const EQ_BANDS = [120, 1000, 6000] as const

/** Насколько поднять или опустить каждую полосу, дБ. */
export const EQ_PRESETS: Record<EqPreset, [number, number, number]> = {
  off: [0, 0, 0],
  flat: [0, 0, 0],
  // Низ + верх, середина чуть ниже: то, что люди зовут «бас».
  bass: [7, -1, 2],
  // Голос живёт в середине — поднимаем её, низ убираем, чтобы не гудело.
  vocal: [-3, 5, 1],
  treble: [-2, 0, 6],
  // «Ночь»: тише всё, но разборчивее середина — чтобы слушать негромко.
  night: [-6, 3, -2],
}

export const EQ_LABEL: Record<EqPreset, string> = {
  off: 'Выключен', flat: 'Ровный', bass: 'Басы', vocal: 'Голос', treble: 'Верхи', night: 'Ночной',
}

/** Частота среза «глухого» звука: выше неё почти ничего не остаётся. */
export const MUFFLE_HZ = 900

/** Эхо: задержка и сколько от неё возвращается обратно. */
export function echoParams(level: 0 | 1 | 2): { delay: number; feedback: number; wet: number } {
  if (level === 1) return { delay: 0.18, feedback: 0.25, wet: 0.22 }   // комната
  if (level === 2) return { delay: 0.32, feedback: 0.42, wet: 0.34 }   // зал
  return { delay: 0, feedback: 0, wet: 0 }
}

/** Разобрать сохранённое, не веря ему на слово. */
export function readDsp(raw: string | null): DspSettings {
  try {
    const o = JSON.parse(raw || '{}')
    const eq: EqPreset = (Object.keys(EQ_PRESETS) as EqPreset[]).includes(o.eq) ? o.eq : 'off'
    const echo = o.echo === 1 || o.echo === 2 ? o.echo : 0
    return { eq, muffle: !!o.muffle, echo }
  } catch { return { ...DSP_DEFAULT } }
}

/** Что-нибудь вообще включено? Если нет — цепочку можно не строить. */
export const dspActive = (d: DspSettings): boolean =>
  d.muffle || d.echo > 0 || (d.eq !== 'off' && d.eq !== 'flat')

/** Человеческая подпись для настроек: «Басы · глухо · эхо (зал)». */
export function dspSummary(d: DspSettings): string {
  const parts: string[] = []
  if (d.eq !== 'off' && d.eq !== 'flat') parts.push(EQ_LABEL[d.eq])
  if (d.muffle) parts.push('глухо')
  if (d.echo) parts.push('эхо (' + (d.echo === 1 ? 'комната' : 'зал') + ')')
  return parts.length ? parts.join(' · ') : 'Без обработки'
}

export interface DspChain {
  /** Куда подключать источник. */
  input: AudioNode
  /** Поменять настройки на лету, ничего не пересоздавая. */
  apply: (d: DspSettings) => void
  /** Разобрать цепочку. */
  dispose: () => void
}

/**
 * Собрать цепочку между источником и выходом.
 *
 * Узлы создаются один раз и дальше только перенастраиваются: пересборка на
 * каждое движение ползунка даёт щелчки в звуке, а щелчок в наушниках — это
 * больно и слышно всем, кто рядом.
 */
export function buildDsp(ctx: AudioContext, out: AudioNode): DspChain {
  const input = ctx.createGain()
  const eqs = EQ_BANDS.map((hz, i) => {
    const f = ctx.createBiquadFilter()
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
    f.frequency.value = hz
    if (f.type === 'peaking') f.Q.value = 0.9
    f.gain.value = 0
    return f
  })
  const muffle = ctx.createBiquadFilter()
  muffle.type = 'lowpass'
  muffle.frequency.value = 20000            // выключено = пропускаем всё
  const delay = ctx.createDelay(1)
  const feedback = ctx.createGain(); feedback.gain.value = 0
  const wet = ctx.createGain(); wet.gain.value = 0

  // Прямой путь: вход → эквалайзер → «глухо» → выход.
  let node: AudioNode = input
  for (const f of eqs) { node.connect(f); node = f }
  node.connect(muffle)
  muffle.connect(out)
  // Обратный путь эха — параллельно, чтобы сухой звук не пропадал.
  muffle.connect(delay)
  delay.connect(feedback)
  feedback.connect(delay)
  delay.connect(wet)
  wet.connect(out)

  const apply = (d: DspSettings) => {
    const gains = EQ_PRESETS[d.eq] ?? EQ_PRESETS.off
    eqs.forEach((f, i) => { f.gain.value = gains[i] ?? 0 })
    muffle.frequency.value = d.muffle ? MUFFLE_HZ : 20000
    const e = echoParams(d.echo)
    delay.delayTime.value = e.delay || 0.001
    feedback.gain.value = e.feedback
    wet.gain.value = e.wet
  }

  const dispose = () => {
    try {
      input.disconnect(); eqs.forEach(f => f.disconnect())
      muffle.disconnect(); delay.disconnect(); feedback.disconnect(); wet.disconnect()
    } catch { /* контекст уже закрыт */ }
  }

  return { input, apply, dispose }
}
