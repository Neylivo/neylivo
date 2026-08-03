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

// ── Чужая демонстрация экрана (v1.440.0) ─────────────────────────────────────
// Разделены нарочно: чаще всего нужно именно заглушить звук чужой демки (там
// играет музыка или стреляют), а картинку оставить. В Discord это тоже две
// разные вещи, и до сих пор у нас не было ни одной из них: демонстрация шла как
// есть, и единственным способом от неё избавиться было выйти из звонка.
const SHARE_OFF_KEY = 'ponoi_share_off_v1'
const SHARE_MUTE_KEY = 'ponoi_share_mute_v1'

function loadSet(key: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])
  } catch { return new Set() }
}
let shareOff: Set<string> | null = null
let shareMute: Set<string> | null = null
const offSet = (): Set<string> => (shareOff ??= loadSet(SHARE_OFF_KEY))
const muteSet = (): Set<string> => (shareMute ??= loadSet(SHARE_MUTE_KEY))

function toggleIn(s: Set<string>, key: string, id: string) {
  if (s.has(id)) s.delete(id); else s.add(id)
  try { localStorage.setItem(key, JSON.stringify([...s])) } catch { /* переполнено */ }
  notify()
}

/** Не показывать демонстрацию этого человека — только у себя. */
export const isShareHidden = (identity: string): boolean => offSet().has(identity)
export const toggleShareHidden = (identity: string) => toggleIn(offSet(), SHARE_OFF_KEY, identity)

/** Заглушить звук его демонстрации, оставив голос. */
export const isShareMuted = (identity: string): boolean => muteSet().has(identity)
export const toggleShareMuted = (identity: string) => toggleIn(muteSet(), SHARE_MUTE_KEY, identity)

/** Подпись для меню: «Заглушен · 40%» — чтобы не открывать ползунок ради проверки. */
export function peerSoundLabel(identity: string): string {
  const v = getPeerVolume(identity)
  return v === 0 ? 'Заглушен' : v === 100 ? 'Обычная громкость' : v + '%'
}
