// v1.438.0: что я решил про конкретного человека — громкость, «заглушить»,
// «не показывать видео».
//
// Зачем отдельным файлом. Всё это жило внутри CallRoom и потому существовало
// только в звонке: чтобы убавить кому-то громкость, надо было сначала созвониться
// с ним. В Discord это лежит в меню человека в списке — и там же остаётся, когда
// звонка нет. Владелец прислал ровно этот снимок с просьбой добавить «самое
// важное».
//
// Заодно чинится вторая вещь: «Отключить видео» жило в памяти вкладки и
// забывалось при перезапуске — то есть решение человека молча отменялось.

const VOL_KEY = (id: string) => 'ponoi_vol_' + id
const VIDOFF_KEY = 'ponoi_vidoff_v1'

const listeners = new Set<() => void>()
export function subscribePeerPrefs(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
const notify = () => listeners.forEach(f => { try { f() } catch {} })

// ── Громкость ────────────────────────────────────────────────────────────────
// Узлы громкости живут в звонке; здесь только реестр, чтобы менять их из любого
// места, включая меню в списке диалогов.
const gainReg = new Map<string, Set<GainNode>>()

export function registerGain(identity: string, g: GainNode): () => void {
  let set = gainReg.get(identity)
  if (!set) { set = new Set(); gainReg.set(identity, set) }
  set.add(g)
  g.gain.value = getPeerVolume(identity) / 100
  return () => { set!.delete(g); if (!set!.size) gainReg.delete(identity) }
}

export function getPeerVolume(identity: string): number {
  const v = parseInt(localStorage.getItem(VOL_KEY(identity)) || '100', 10)
  return isNaN(v) ? 100 : Math.max(0, Math.min(200, v))
}

export function setPeerVolume(identity: string, v: number) {
  const val = Math.max(0, Math.min(200, Math.round(v)))
  try { localStorage.setItem(VOL_KEY(identity), String(val)) } catch { /* переполнено */ }
  gainReg.get(identity)?.forEach(g => { g.gain.value = val / 100 })
  notify()
}

/** «Заглушен» — это громкость в ноль, а не отдельный признак: иначе их два. */
export const isPeerMuted = (identity: string): boolean => getPeerVolume(identity) === 0

/**
 * Переключить «заглушить». Возвращаемся к прежней громкости, а не к ста
 * процентам: человек мог поставить 40 — вернуть ему 100 значит решить за него.
 */
export function togglePeerMuted(identity: string) {
  const cur = getPeerVolume(identity)
  if (cur > 0) {
    try { localStorage.setItem('ponoi_vol_prev_' + identity, String(cur)) } catch { /* переполнено */ }
    setPeerVolume(identity, 0)
    return
  }
  const prev = parseInt(localStorage.getItem('ponoi_vol_prev_' + identity) || '100', 10)
  setPeerVolume(identity, isNaN(prev) || prev <= 0 ? 100 : prev)
}

// ── Видео ────────────────────────────────────────────────────────────────────
function loadHidden(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(VIDOFF_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])
  } catch { return new Set() }
}
let hidden: Set<string> | null = null
const hiddenSet = (): Set<string> => (hidden ??= loadHidden())

export function isVideoHidden(identity: string): boolean { return hiddenSet().has(identity) }

export function toggleVideoHidden(identity: string) {
  const s = hiddenSet()
  if (s.has(identity)) s.delete(identity); else s.add(identity)
  try { localStorage.setItem(VIDOFF_KEY, JSON.stringify([...s])) } catch { /* переполнено */ }
  notify()
}

/** Подпись для меню: «Заглушен · 40%» — чтобы не открывать ползунок ради проверки. */
export function peerSoundLabel(identity: string): string {
  const v = getPeerVolume(identity)
  return v === 0 ? 'Заглушен' : v === 100 ? 'Обычная громкость' : v + '%'
}
