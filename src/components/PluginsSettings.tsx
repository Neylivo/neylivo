import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { parsePlugin, compareVersions, MAX_PLUGIN_BYTES } from '../lib/plugins/manifest'
import { loadPlugins, removePlugin, setEnabled, subscribePlugins, getPlugin, writeStorage } from '../lib/plugins/store'
import { installPlugin } from '../lib/plugins/install'
import { startPlugin, stopPlugin, pluginError, isRunning, subscribePluginState, invokePlugin, emitToPlugin } from '../lib/plugins/host'
import { useSettingsPages, type SettingsRow } from '../lib/plugins/registry'
import { PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type PluginManifest, type InstalledPlugin } from '../lib/plugins/types'

// v1.286.0: раздел «Плагины» в настройках. Плагины ставятся на устройство, поэтому
// весь список локальный — ни таблицы, ни синхронизации между устройствами.

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
    <div className="modal-overlay" onClick={onCancel}>
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
    </div>
  )
}

/** Страница настроек одного плагина — строки описаны самим плагином (см. registry). */
function PluginSettingsRows({ pluginId, rows }: { pluginId: string; rows: SettingsRow[] }) {
  // Значение, которое видно человеку, держим локально: плагин присылает строки один
  // раз при регистрации и не обязан перерисовывать их на каждое нажатие.
  const [local, setLocal] = useState<Record<string, unknown>>({})
  const valueOf = (r: SettingsRow & { value?: unknown }) => (r.key in local ? local[r.key] : r.value)

  function change(key: string, value: unknown) {
    setLocal(v => ({ ...v, [key]: value }))
    writeStorage(pluginId, key, value)
    // Плагин узнаёт об изменении сразу, а не только когда сам заглянет в storage.
    emitToPlugin(pluginId, 'settings', { key, value })
  }

  return <>
    {rows.map(r => {
      switch (r.type) {
        case 'toggle': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <button className={'pqs-toggle' + (valueOf(r) ? ' on' : '')} onClick={() => change(r.key, !valueOf(r))}><span /></button>
          </div>
        )
        case 'text': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <input className="modal-in" style={{ maxWidth: 220 }} placeholder={r.placeholder}
              value={String(valueOf(r) ?? '')} onChange={e => change(r.key, e.target.value)} />
          </div>
        )
        case 'select': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <select className="modal-in" style={{ maxWidth: 220 }} value={String(valueOf(r) ?? '')} onChange={e => change(r.key, e.target.value)}>
              {r.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )
        case 'button': return (
          <div key={r.key} className="pqs-optrow">
            <div><div className="pqs-optt">{r.label}</div>{r.description && <div className="pqs-optd">{r.description}</div>}</div>
            <button className="pqs2-btn ghost" onClick={() => { void invokePlugin(pluginId, r.onClick, []) }}>Выполнить</button>
          </div>
        )
      }
    })}
  </>
}

