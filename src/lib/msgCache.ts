
// v1.103.0: кэш мгновенного открытия чатов.
// Проблема: при каждом переключении диалога/канала лента ждала сетевой запрос —
// заметная пауза, особенно на телефоне. Решение: последние сообщения каждого
// открытого чата держим в памяти; повторное открытие рисует их МГНОВЕННО,
// а сеть освежает список в фоне (как это делает Discord).
// Ничего не удаляем и не меняем в логике загрузки — только показываем кэш первее сети.

const msgs = new Map<string, any[]>()

export function getMsgs(key: string): any[] | undefined { return msgs.get(key) }

export function putMsgs(key: string, list: any[]) {
  if (!list.length) return
  // Черновики (_tmp) в кэш не пишем — при повторном открытии их заменит сеть.
  msgs.set(key, list.filter(m => !(m as any)._tmp).slice(-100))
}

// Кэш id диалога по другу: экономит целый сетевой запрос (openThread) при повторном
// открытии ЛС — сообщения начинают грузиться сразу.
const TKEY = 'ponoi_dm_tid_'
export function getCachedThreadId(friendId: string): string | null {
  try { return localStorage.getItem(TKEY + friendId) } catch { return null }
}
export function rememberThreadId(friendId: string, tid: string) {
  try { localStorage.setItem(TKEY + friendId, tid) } catch {}
}
