// v1.333.0: смена голоса в звонке — список эффектов и текущий выбор.
//
// v1.337.0: сам движок (класс VoiceChain) переехал в voiceFxChain.ts. Он нужен
// только во время звонка, а звонок и так грузится лениво; список же спрашивает
// плагинный API, который живёт с первой секунды. Пока это было одним файлом,
// цепочка WebAudio ехала в стартовый бандл ни за чем.
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
// Тип берём только как тип (import type) — иначе модуль с WebAudio снова
// оказался бы в стартовом бандле, ради чего разделение и делалось.
// Звонок в приложении один, поэтому и цепочка одна. Держим её здесь, чтобы до
// неё дотягивались и кнопка в звонке, и плагин с разрешением 'voice', не
// прокидывая ссылку через десяток компонентов.
let active: { current: VoiceEffect; setEffect: (e: VoiceEffect) => void } | null = null
const listeners = new Set<() => void>()

export function setActiveChain(c: { current: VoiceEffect; setEffect: (e: VoiceEffect) => void } | null) {
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