export function PluginsSettings() {
  const [, setVer] = useState(0)
  const [pending, setPending] = useState<{ manifest: PluginManifest; code: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pages = useSettingsPages()

  // Список и состояние запуска меняются не только отсюда (плагин может упасть сам),
  // поэтому перерисовываемся по обоим сигналам.
  useEffect(() => {
    const bump = () => setVer(v => v + 1)
    const a = subscribePlugins(bump)
    const b = subscribePluginState(bump)
    return () => { a(); b() }
  }, [])

  const plugins = loadPlugins()

  async function pickFile(f: File | null) {
    if (fileRef.current) fileRef.current.value = ''
    if (!f) return
    if (f.size > MAX_PLUGIN_BYTES) { toastErr(`Файл больше ${MAX_PLUGIN_BYTES / 1024} КБ.`); return }
    try {
      const code = await f.text()
      setPending({ manifest: parsePlugin(code), code })
    } catch (err: any) {
      toastErr(err?.message ?? String(err))
    }
  }

  async function install() {
    if (!pending) return
    const { manifest, code } = pending
    setPending(null)
    try {
      await installPlugin(manifest, code)
      toastOk(`Плагин «${manifest.name}» установлен`)
    } catch (err: any) {
      toastErr(`Плагин установлен, но не запустился: ${err?.message ?? err}`)
    }
  }

  async function toggle(id: string, on: boolean) {
    setEnabled(id, on)
    if (!on) { await stopPlugin(id); return }
    const p = getPlugin(id)
    if (p) { try { await startPlugin(p) } catch { /* причина уже в pluginError */ } }
  }

  async function remove(id: string, name: string) {
    if (!await confirmUi(`Удалить плагин «${name}» вместе с его данными?`, { okText: 'Удалить', danger: true })) return
    await stopPlugin(id)
    removePlugin(id)
    toastOk('Плагин удалён')
  }

  return (
    <>
      <div className="pqs-sec-h">Плагины</div>
      <div className="pqs-optd" style={{ marginBottom: 14 }}>
        Плагины расширяют Ponoi: свои кнопки, команды и оформление. Выполняются в песочнице —
        доступ к твоему аккаунту и файлам у них закрыт. Ставятся на это устройство.
      </div>

      <button className="pqs2-btn" onClick={() => fileRef.current?.click()}>
        <Icon name="plus" size={16} /> Установить из файла
      </button>
      <input ref={fileRef} type="file" accept=".ponoi,.js,text/javascript" hidden
        onChange={e => void pickFile(e.target.files?.[0] ?? null)} />

      {plugins.length === 0 && <div className="modal-empty">Пока ни одного плагина.</div>}

      {plugins.map(p => {
        const err = pluginError(p.manifest.id)
        const page = pages.find(x => x.pluginId === p.manifest.id)
        const isOpen = open === p.manifest.id
        return (
          <div key={p.manifest.id} className="plug-card">
            <div className="plug-head">
              <div className="plug-name">
                {p.manifest.name}
                <span className="plug-ver">{p.manifest.version}</span>
                {p.enabled && isRunning(p.manifest.id) && <span className="plug-dot on" title="Работает" />}
                {p.enabled && !isRunning(p.manifest.id) && <span className="plug-dot off" title="Не запустился" />}
              </div>
              <div className="plug-actions">
                {page && p.enabled && (
                  <button className="pqs2-btn ghost" onClick={() => setOpen(isOpen ? null : p.manifest.id)}>
                    <Icon name="gear" size={15} /> Настройки
                  </button>
                )}
                <button className="pqs2-btn ghost danger" title="Удалить" onClick={() => void remove(p.manifest.id, p.manifest.name)}>
                  <Icon name="trash" size={15} />
                </button>
                <button className={'pqs-toggle' + (p.enabled ? ' on' : '')} onClick={() => void toggle(p.manifest.id, !p.enabled)}><span /></button>
              </div>
            </div>
            <div className="plug-sub">
              {p.manifest.description || 'без описания'} · автор: {p.manifest.author}
            </div>
            {p.manifest.permissions.length > 0 && (
              <div className="plug-perms-row">
                {p.manifest.permissions.map(perm => (
                  <span key={perm} className={'plug-chip' + (SENSITIVE_PERMISSIONS.includes(perm) ? ' warn' : '')}>{PERMISSION_LABEL[perm]}</span>
                ))}
              </div>
            )}
            {err && <div className="plug-err"><Icon name="flag" size={14} /> {err}</div>}
            {isOpen && page && (
              <div className="plug-settings">
                <PluginSettingsRows pluginId={p.manifest.id} rows={page.rows} />
              </div>
            )}
          </div>
        )
      })}

      {pending && (
        <PermissionGate
          manifest={pending.manifest}
          existing={getPlugin(pending.manifest.id)}
          onCancel={() => setPending(null)}
          onConfirm={() => void install()}
        />
      )}
    </>
  )
}
