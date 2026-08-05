import { Icon } from './icons'
import { Portal } from './Portal'
import { compareVersions } from '../lib/plugins/manifest'
import { PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type PluginManifest, type InstalledPlugin } from '../lib/plugins/types'
import { LIMITS_WARNING } from '../lib/plugins/limits'
import { missingPermissions } from '../lib/plugins/editorDraft'
import { installRisks, highRisk } from '../lib/plugins/audit'

// v1.333.0: вынесено из PluginsSettings.tsx отдельным файлом. Каталог плагинов
// показывает тот же экран разрешений, а импорт «каталог -> настройки -> каталог»
// замыкал круг: сборщик переставал выносить оба в ленивый кусок и тащил их в
// стартовый бандл (+39 КБ, поймал смоук-тест).

/** Экран разрешений — показывается ДО установки, пока чужой код ещё не запускался.
 *  Экспортируется: тот же экран открывает карточка плагина в чате. */
export function PermissionGate({ manifest, existing, onCancel, onConfirm, code }: {
  manifest: PluginManifest
  existing: InstalledPlugin | undefined
  onCancel: () => void
  onConfirm: () => void
  /** Сам файл — чтобы заранее сказать, что плагин не заработает (v1.346.0). */
  code?: string
}) {
  // Плагин, забывший объявить разрешение, установится и тут же упадёт. Честнее
  // предупредить здесь, чем показать человеку красную строку и оставить гадать,
  // он что-то сделал не так или плагин кривой.
  const willFail = code ? missingPermissions(code, manifest.permissions) : []
  const upgrade = existing ? compareVersions(manifest.version, existing.manifest.version) : 1
  const risks = installRisks(manifest, code ?? '')
  const высокий = highRisk(risks)
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
        {risks.length === 0 && <div className="cset-hint">Ничего особенного — плагин ничего не запрашивает.</div>}
        {/* v1.481.0: не список разрешений, а список РИСКОВ — красным то, что
            касается переписки, файлов и выхода наружу, жёлтым то, что меняет
            вид приложения. Человек решает по этому списку, поэтому он считается
            от кода и разрешений, а не от слов автора (см. audit.ts). */}
        {risks.map((r, i) => (
          <div key={i} className={'plug-perm risk-' + r.level}>
            <span className="risk-dot">{r.level === 'red' ? '🔴' : '🟡'}</span>
            <span>{r.text}</span>
          </div>
        ))}
        {/* Остальные разрешения — тем же списком, но без цвета: они ничего о
            человеке не узнают и ничего от его имени не сделают. */}
        {manifest.permissions.filter(p => !risks.some(r => r.text === PERMISSION_LABEL[p])).map(p => (
          <div key={p} className="plug-perm">
            <Icon name="check" size={15} />
            <span>{PERMISSION_LABEL[p]}</span>
          </div>
        ))}

        {willFail.length > 0 && (
          <div className="plug-err" style={{ marginTop: 12 }}>
            <Icon name="flag" size={14} />
            <span>
              Плагин зовёт {willFail.map(m => m.what).join(', ')}, но не просил{' '}
              {willFail.map(m => '«' + PERMISSION_LABEL[m.perm] + '»'). join(', ')} — в этом месте он
              упадёт. Это ошибка автора плагина, а не твоя.
            </span>
          </div>
        )}

        {/* v1.446.0: пределы по частоте сняты почти полностью (см. lib/plugins/limits.ts),
            и молчать об этом нельзя: раньше «пять сообщений за десять секунд»
            само по себе было страховкой, теперь её нет. */}
        <div className="plug-err warn" style={{ marginTop: 12 }}>
          <Icon name="shield" size={14} />
          <span>{LIMITS_WARNING}</span>
        </div>

        {высокий && (
          <div className="plug-err" style={{ marginTop: 12 }}>
            <Icon name="shield" size={14} />
            <span>
              <b>У этого плагина высокий уровень доступа.</b> Ставь такое, только если знаешь,
              откуда он, или если написал его сам.
            </span>
          </div>
        )}

        <div className="cset-hint" style={{ marginTop: 14 }}>
          Три вещи плагин не может НИКОГДА, что бы в нём ни было написано: добраться до твоего
          пароля и сессии, повесить приложение (он работает отдельным потоком, и его можно снять)
          и пережить безопасный режим — запуск с зажатым Shift не поднимает ни одного плагина.
        </div>

        <div className="modal-foot">
          <button className="modal-ghost" onClick={onCancel}>Отклонить</button>
          <button className={'modal-primary' + (высокий ? ' danger' : '')} onClick={onConfirm}>
            {высокий ? 'Я понимаю риски' : existing ? 'Обновить' : 'Установить'}
          </button>
        </div>
      </div>
    </div></Portal>
  )
}
