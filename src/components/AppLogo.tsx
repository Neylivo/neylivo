import { useSettings } from '../lib/settings'
import { DEFAULT_ICON_URL } from '../lib/appIcon'

// Логотип приложения (v1.160.0) — стандартная иконка, пока пользователь не
// загрузил свою в Настройках; реагирует на смену сразу же (settings в контексте).
export function AppLogo({ size = 32, className }: { size?: number; className?: string }) {
  const { settings } = useSettings()
  return <img className={'app-logo' + (className ? ' ' + className : '')} src={settings.appIcon || DEFAULT_ICON_URL} width={size} height={size} alt="Ponoi" draggable={false} />
}
