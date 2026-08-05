// v1.472.0: плагин как библиотека для других плагинов.
//
// Зачем, если уже есть обмен письмами (ipc.ts). Письмо — это «отправил и
// надейся»: отправитель не получает ответа, а значит, каждый такой разговор
// приходится собирать вручную из двух писем и своей таблицы ожидающих запросов.
// Владелец описал другое: «плагин-движок предоставляет графические утилиты, а
// плагин-игра использует его как библиотеку». Библиотека — это вызов с ответом.
//
//     // в плагине-библиотеке:
//     ponoi.services.register('math-utils', { урон: (s) => s.atk * 1.5 })
//     // в плагине-игре:
//     const math = await ponoi.services.connect('math-utils')
//     const dmg = await math.урон({ atk: 50 })
//
// КАК ЭТО УСТРОЕНО И ПОЧЕМУ БЕЗ НОВОГО ПРОТОКОЛА.
//
// Функции между плагинами не ходят и ходить не должны (см. ipc.ts: доехавшая
// метка дала бы соседу право звать чужой код с чужими разрешениями). Но при
// РЕГИСТРАЦИИ функции никуда не едут: они остаются у своего плагина, а
// приложение получает лишь метки, по которым умеет позвать их обратно. Тот же
// механизм, что у кнопок и слэш-команд, — ничего нового изобретать не пришлось.
//
// Что из этого следует: вызывающий не получает ссылку на чужой код, он просит
// ПРИЛОЖЕНИЕ позвать метод по имени. Приложение проверяет разрешение у обоих,
// чистит доводы и ответ от меток функций и только тогда передаёт.
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

import type { FnRef } from './sandbox'

/** Сколько служб может завести один плагин. */
export const MAX_SERVICES = 8
/** Сколько методов в одной службе. */
export const MAX_METHODS = 40
/** Длина имени службы. */
export const MAX_SERVICE_NAME = 60

export class ServiceError extends Error {}

export interface Service {
  /** Имя, по которому её ищут. Общее на всех — как имена слэш-команд. */
  name: string
  pluginId: string
  /** Метод → метка функции внутри плагина-владельца. */
  methods: Map<string, FnRef>
}

const services = new Map<string, Service>()

/** Имя службы: буквы, цифры, дефис и точка. Пробелы и кавычки ни к чему —
 *  имя пишут руками в чужом плагине, и оно должно быть простым. */
const NAME_RE = /^[a-zA-Z0-9._-]+$/

export function checkName(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) throw new ServiceError('Службе нужно имя')
  if (s.length > MAX_SERVICE_NAME) throw new ServiceError(`Имя длиннее ${MAX_SERVICE_NAME} знаков`)
  if (!NAME_RE.test(s)) throw new ServiceError('В имени службы можно только латиницу, цифры, точку, дефис и подчёркивание')
  return s
}

/**
 * Завести службу.
 *
 * Занятое имя — ОШИБКА, а не тихая замена. Иначе второй плагин молча отобрал бы
 * имя у первого, и оба выглядели бы сломанными: у одного служба перестала
 * отвечать, у другого работает не то, что он написал. Ровно так же устроены
 * имена слэш-команд и горячих клавиш.
 */
export function registerService(pluginId: string, name: string, methods: Map<string, FnRef>): Service {
  const n = checkName(name)
  const было = services.get(n)
  if (было && было.pluginId !== pluginId) {
    throw new ServiceError(`Служба «${n}» уже занята другим плагином.`)
  }
  let мои = 0
  for (const [, s] of services) if (s.pluginId === pluginId) мои++
  if (!было && мои >= MAX_SERVICES) {
    throw new ServiceError(`Служб у одного плагина не больше ${MAX_SERVICES}.`)
  }
  if (methods.size === 0) throw new ServiceError('В службе нет ни одного метода')
  if (methods.size > MAX_METHODS) throw new ServiceError(`Методов в службе не больше ${MAX_METHODS}.`)
  const s: Service = { name: n, pluginId, methods }
  services.set(n, s)
  return s
}

/** Кто отвечает за это имя. null — никто: плагин не запущен или не заводил её. */
export function findService(name: string): Service | null {
  return services.get(String(name ?? '')) ?? null
}

/** Имена методов — их отдаём вызывающему, чтобы он построил у себя объект. */
export function serviceMethods(name: string): string[] | null {
  const s = services.get(String(name ?? ''))
  return s ? [...s.methods.keys()] : null
}

export function unregisterService(pluginId: string, name: string): boolean {
  const s = services.get(String(name ?? ''))
  if (!s || s.pluginId !== pluginId) return false
  services.delete(s.name)
  return true
}

/** Убрать все службы плагина — при остановке и удалении. Иначе выключенный
 *  плагин продолжал бы значиться в реестре, а его метки функций вели бы в никуда. */
export function clearServices(pluginId: string) {
  for (const [n, s] of [...services]) if (s.pluginId === pluginId) services.delete(n)
}

export function clearAllServices() { services.clear() }

/** Для проверок и для экрана плагина: что сейчас предлагается. */
export function serviceList(): { name: string; pluginId: string; methods: string[] }[] {
  return [...services.values()].map(s => ({ name: s.name, pluginId: s.pluginId, methods: [...s.methods.keys()] }))
}
