// v1.473.0: одна база плагинов — одно место, которое знает её устройство.
//
// Зачем отдельный файл. До этой версии базу открывал db.ts: имя, версия и
// создание хранилища лежали прямо в нём, и это было верно ровно до тех пор,
// пока хранилище было одно. С появлением ресурсов (assets.ts) их стало два, и
// открывать одну и ту же базу из двух файлов НЕЛЬЗЯ: у каждого своя версия и
// свой обработчик обновления схемы, а IndexedDB при расхождении версий просто
// блокирует соединение — приложение зависает на первом же обращении, ничего
// при этом не сообщая.
//
// Поэтому база открывается здесь и только здесь, а оба хранилища создаются
// одним обработчиком: он видит их разом и не может «забыть» соседнее.
//
// Проверки: src/lib/plugins/__test.ts.

const DB_NAME = 'ponoi_plugin_db'
/** v1: только строки таблиц. v2: добавлены ресурсы плагина. */
const DB_VERSION = 2

/** Строки таблиц плагина (ponoi.db). Ключ — «плагин + таблица + id». */
export const STORE_ROWS = 'rows'
/** Файлы плагина (ponoi.assets). Ключ — «плагин + имя». */
export const STORE_ASSETS = 'assets'

export class IdbError extends Error {}

let открытая: Promise<IDBDatabase> | null = null

/**
 * Соединение с базой. Одно на всё приложение и на все хранилища.
 *
 * Обновление схемы обязано быть ДОБАВЛЯЮЩИМ: у человека, который уже пользуется
 * плагинами, в базе лежат его строки, и снести их при переходе на новую версию
 * значило бы потерять чужие данные молча. Поэтому каждое хранилище создаётся
 * только если его ещё нет.
 */
export function openPluginDb(): Promise<IDBDatabase> {
  if (открытая) return открытая
  открытая = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new IdbError('База недоступна в этом окружении')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ROWS)) {
        const st = db.createObjectStore(STORE_ROWS, { keyPath: 'k' })
        // Индекс по «плагин + таблица»: именно он делает отбор таблицы дешёвым
        // независимо от того, сколько всего строк в базе.
        st.createIndex('byTable', 't', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const st = db.createObjectStore(STORE_ASSETS, { keyPath: 'k' })
        // Индекс по плагину: список своих файлов и уборка за выключенным
        // плагином не должны перебирать чужие.
        st.createIndex('byPlugin', 'p', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new IdbError('Не удалось открыть базу: ' + (req.error?.message ?? '')))
  })
  return открытая
}

/** Ответ одного обращения к базе — промисом. */
export function запрос<T>(req: IDBRequest, map: (r: IDBRequest) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(map(req))
    req.onerror = () => reject(new IdbError(req.error?.message ?? 'ошибка базы'))
  })
}

/** Хранилище в новой сделке. */
export async function лавка(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openPluginDb()
  return db.transaction(store, mode).objectStore(store)
}
