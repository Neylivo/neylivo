import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react'

// Ленивая загрузка тяжёлых экранов. Место вызова не меняется:
// `const Settings = lazyNamed(() => import('./Settings'), 'Settings')`.
// React.lazy требует default-экспорт, а у нас именованные — отсюда обёртка.

const ПЕРЕЗАГРУЗКА = 'neylivo-chunk-reload'

/**
 * Кусок не загрузился чаще всего по одной причине: выкатили новую версию, и
 * файлов со старыми хешами больше нет. Страница с новым индексом это чинит —
 * поэтому один раз перезагружаемся сами, а не показываем человеку тупик.
 * Флаг в sessionStorage не даёт зациклиться, если дело всё-таки в сети.
 */
function починитьСамо(): boolean {
  try {
    if (!navigator.onLine) return false
    if (sessionStorage.getItem(ПЕРЕЗАГРУЗКА)) return false
    sessionStorage.setItem(ПЕРЕЗАГРУЗКА, '1')
    location.reload()
    return true
  } catch { return false }
}

class LazyBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { починитьСамо() }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="lazy-fail">
        <span>Не удалось загрузить этот раздел — похоже, пропала связь.</span>
        <button onClick={() => { this.setState({ failed: false }); this.props.onRetry() }}>Повторить</button>
      </div>
    )
  }
}

export const lazySpinner = <div className="lazy-wait"><span className="lazy-dot" /><span className="lazy-dot" /><span className="lazy-dot" /></div>

// Generic по модулю, а не ComponentType<any>: с any проверка пропсов молча
// отключилась бы у всех ленивых экранов сразу.
export function lazyNamed<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
  fallback: ReactNode = lazySpinner,
): M[K] extends ComponentType<infer P> ? ComponentType<P> : never {
  const make = () => lazy(async () => {
    let mod: Record<string, unknown>
    try {
      mod = await load() as Record<string, unknown>
    } catch (e) {
      // Одна повторная попытка: сеть моргает чаще, чем выходят версии.
      await new Promise(r => setTimeout(r, 400))
      mod = await load() as Record<string, unknown>
      void e
    }
    const C = mod[name as string]
    if (typeof C !== 'function') throw new Error(`lazyNamed: в модуле нет экспорта «${String(name)}»`)
    return { default: C as ComponentType<Record<string, unknown>> }
  })

  let current = make()

  const Wrapped = (props: Record<string, unknown>) => {
    // React.lazy запоминает и отказ навсегда — на «Повторить» нужен новый lazy.
    const [attempt, setAttempt] = useState(0)
    const retry = () => { current = make(); setAttempt(a => a + 1) }
    return (
      <LazyBoundary key={attempt} onRetry={retry}>
        <Suspense fallback={fallback}>{createEl(current, props)}</Suspense>
      </LazyBoundary>
    )
  }
  Wrapped.displayName = `Lazy(${String(name)})`
  return Wrapped as unknown as M[K] extends ComponentType<infer P> ? ComponentType<P> : never
}

function createEl(C: ComponentType<Record<string, unknown>>, props: Record<string, unknown>) {
  return <C {...props} />
}
