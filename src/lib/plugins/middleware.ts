// v1.465.0: перехватчики сообщений.
//
// Что это даёт. Плагин получает сообщение ДО отправки и может его изменить или
// отменить, и получает чужое сообщение ДО показа и может изменить то, что видит
// человек. На этом делаются сквозное шифрование, автоперевод, своё
// форматирование и скрытие спойлеров — то, чего иначе не сделать никак: раньше
// плагин мог только отправить своё сообщение рядом, а не тронуть уже набранное.
//
// Чем это опасно, прямо. Плагин с этим разрешением видит КАЖДОЕ сообщение и
// может отправить не то, что человек набрал. Это сильнее всего остального, что
// плагин умеет, поэтому разрешение отдельное, помечено небезопасным
// (SENSITIVE_PERMISSIONS) и названо в лицо: «Читать и МЕНЯТЬ твои сообщения».
//
// ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: сломанный плагин не мешает человеку писать.
//
// Перехватчик — чужой код в воркере. Он может зациклиться, упасть, вернуть
// мусор или не ответить никогда. Ни один из этих случаев не должен приводить к
// «нажал отправить, ничего не произошло»: на любой беде берётся исходный текст.
// Отмена сообщения — только явная и только осознанная (ctx.cancel === true), а
// не «обработчик вернул undefined».
//
// Проверки: src/lib/plugins/__test.ts (npm run test:plugins).

import type { FnRef } from './sandbox'

/** Сколько ждём перехватчик. Дольше — человек решит, что отправка не работает. */
export const BEFORE_SEND_MS = 4000
/** Показ ждать почти нельзя: это происходит при прокрутке переписки. */
export const BEFORE_RENDER_MS = 2000
/** Предел длины после правки: перехватчик не должен раздувать сообщение. */
export const MAX_CONTENT = 8000

export interface Interceptor {
  pluginId: string
  kind: 'send' | 'render' | 'upload'
  fn: FnRef
}

/**
 * Сколько ждём перехватчик вложения (v1.475.0).
 *
 * Больше, чем у сообщения, и намеренно: здесь не правка строки, а работа с
 * файлом — сжать картинку на десять мегапикселей или переложить видео честно
 * стоит секунд. Но не бесконечно: замерший перехватчик не должен означать
 * «файл не отправляется никогда».
 */
export const BEFORE_UPLOAD_MS = 20000
/** Насколько перехватчик может РАЗДУТЬ файл. Он для сжатия и чистки, а не для
 *  того, чтобы вместо картинки на 2 МБ уехало 200. */
export const MAX_UPLOAD_GROWTH = 2

/** Что уходит перехватчику и что он может вернуть. */
export interface SendCtx {
  content: string
  /** Куда пишем — чтобы перехватчик мог не трогать чужие каналы. */
  channelId: string | null
  /** true — сообщение не отправляется. Только явное значение, не «ложное». */
  cancel?: boolean
}

export interface RenderCtx {
  id: string
  content: string
  author: string
  mine: boolean
}

/**
 * Разбор ответа перехватчика отправки.
 *
 * Отдельной чистой функцией, потому что здесь легче всего ошибиться и труднее
 * всего заметить: обработчик вернул не то — и человек отправил не то. Правила:
 *
 *   • вернул строку          → это новый текст;
 *   • вернул {content}       → это новый текст;
 *   • вернул {cancel: true}  → сообщение не уходит;
 *   • вернул что угодно ещё  → текст остаётся прежним.
 *
 * Пустой текст после правки равен отмене: отправлять пустоту нельзя, а молча
 * подставлять прежний текст — значит отправить то, что перехватчик убрал.
 */
export function applySendResult(before: string, result: unknown): { content: string; cancel: boolean } {
  if (typeof result === 'string') {
    const s = result.slice(0, MAX_CONTENT)
    return { content: s, cancel: s.trim() === '' }
  }
  if (result && typeof result === 'object') {
    const r = result as { content?: unknown; cancel?: unknown }
    if (r.cancel === true) return { content: before, cancel: true }
    if (typeof r.content === 'string') {
      const s = r.content.slice(0, MAX_CONTENT)
      return { content: s, cancel: s.trim() === '' }
    }
  }
  return { content: before, cancel: false }
}

/** То же для показа, но отменить показ нельзя: спрятать чужое сообщение целиком
 *  — это уже не оформление. Вернул не строку — остаётся как было. */
export function applyRenderResult(before: string, result: unknown): string {
  if (typeof result === 'string') return result.slice(0, MAX_CONTENT)
  if (result && typeof result === 'object') {
    const c = (result as { content?: unknown }).content
    if (typeof c === 'string') return c.slice(0, MAX_CONTENT)
  }
  return before
}

// ── Реестр перехватчиков ────────────────────────────────────────────────────
// Порядок фиксирован порядком регистрации: цепочка обязана быть предсказуемой,
// иначе шифрующий и переводящий плагины сработают то так, то эдак.

