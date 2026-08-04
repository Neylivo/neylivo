import { WORKER_BOOTSTRAP } from './bootstrap'

// v1.286.0: хостовая половина песочницы — поднимает Worker плагина, гоняет RPC и
// следит, чтобы плагин не подвесил приложение. Что именно можно вызывать и с какими
// разрешениями — не здесь, а в api.ts; здесь только транспорт и живучесть.

/** Сколько ждём, пока плагин доложит о загрузке. Больше — почти наверняка вечный цикл. */
// v1.446.0: сроки — в limits.ts. Было 5 с на запуск и 10 с на обработчик:
// плагин с ИИ-моделью не успевал ответить и выглядел зависшим.
import { INIT_TIMEOUT_MS, INVOKE_TIMEOUT_MS } from './limits'
/** Столько ждём ответа обработчика плагина (клик по кнопке, слэш-команда). */

/** Метка функции плагина в аргументах (см. packArgs в bootstrap.ts). */
export interface FnRef { __fn: string }
export function isFnRef(v: unknown): v is FnRef {
  return !!v && typeof v === 'object' && typeof (v as FnRef).__fn === 'string'
}

/**
 * Пометка «это не копировать, а передать» (v1.465.0).
 *
 * Диспетчер возвращает { __transfer: холст }, и только по этой пометке значение
 * уезжает списком передачи. Пометка нужна ровно потому, что передача —
 * необратимое действие: переданный объект в приложении перестаёт быть годным, и
 * делать это «на всякий случай» со всем подряд нельзя.
 */
export interface Transferred { __transfer: Transferable }
export function asTransfer(v: unknown): Transferable | null {
  if (!v || typeof v !== 'object') return null
  const t = (v as Transferred).__transfer
  return t && typeof t === 'object' ? t : null
}

export interface SandboxHooks {
  /** Плагин вызвал метод API. Вернуть значение или бросить — оба доедут до плагина. */
  onCall: (method: string, args: unknown[]) => Promise<unknown>
  /** Плагин сломался: и на этапе загрузки, и потом. Плагин при этом уже остановлен. */
  onError: (message: string) => void
}

export class PluginSandbox {
  private worker: Worker | null = null
  private blobUrl: string | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>()
  private seq = 0
  private dead = false

  constructor(private readonly hooks: SandboxHooks) {}

  /** Поднимает воркер и ждёт, пока плагин отработает onLoad. */
  start(code: string): Promise<void> {
    const blob = new Blob([WORKER_BOOTSTRAP], { type: 'text/javascript' })
    // URL отзывается не здесь, а в kill(). Загрузка скрипта воркера асинхронная:
    // отзыв сразу после new Worker() успевает отменить её до старта, и воркер молчит
    // навсегда — ни ready, ни onerror, только таймаут «плагин не ответил».
    this.blobUrl = URL.createObjectURL(blob)
    this.worker = new Worker(this.blobUrl)

    return new Promise<void>((resolve, reject) => {
      const done = (err?: string) => {
        clearTimeout(timer)
        if (err) { this.kill(); reject(new Error(err)) } else resolve()
      }
      const timer = window.setTimeout(
        () => done(`Плагин не ответил за ${INIT_TIMEOUT_MS / 1000} с — похоже, зациклился при запуске.`),
        INIT_TIMEOUT_MS,
      )

      this.worker!.onmessage = (e: MessageEvent) => {
        const m = e.data || {}
        if (m.k === 'ready') { done(); return }
        if (m.k === 'fail') { done(m.error || 'не удалось загрузить'); return }
        if (m.k === 'err') { this.hooks.onError(String(m.error || 'неизвестная ошибка')); return }
        if (m.k === 'call') { this.handleCall(m.id, m.method, m.args); return }
        if (m.k === 'res') { this.handleRes(m); return }
      }
      // Синтаксическая ошибка в самом бутстрапе или падение воркера целиком.
      this.worker!.onerror = (e: ErrorEvent) => done(e.message || 'ошибка в коде плагина')

      // Код уходит только теперь, когда onmessage/onerror уже стоят — иначе ответ
      // быстрого плагина мог бы прийти раньше, чем его есть кому принять.
      this.post({ k: 'init', code })
    })
  }

  private async handleCall(id: number, method: string, args: unknown[]) {
    try {
      const value = await this.hooks.onCall(String(method), Array.isArray(args) ? args : [])
      // v1.465.0: холст не копируется, а ПЕРЕДАЁТСЯ. OffscreenCanvas нельзя
      // клонировать структурно — обычный postMessage на нём падает с
      // DataCloneError, и плагин получал бы невнятную ошибку вместо холста.
      // Диспетчер помечает такой ответ, и только он едет списком передачи.
      const t = asTransfer(value)
      if (t) this.post({ k: 'res', id, ok: true, value: t }, [t])
      else this.post({ k: 'res', id, ok: true, value })
    } catch (err: any) {
      this.post({ k: 'res', id, ok: false, error: err?.message ?? String(err) })
    }
  }

  private handleRes(m: any) {
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.ok) p.resolve(m.value)
    else p.reject(new Error(m.error || 'ошибка в обработчике плагина'))
  }

  /** Вызвать функцию плагина по метке, полученной в аргументах. */
  invoke(ref: FnRef, args: unknown[] = []): Promise<unknown> {
    if (this.dead || !this.worker) return Promise.reject(new Error('Плагин остановлен'))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Обработчик плагина не ответил за ${INVOKE_TIMEOUT_MS / 1000} с.`))
      }, INVOKE_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.post({ k: 'invoke', id, fn: ref.__fn, args })
    })
  }

  /** Разослать плагину событие, на которое он подписан. */
  emit(name: string, data: unknown) {
    this.post({ k: 'ev', name, data })
  }

  private post(msg: unknown, transfer?: Transferable[]) {
    if (this.dead || !this.worker) return
    try {
      if (transfer && transfer.length) this.worker.postMessage(msg, transfer)
      else this.worker.postMessage(msg)
    } catch { /* воркер уже мёртв — молча, вызывающему это не важно */ }
  }

  /** Остановить плагин. Все висящие вызовы честно отклоняются, а не текут. */
  kill() {
    this.dead = true
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Плагин остановлен')) }
    this.pending.clear()
    try { this.worker?.terminate() } catch { /* уже завершён */ }
    this.worker = null
    // Теперь URL точно никому не нужен — иначе бы копился на каждом вкл/выкл плагина.
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null }
  }
}
