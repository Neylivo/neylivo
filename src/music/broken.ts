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

// ── Видео, которое нельзя встроить (v1.420.0) ──────────────────────────────
//
// Отдельный список, и вот почему это НЕ то же самое, что «сломан».
//
// Официальные клипы — как раз те, что человек ищет первым делом, — владелец
// часто закрывает для встраивания: на самом YouTube они играют прекрасно, а в
// чужом окне отказываются, и YouTube отвечает об этом кодом 101 или 150. Раньше
// такой отказ шёл в общий счётчик отказов: «трек не играет — пробую следующий»,
// а на втором заходе СВОЙ трек ещё и удалялся из общей Трекотеки. То есть
// рабочая песня пропадала у всех из-за запрета на встраивание.
//
// Правильный разбор другой: это не поломка трека, это запрет на встраивание.
// Отказ такой окончательный (пересчитывать нечего, сеть тут ни при чём), поэтому
// хватает одного раза, и трек не удаляется никогда. Дальше мы ищем ту же запись
// там, где её играть можно, — а если не нашли, честно говорим и обходим.
const EMBED_KEY = 'ponoi_mus_noembed_v1'

function loadNoEmbed(): Record<string, true> {
  try {
    const v = JSON.parse(localStorage.getItem(EMBED_KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

/** Коды YouTube 101 и 150 значат ровно одно: владелец запретил встраивание. */
export function isEmbedDeniedCode(code: unknown): boolean {
  const n = Number(code)
  return n === 101 || n === 150
}

export function markNoEmbed(id: string) {
  if (!id) return
  const all = loadNoEmbed()
  all[id] = true
  try { localStorage.setItem(EMBED_KEY, JSON.stringify(all)) } catch { /* переполнено */ }
}

export function isNoEmbed(id: string): boolean {
  return !!id && !!loadNoEmbed()[id]
}

// ── Трек встал (v1.421.0) ──────────────────────────────────────────────────
//
// Решение вынесено в чистые функции нарочно: живой виджет SoundCloud я проверить
// не могу (нужен аккаунт и закрытый трек), а ошибиться тут значит либо
// перескакивать рабочие треки, либо оставлять плеер стоять — то самое «слушаешь,
// и резко пауза».

/** Сколько молчания считаем поломкой, а не задержкой сети. */
export const SILENCE_MS = 15000

/**
 * Чья это пауза.
 *
 * `ours` — человек нажал кнопку: наше состояние уже выключено, виджет лишь
 * догоняет. `notStarted` — виджет встал, не начав играть: трек нам не отдали.
 * `retry` — встал посреди песни, это бывает от сети, и один раз стоит
 * попробовать продолжить. `stuck` — встал снова: дело в самом треке.
 */
export function pauseKind(weWantPlay: boolean, posSec: number, resumeTries: number): 'ours' | 'notStarted' | 'retry' | 'stuck' {
  if (!weWantPlay) return 'ours'
  if (!(posSec >= 1)) return 'notStarted'
  return resumeTries < 1 ? 'retry' : 'stuck'
}

/** Пора ли считать, что трек не играет: позиция не двигалась слишком долго. */
export function silenceStuck(lastMoveAt: number, now: number, playing: boolean): boolean {
  if (!playing) return false
  return now - lastMoveAt >= SILENCE_MS
}

/**
 * Сервис лёг, а не треки сломались (v1.435.0).
 *
 * Что принёс владелец: залил плейлист на 77 треков — и по КАЖДОМУ посыпалось
 * «SoundCloud не начал играть этот трек — ищу копию», следом «можно слушать
 * только на самом сервисе — пропускаю», и так по всему списку.
 *
 * Разбор. Один неигравший трек — это, скорее всего, трек. Пять подряд разных
 * треков за полминуты — это уже не они: сервис не отвечает, или он придержал
 * нас за десятки запросов подряд (а при заливке плейлиста их именно столько).
 * Разница принципиальная, потому что каждый такой отказ ПОМЕЧАЛ трек в памяти
 * устройства: «не встраивается». Пометка переживает перезапуск, и волна потом
 * обходит эти треки всегда — то есть один сбой сервиса портил плейлист
 * насовсем. Вот это и выглядит как «абсолютно все песни сломались».
 *
 * Поэтому: считаем отказы по РАЗНЫМ трекам в окне времени, и как только их
 * набирается достаточно — останавливаемся, говорим один раз про сервис и
 * ничего не помечаем.
 */
export const SOURCE_DOWN_FAILS = 5
export const SOURCE_DOWN_MS = 30_000

export interface FailMark { id: string; at: number }

/** Оставить только свежие отказы (окно SOURCE_DOWN_MS) и дописать новый. */
export function pushFail(list: FailMark[], id: string, now: number): FailMark[] {
  return [...list.filter(f => now - f.at < SOURCE_DOWN_MS && f.id !== id), { id, at: now }]
}

/** Похоже ли, что лёг сам сервис, а не треки. */
export function sourceDown(list: FailMark[], now: number): boolean {
  const fresh = list.filter(f => now - f.at < SOURCE_DOWN_MS)
  const ids = new Set(fresh.map(f => f.id))
  return ids.size >= SOURCE_DOWN_FAILS
}

export function forgetNoEmbed(id: string) {
  const all = loadNoEmbed()
  if (!(id in all)) return
  delete all[id]
  try { localStorage.setItem(EMBED_KEY, JSON.stringify(all)) } catch { /* переполнено */ }
}