const list: Interceptor[] = []
/** Сколько перехватчиков одного вида может завести один плагин. */
export const MAX_INTERCEPTORS = 4

export class InterceptLimit extends Error {}

export function addInterceptor(i: Interceptor) {
  const mine = list.filter(x => x.pluginId === i.pluginId && x.kind === i.kind).length
  if (mine >= MAX_INTERCEPTORS) {
    throw new InterceptLimit(`Перехватчиков «${i.kind}» у одного плагина не больше ${MAX_INTERCEPTORS}`)
  }
  list.push(i)
}

export function clearInterceptors(pluginId: string) {
  const было = list.length
  for (let n = list.length - 1; n >= 0; n--) if (list[n].pluginId === pluginId) list.splice(n, 1)
  // Запомненный показ считался С УЧАСТИЕМ снятого перехватчика. Не сбросить
  // его — значит оставить выключенный плагин править то, что человек видит:
  // ровно та поломка, ради которой сделан аварийный режим.
  if (было !== list.length) clearRenderCache()
}

export function clearAllInterceptors() {
  list.length = 0
  clearRenderCache()
}

export function interceptors(kind: 'send' | 'render' | 'upload'): Interceptor[] {
  return list.filter(x => x.kind === kind)
}

/**
 * Разбор ответа перехватчика вложения (v1.475.0).
 *
 * Чистой функцией по той же причине, что и у сообщения: ошибка здесь означает,
 * что человек отправил НЕ ТОТ файл, и заметить это почти невозможно. Правила:
 *
 *   • вернул { bytes }            → это новое содержимое файла;
 *   • вернул { bytes, name, type }→ ещё и имя с видом;
 *   • вернул { cancel: true }     → файл не уходит вовсе;
 *   • вернул что угодно ещё       → файл остаётся прежним.
 *
 * Чего мы НЕ делаем: не верим размеру на слово (берём длину байтов), не даём
 * раздуть файл больше чем вдвое и не пускаем пустоту — «перехватчик вернул
 * ноль байт» это поломка плагина, а не «человек отправил пустой файл».
 */
export function applyUploadResult(
  before: { name: string; type: string; size: number },
  result: unknown,
): { bytes: ArrayBuffer | null; name: string; type: string; cancel: boolean } {
  const нет = { bytes: null, name: before.name, type: before.type, cancel: false }
  if (!result || typeof result !== 'object') return нет
  const r = result as Record<string, unknown>
  if (r.cancel === true) return { ...нет, cancel: true }

  let bytes: ArrayBuffer | null = null
  if (r.bytes instanceof ArrayBuffer) bytes = r.bytes
  else if (ArrayBuffer.isView(r.bytes)) {
    const v = r.bytes as ArrayBufferView
    bytes = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer
  }
  if (!bytes) return нет
  if (bytes.byteLength === 0) return нет
  if (bytes.byteLength > before.size * MAX_UPLOAD_GROWTH + 64 * 1024) return нет

  // Имя и вид меняются только вместе с содержимым: переименовать чужой файл,
  // не тронув его, перехватчику незачем.
  const name = typeof r.name === 'string' && r.name.trim()
    ? r.name.trim().replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120)
    : before.name
  const type = typeof r.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(r.type)
    ? r.type.slice(0, 80)
    : before.type
  return { bytes, name, type, cancel: false }
}

/** Есть ли вообще перехватчики: пока их нет, ни одна цепочка не строится и
 *  отправка идёт ровно тем же путём, что и до этой версии. */
export const hasInterceptors = (kind: 'send' | 'render' | 'upload') => list.some(x => x.kind === kind)

/** Ждать чужой код можно только со сроком: зациклившийся перехватчик иначе
 *  навсегда съедает кнопку «отправить». */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false
    const t = setTimeout(() => { if (!done) { done = true; resolve(onTimeout) } }, ms)
    p.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v) } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(onTimeout) } })
  })
}

/**
 * Прогнать текст через цепочку перехватчиков отправки.
 *
 * invoke передаётся снаружи (host.ts) — сюда не тянется ни песочница, ни реестр
 * плагинов, и всю эту логику можно проверить обычными функциями.
 */
export async function runBeforeSend(
  content: string,
  channelId: string | null,
  invoke: (pluginId: string, fn: FnRef, args: unknown[]) => Promise<unknown>,
): Promise<{ content: string; cancel: boolean; by: string | null }> {
  let cur = content
  for (const i of interceptors('send')) {
    const ctx: SendCtx = { content: cur, channelId }
    const res = await withTimeout(
      invoke(i.pluginId, i.fn, [ctx]).catch(() => null),
      BEFORE_SEND_MS,
      null,   // не ответил вовремя — берём как было, а не молчим
    )
    const out = applySendResult(cur, res)
    if (out.cancel) return { content: cur, cancel: true, by: i.pluginId }
    cur = out.content
  }
  return { content: cur, cancel: false, by: null }
}

