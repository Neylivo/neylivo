import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react'

// v1.289.0: ленивая загрузка тяжёлых экранов.
//
// Все они и так рендерятся условно ({открыто && <Экран/>}), но статический импорт
// всё равно тащил их код в стартовый кусок — чтобы показать список чатов,
// приходилось сначала скачать настройки, плеер музыки, редактор ролей и статистику
// игр. Здесь Suspense спрятан внутрь обёртки, поэтому места вызова не меняются
// вообще: было `import { Settings } from './Settings'`, стало
// `const Settings = lazyNamed(() => import('./Settings'), 'Settings')`.
//
// Почему не React.lazy напрямую: он требует модуль с export default, а у нас всюду
// именованные экспорты — иначе пришлось бы менять экспорты семи компонентов.

/**
 * Своя граница ошибок вокруг КАЖДОГО ленивого экрана.
 *
 * Без неё несработавшая загрузка куска (пропала сеть, выкатили новую версию и
 * старые хеши файлов исчезли) пробивалась бы до корневого ErrorBoundary в
 * main.tsx — то есть падало бы ВСЁ приложение с экраном краха и перезагрузкой,
 * хотя не открылся один экран. Здесь ломается только он, остальное живо.
 */
class LazyBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
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

/** Скромный индикатор на время загрузки куска. Пустота вместо него выглядела бы
 *  как «нажал, и ничего не произошло» на медленном интернете. */
export const lazySpinner = <div className="lazy-wait"><span className="lazy-dot" /><span className="lazy-dot" /><span className="lazy-dot" /></div>

// Типы пропсов выводятся из самого модуля через typeof import(...), поэтому
// ленивый экран проверяется компилятором ровно так же, как обычный: опечатка в
// пропсе или забытый обязательный параметр по-прежнему ошибка сборки. Ради этого
// generic по модулю, а не простое ComponentType<any> — с any проверка пропсов
// молча отключилась бы у всех девяти экранов сразу.
export function lazyNamed<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
  fallback: ReactNode = lazySpinner,
): M[K] extends ComponentType<infer P> ? ComponentType<P> : never {
  const make = () => lazy(async () => {
    const mod = await load() as Record<string, unknown>
    const C = mod[name as string]
    if (typeof C !== 'function') {
      // Ошибиться в имени легко (опечатка, переименование при рефакторинге), а
      // проявилось бы это пустым экраном без единого следа в консоли.
      throw new Error(`lazyNamed: в модуле нет экспорта «${String(name)}»`)
    }
    return { default: C as ComponentType<Record<string, unknown>> }
  })

  let current = make()

  const Wrapped = (props: Record<string, unknown>) => {
    // React.lazy запоминает результат промиса НАВСЕГДА, в том числе отказ:
    // просто перерисовать после сбоя недостаточно, нужен новый lazy — поэтому на
    // «Повторить» пересоздаём его и меняем key, заставляя ветку смонтироваться заново.
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

// Вынесено, чтобы не тащить в файл JSX-обобщения ради одной строки.
function createEl(C: ComponentType<Record<string, unknown>>, props: Record<string, unknown>) {
  return <C {...props} />
}
