// v1.442.0: вход не теряется при обновлении приложения.
//
// Что было. Клиент Supabase хранил сессию в localStorage по умолчанию — и это
// работает ровно до тех пор, пока WebView не почистит своё хранилище. На
// Android так бывает: система вправе стереть данные приложения при нехватке
// места, а при некоторых обновлениях меняется origin (адрес, по которому
// открыт WebView), и localStorage у нового адреса просто ДРУГОЙ. Со стороны это
// «после обновления выкинуло из аккаунта».
//
// Здесь: хранилище с двумя опорами. Пишем и в localStorage (быстро, синхронно),
// и в запасную полку, которая переживает больше. Читаем сначала из localStorage,
// а если там пусто — поднимаем из запасной и кладём обратно.
//
// Запасная полка — Capacitor Preferences, если приложение собрано под Android
// (модуль подтягивается лениво и его отсутствие ничего не ломает). В браузере
// запасной полки нет, и это честно: там и терять нечего, кроме той же вкладки.

type Backup = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }

let backupPromise: Promise<Backup | null> | null = null
function backup(): Promise<Backup | null> {
  if (!backupPromise) {
    backupPromise = (async () => {
      // Есть ли вообще нативная часть. В браузере — нет, и это не ошибка.
      if (!(window as any).Capacitor?.isNativePlatform?.()) return null
      try {
        // Пакета может не быть в сборке вовсе — поэтому имя собирается на лету:
        // статический импорт потребовал бы его наличия и ронял бы сборку.
        const name = '@capacitor' + '/preferences'
        const m: any = await import(/* @vite-ignore */ name)
        const P = m.Preferences
        if (!P) return null
        return {
          get: async k => (await P.get({ key: k })).value ?? null,
          set: async (k, v) => { await P.set({ key: k, value: v }) },
          del: async k => { await P.remove({ key: k }) },
        }
      } catch { return null }   // пакет не установлен — остаёмся на одном localStorage
    })()
  }
  return backupPromise
}

/** Ключи, которые стоит дублировать: только вход, ничего лишнего. */
export const isAuthKey = (k: string): boolean => /^sb-.*-auth-token$/.test(k) || k.startsWith('supabase.auth.')

/**
 * Хранилище для клиента Supabase.
 *
 * getItem обязан быть синхронным для localStorage-пути: клиент читает сессию при
 * старте, и асинхронный ответ означал бы кадр без аккаунта — то самое «мигание
 * экрана входа», которое видно при каждом запуске. Поэтому синхронно отдаём то,
 * что есть, а восстановление из запасной полки идёт заранее (см. restoreAuth).
 */
export const authStorage = {
  getItem(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  },
  setItem(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch { /* переполнено */ }
    if (isAuthKey(key)) void backup().then(b => b?.set(key, value)).catch(() => {})
  },
  removeItem(key: string): void {
    try { localStorage.removeItem(key) } catch { /* и не было */ }
    if (isAuthKey(key)) void backup().then(b => b?.del(key)).catch(() => {})
  },
}

/**
 * Поднять вход из запасной полки, если в localStorage его нет.
 *
 * Зовётся ДО создания клиента Supabase: после создания он уже прочитал бы
 * пустоту и показал экран входа.
 */
export async function restoreAuth(keys: string[]): Promise<boolean> {
  const b = await backup()
  if (!b) return false
  let restored = false
  for (const k of keys) {
    try {
      if (localStorage.getItem(k)) continue
      const v = await b.get(k)
      if (!v) continue
      localStorage.setItem(k, v)
      restored = true
    } catch { /* нет доступа к хранилищу — ничего не поделать */ }
  }
  return restored
}

/** Имя ключа сессии по адресу проекта: его выбирает сам Supabase. */
export function authKeyFor(url: string): string {
  const ref = /https?:\/\/([^.]+)\./.exec(url || '')?.[1] ?? 'default'
  return 'sb-' + ref + '-auth-token'
}