/**
 * Прогнать файл через перехватчики (v1.475.0).
 *
 * Порядок тот же, что у сообщений: по очереди, каждый видит результат
 * предыдущего. Упавший или замерший перехватчик НЕ отменяет отправку — файл
 * уходит как был. Отмена бывает только явной ({ cancel: true }), и о ней
 * приложение обязано сказать человеку: молча не отправить файл, который он
 * только что выбрал, — худшее из возможного.
 */
export async function runBeforeUpload(
  file: { name: string; type: string; size: number; bytes: ArrayBuffer },
  invoke: (pluginId: string, fn: FnRef, args: unknown[]) => Promise<unknown>,
): Promise<{ bytes: ArrayBuffer; name: string; type: string; cancel: boolean; by: string | null }> {
  let cur = { ...file }
  for (const i of interceptors('upload')) {
    const res = await withTimeout(
      invoke(i.pluginId, i.fn, [{ name: cur.name, type: cur.type, size: cur.bytes.byteLength, bytes: cur.bytes }])
        .catch(() => null),
      BEFORE_UPLOAD_MS,
      null,
    )
    const out = applyUploadResult({ name: cur.name, type: cur.type, size: cur.bytes.byteLength }, res)
    if (out.cancel) return { ...cur, cancel: true, by: i.pluginId }
    cur = { name: out.name, type: out.type, size: out.bytes ? out.bytes.byteLength : cur.size, bytes: out.bytes ?? cur.bytes }
  }
  return { bytes: cur.bytes, name: cur.name, type: cur.type, cancel: false, by: null }
}

// ── Показ: посчитанное запоминается ─────────────────────────────────────────
//
// Рисование идёт синхронно, а перехватчик живёт в воркере и отвечает через
// сообщение — то есть асинхронно. Спрашивать его на каждую перерисовку нельзя
// вдвойне: во-первых, ответа в этот момент нет, во-вторых, при прокрутке
// переписки перерисовки идут пачками, и это был бы поток вызовов в воркер.
//
// Поэтому: посчитанное лежит в памяти, а первый показ отдаёт исходный текст и
// заводит пересчёт. Пришёл ответ — те, кто рисует, узнают об этом и
// перерисовываются уже с новым текстом.

const renderCache = new Map<string, string>()
const inFlight = new Set<string>()
const renderWatchers = new Set<() => void>()
/** Сколько сообщений помним. Переписка длинная, а память не резиновая. */
const RENDER_CACHE_MAX = 3000

export function subscribeRendered(fn: () => void): () => void {
  renderWatchers.add(fn)
  return () => { renderWatchers.delete(fn) }
}
function pokeWatchers() { renderWatchers.forEach(fn => { try { fn() } catch {} }) }

/** Ключ считает и id, и сам текст: сообщение поправили — старый ответ негоден. */
const renderKey = (id: string, content: string) => id + '\u0000' + content

export function clearRenderCache() {
  renderCache.clear()
  inFlight.clear()
  pokeWatchers()
}

/**
 * Текст сообщения для показа — синхронно.
 *
 * Пока перехватчиков нет, возвращает ровно то, что пришло, и не делает больше
 * ничего: путь показа у большинства остаётся прежним.
 */
export function renderedContent(
  msg: RenderCtx,
  invoke: (pluginId: string, fn: FnRef, args: unknown[]) => Promise<unknown>,
): string {
  if (!hasInterceptors('render')) return msg.content
  const key = renderKey(msg.id, msg.content)
  const have = renderCache.get(key)
  if (have !== undefined) return have
  if (!inFlight.has(key)) {
    inFlight.add(key)
    void runBeforeRender(msg, invoke).then(out => {
      inFlight.delete(key)
      if (renderCache.size >= RENDER_CACHE_MAX) renderCache.clear()
      renderCache.set(key, out)
      // Дёргаем перерисовку только если текст правда изменился: иначе каждое
      // сообщение вызывало бы лишний проход по всему списку впустую.
      if (out !== msg.content) pokeWatchers()
    }, () => { inFlight.delete(key) })
  }
  return msg.content
}

/** То же для показа. Отмены здесь нет — только текст. */
export async function runBeforeRender(
  msg: RenderCtx,
  invoke: (pluginId: string, fn: FnRef, args: unknown[]) => Promise<unknown>,
): Promise<string> {
  let cur = msg.content
  for (const i of interceptors('render')) {
    const res = await withTimeout(
      invoke(i.pluginId, i.fn, [{ ...msg, content: cur }]).catch(() => null),
      BEFORE_RENDER_MS,
      null,
    )
    cur = applyRenderResult(cur, res)
  }
  return cur
}
