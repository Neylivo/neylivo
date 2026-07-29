// v1.423.0: сколько песни прошло и сколько осталось — для активности «Слушает».
//
// Зачем отдельным файлом. Показывать это надо в трёх разных местах (мини-профиль,
// список участников, список друзей), а считается оно нетривиально: присутствие
// публикуется не каждую секунду, а раз в пятнадцать, поэтому позицию приходится
// досчитывать локально от момента публикации. Один расчёт на всех — иначе в
// одном месте полоса поедет, в другом нет, и разошлись бы они не сразу.
//
// Раньше в мини-профиле стоял просто тикающий счётчик «сколько играет», без
// длины трека и без полосы: со стороны нельзя было понять ни на каком месте
// песня, ни сколько её осталось. У себя в плеере это видно, у других — нет.

/** Ровно те поля присутствия, которые нужны для расчёта (см. Listening). */
export interface ListenPos {
  /** Позиция трека в секундах на момент публикации. */
  pos: number
  /** Вся длина трека, если известна. Без неё полосу рисовать нечем. */
  dur?: number
  /** Когда это было опубликовано (Date.now() у того, кто слушает). */
  at: number
}

/**
 * Где песня сейчас. Досчитываем от опубликованной позиции.
 *
 * Часы у людей разные, и разница между ними попадает прямо в этот расчёт.
 * Поэтому: назад не уходим никогда и за длину трека не выходим — иначе полоса
 * то прыгала бы к нулю, то упиралась в конец на середине песни.
 */
export function livePos(l: ListenPos, now: number): number {
  const base = Number.isFinite(l.pos) && l.pos > 0 ? l.pos : 0
  const passed = Math.max(0, (now - l.at) / 1000)
  const t = base + passed
  const dur = l.dur && Number.isFinite(l.dur) && l.dur > 0 ? l.dur : 0
  if (!dur) return t
  return Math.min(t, dur)
}

/** Сколько осталось до конца. Нет длины — нет и ответа. */
export function leftOver(l: ListenPos, now: number): number | null {
  const dur = l.dur && Number.isFinite(l.dur) && l.dur > 0 ? l.dur : 0
  if (!dur) return null
  return Math.max(0, dur - livePos(l, now))
}

/** Заполнение полосы, 0–100. Без длины трека полосы нет вовсе. */
export function listenPct(l: ListenPos, now: number): number | null {
  const dur = l.dur && Number.isFinite(l.dur) && l.dur > 0 ? l.dur : 0
  if (!dur) return null
  return Math.max(0, Math.min(100, (livePos(l, now) / dur) * 100))
}

/** «1:23» и «1:02:03» — как в самом плеере. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? h + ':' : '') + mm + ':' + String(ss).padStart(2, '0')
}
