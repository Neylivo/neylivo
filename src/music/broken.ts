// v1.414.0: треки, которые не играют.
//
// Что происходит на деле. Ссылка протухает, видео закрывают для встраивания,
// файл удаляют из хранилища — и в общем складе остаётся запись, на которой
// плеер спотыкается: тишина, а человек думает, что сломалось приложение.
//
// Почему нельзя просто удалять при первом отказе. Трекотека общая. Отказ
// бывает и от разорванной сети, и от того, что сервис прилёг на минуту, и от
// региональной блокировки у ОДНОГО слушателя. Удалив по такому случаю, мы
// стёрли бы у всех работающий трек — и обратно его не вернуть.
//
// Поэтому правило такое:
//   • считаем отказы по каждому треку отдельно, на своём устройстве;
//   • успешное воспроизведение обнуляет счёт — значит, дело было в сети;
//   • после двух отказов подряд трек считается сломанным: очередь его
//     обходит, а в складе он помечен и не притворяется рабочим;
//   • из общего склада он удаляется только у того, кто его выложил (чужой
//     нам и база не даст удалить), и только когда сломан.

const KEY = 'ponoi_mus_broken_v1'
/** Сколько отказов подряд считаем случайностью. */
export const BROKEN_AFTER = 2

type Counts = Record<string, number>

function load(): Counts {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
function save(c: Counts) {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* переполнено */ }
}

/** Чистая часть: что делать со счётчиками. Отдельно — чтобы проверять. */
export function countAfterFail(counts: Counts, id: string): Counts {
  if (!id) return counts
  return { ...counts, [id]: (counts[id] ?? 0) + 1 }
}
export function countAfterOk(counts: Counts, id: string): Counts {
  if (!id || !(id in counts)) return counts
  const n = { ...counts }
  delete n[id]
  return n
}
export function brokenIn(counts: Counts, id: string): boolean {
  return (counts[id] ?? 0) >= BROKEN_AFTER
}

/** Трек не заиграл. Возвращает, сколько отказов накопилось. */
export function markFailed(id: string): number {
  const c = countAfterFail(load(), id)
  save(c)
  return c[id] ?? 0
}

/** Трек заиграл — прошлые отказы были случайностью. */
export function markOk(id: string) {
  const before = load()
  if (!(id in before)) return
  save(countAfterOk(before, id))
}

/** Считается ли трек сломанным. */
export function isBroken(id: string): boolean {
  return brokenIn(load(), id)
}

/** Забыть про трек (удалили из склада или человек попросил попробовать снова). */
export function forgetBroken(id: string) {
  save(countAfterOk(load(), id))
}

/** Сколько треков сейчас числятся сломанными — для подписи в складе. */
export function brokenCount(): number {
  const c = load()
  return Object.keys(c).filter(id => brokenIn(c, id)).length
}
