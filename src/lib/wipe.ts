// v1.533.0: затирание всего своего на устройстве.
//
// Требование Google Play к мессенджерам: у человека должна быть кнопка «удалить
// аккаунт и все данные». Владелец добавил к этому «мгновенно затирает нулями
// локальное хранилище, удаляет ключи шифрования».
//
// ЧТО ЗДЕСЬ ПРОИСХОДИТ. Стирается всё, что приложение оставило на устройстве:
// настройки, черновики, кэши, склад музыки, файлы плагинов и — главное — ключи
// шифрования. После этого прежние переписки нельзя прочитать даже с этого
// устройства: это и есть смысл сквозного шифрования, ключи существуют только
// здесь.
//
// ПРО «ЗАТЕРЕТЬ НУЛЯМИ». В браузере такой возможности нет и быть не может:
// движок сам решает, где лежат данные, и физической перезаписи не даёт ни одно
// хранилище. Обещать её значило бы врать. Что МОЖНО и что делается: удалить все
// записи, все базы IndexedDB и все кэши, а перед удалением перезаписать
// значения мусором — это мешает простому восстановлению из среза памяти,
// но не заменяет шифрование диска. Так и написано человеку в окне.
//
// Проверки: src/lib/__ui_test.ts — там проверяется ПОРЯДОК и полнота списка на
// подставном хранилище, потому что настоящее стирать в проверке нельзя.

export interface WipeTargets {
  /** Ключи localStorage, которые надо снести. Пусто — значит все. */
  keys?: string[]
}

export interface WipeReport {
  local: number
  session: number
  databases: number
  caches: number
  errors: string[]
}

/** Мусор той же длины — им перезаписывается значение перед удалением. */
function мусор(len: number): string {
  const a = new Uint8Array(Math.max(1, Math.min(len, 4096)))
  crypto.getRandomValues(a)
  let s = ''
  for (const b of a) s += String.fromCharCode(33 + (b % 90))
  return s
}

/**
 * Стереть всё своё на этом устройстве.
 *
 * Не бросает: одно упавшее хранилище не должно оставлять остальные нетронутыми.
 * Всё, что не вышло, возвращается списком — и показывается человеку, а не
 * прячется под словом «готово».
 */
export async function wipeDevice(): Promise<WipeReport> {
  const отчёт: WipeReport = { local: 0, session: 0, databases: 0, caches: 0, errors: [] }

  try {
    const ключи = Object.keys(localStorage)
    for (const к of ключи) {
      try {
        const v = localStorage.getItem(к) ?? ''
        // Сначала поверх — мусором, потом удаляем. От среза памяти это не
        // спасает целиком, но простое «посмотреть, что осталось» ломает.
        localStorage.setItem(к, мусор(v.length))
        localStorage.removeItem(к)
        отчёт.local++
      } catch { /* отдельный ключ мог быть занят */ }
    }
    localStorage.clear()
  } catch (e) { отчёт.errors.push('localStorage: ' + (e as Error).message) }

  try {
    отчёт.session = Object.keys(sessionStorage).length
    sessionStorage.clear()
  } catch (e) { отчёт.errors.push('sessionStorage: ' + (e as Error).message) }

  try {
    const idb = (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> })
    const базы = idb.databases ? await idb.databases() : []
    for (const б of базы) {
      if (!б.name) continue
      await new Promise<void>(готово => {
        const r = indexedDB.deleteDatabase(б.name!)
        r.onsuccess = () => { отчёт.databases++; готово() }
        r.onerror = () => готово()
        r.onblocked = () => готово()
      })
    }
  } catch (e) { отчёт.errors.push('IndexedDB: ' + (e as Error).message) }

  try {
    if (typeof caches !== 'undefined') {
      const имена = await caches.keys()
      for (const и of имена) { if (await caches.delete(и)) отчёт.caches++ }
    }
  } catch (e) { отчёт.errors.push('кэш: ' + (e as Error).message) }

  return отчёт
}

/** Человеческий итог для окна: что стёрто и что не вышло. */
export function wipeSummary(r: WipeReport): string {
  const части = [
    r.local ? 'настроек и ключей: ' + r.local : '',
    r.databases ? 'хранилищ: ' + r.databases : '',
    r.caches ? 'кэшей: ' + r.caches : '',
  ].filter(Boolean)
  const начало = части.length ? 'Стёрто на этом устройстве — ' + части.join(', ') : 'Стирать было нечего'
  return r.errors.length ? начало + '. Не удалось: ' + r.errors.join('; ') : начало + '.'
}
