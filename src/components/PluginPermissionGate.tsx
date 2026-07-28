import { Icon } from './icons'
import { Portal } from './Portal'
import { compareVersions } from '../lib/plugins/manifest'
import { PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type PluginManifest, type InstalledPlugin } from '../lib/plugins/types'

// v1.333.0: вынесено из PluginsSettings.tsx отдельным файлом. Каталог плагинов
// показывает тот же экран разрешений, а импорт «каталог -> настройки -> каталог»
// замыкал круг: сборщик переставал выносить оба в ленивый кусок и тащил их в
// стартовый бандл (+39 КБ, поймал смоук-тест).

/** Экран разрешений — показывается ДО установки, пока чужой код ещё не запускался.
 *  Экспортируется: тот же экран открывает карточка плагина в чате. */
export function PermissionGate({ manifest, existing, onCancel, onConfirm }: {
  manifest: PluginManifest
  existing: InstalledPlugin | undefined
  onCancel: () => void
  onConfirm: () => void
}) {
  const upgrade = existing ? compareVersions(manifest.version, existing.manifest.version) : 1
  return (
    <Portal><div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onCancel}><Icon name="close" size={18} /></button>
        <div className="modal-title">{existing ? 'Обновить плагин' : 'Установить плагин'}</div>
        <div className="modal-sub">
          {existing
            ? (upgrade > 0
              ? `Установлена версия ${existing.manifest.version}, ставится ${manifest.version}.`
              : upgrade < 0
                ? `Внимание: установлена БОЛЕЕ НОВАЯ версия ${existing.manifest.version}, ставится ${manifest.version}.`
                : `Такая же версия ${manifest.version} — переустановка.`)
            : 'Проверь, что просит плагин, прежде чем соглашаться.'}
        </div>

        <div className="sset-info" style={{ marginTop: 16, alignItems: 'flex-start' }}>
          <Icon name="cube" size={16} />
          <span><b>{manifest.name}</b> {manifest.version}<br />
            <span className="mut">автор: {manifest.author}</span>
            {manifest.description && <><br />{manifest.description}</>}
          </span>
        </div>

        <label className="modal-lbl">Плагин сможет</label>
        {manifest.permissions.length === 0 && <div className="cset-hint">Ничего особенного — плагин ничего не запрашивает.</div>}
        {manifest.permissions.map(p => (
          <div key={p} className={'plug-perm' + (SENSITIVE_PERMISSIONS.includes(p) ? ' warn' : '')}>
            <Icon name={SENSITIVE_PERMISSIONS.includes(p) ? 'shield' : 'check'} size={15} />
            <span>{PERMISSION_LABEL[p]}</span>
          </div>
        ))}
        {manifest.hosts.length > 0 && (
          <div className="cset-hint" style={{ marginTop: 8 }}>Сайты: {manifest.hosts.join(', ')}</div>
        )}

        <div className="cset-hint" style={{ marginTop: 14 }}>
          Плагин выполняется в песочнице: он не видит твой пароль, сессию и файлы на компьютере.
          Но всё, что перечислено выше, он делать сможет — ставь только то, чему доверяешь.
        </div>

        <div className="modal-foot">
          <button className="modal-ghost" onClick={onCancel}>Отмена</button>
          <button className="modal-primary" onClick={onConfirm}>{existing ? 'Обновить' : 'Установить'}</button>
        </div>
      </div>
    </div></Portal>
  )
}
