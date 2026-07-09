import { useSettings } from '../lib/settings'
import { iconUrlOf } from '../lib/appIcon'

// Текущий логотип приложения (v1.158.0) — реагирует на выбор в Настройках
// сразу же, без перезагрузки (settings уже в контексте).
export function AppLogo({ size = 32, className }: { size?: number; className?: string }) {
  const { settings } = useSettings()
  return <img className={'app-logo' + (className ? ' ' + className : '')} src={iconUrlOf(settings.appIcon)} width={size} height={size} alt="Ponoi" draggable={false} />
}
