import { Component, type ReactNode } from 'react'

// v1.273.0: до сих пор ЛЮБАЯ необработанная ошибка рендера где угодно в дереве
// (например, null.prop в редко бьющей ветке) обрушивала всё приложение в белый
// экран — без единой возможности восстановиться самостоятельно. Обычно это
// терпимо (перезагрузил вкладку/приложение) — но на неделю без интернета и без
// присмотра «просто перезагрузи» уже не вариант. Ловим крах здесь, пишем его
// в localStorage (чтобы можно было посмотреть постфактум — своего Sentry нет),
// и пробуем самовосстановиться автоперезагрузкой, а не просто показываем стену.
const LOG_KEY = 'ponoi_crash_log'
const LOOP_KEY = 'ponoi_crash_loop'
const AUTO_RELOAD_MS = 8000
const LOOP_WINDOW_MS = 60000   // если рухнули больше 3 раз за минуту — авторестарт скорее навредит (мигание), гасим его

function logCrash(error: unknown, info: { componentStack?: string | null }) {
  try {
    const entry = {
      time: new Date().toISOString(),
      message: String((error as any)?.message ?? error),
      stack: String((error as any)?.stack ?? ''),
      componentStack: info.componentStack ?? '',
    }
    const prev = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]')
    localStorage.setItem(LOG_KEY, JSON.stringify([...prev, entry].slice(-20)))
  } catch {}
}

function loopDetected(): boolean {
  try {
    const now = Date.now()
    const hits: number[] = JSON.parse(localStorage.getItem(LOOP_KEY) ?? '[]')
    const recent = hits.filter(t => now - t < LOOP_WINDOW_MS)
    recent.push(now)
    localStorage.setItem(LOOP_KEY, JSON.stringify(recent))
    return recent.length > 3
  } catch { return false }
}

interface State { hasError: boolean; looping: boolean }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, looping: false }
  timer: number | undefined

  static getDerivedStateFromError() { return { hasError: true } }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    logCrash(error, info)
    const looping = loopDetected()
    this.setState({ looping })
    if (!looping) this.timer = window.setTimeout(() => window.location.reload(), AUTO_RELOAD_MS)
  }

  componentWillUnmount() { if (this.timer) window.clearTimeout(this.timer) }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <div className="crash-title">Что-то пошло не так</div>
          <div className="crash-text">
            {this.state.looping
              ? 'Приложение падает повторно — автоперезагрузка отключена, чтобы не мигать. Перезапусти вручную.'
              : 'Приложение автоматически перезагрузится через несколько секунд.'}
          </div>
          <button className="crash-btn" onClick={() => window.location.reload()}>Перезагрузить сейчас</button>
        </div>
      </div>
    )
  }
}
