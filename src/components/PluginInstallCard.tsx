import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { parsePlugin, MAX_PLUGIN_BYTES } from '../lib/plugins/manifest'
import { getPlugin } from '../lib/plugins/store'
import { installPlugin } from '../lib/plugins/install'
import { PermissionGate } from './PluginPermissionGate'
import { SENSITIVE_PERMISSIONS, PERMISSION_LABEL, type PluginManifest } from '../lib/plugins/types'

// v1.286.0: файл .ponoi, отправленный в чат, показывается карточкой плагина — с
// названием, автором и списком разрешений — вместо безымянного вложения. Установка
// всё равно идёт через тот же экран подтверждения, что и из настроек: карточка
// экономит клики, но не отменяет согласия.

export function isPluginFile(url: string): boolean {
  return /\.ponoi(\?|#|$)/i.test(url)
}

export function PluginInstallCard({ url, sizeLabel }: { url: string; sizeLabel?: string | null }) {
  const [manifest, setManifest] = useState<PluginManifest | null>(null)
  const [code, setCode] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    let ok = true
    ;(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error('не удалось скачать файл')
        // Читаем как текст, но с потолком: карточка не должна тянуть в память
        // что-то огромное только потому, что кто-то переименовал архив в .ponoi.
        const text = (await res.text()).slice(0, MAX_PLUGIN_BYTES + 1)
        if (!ok) return
        setCode(text)
        setManifest(parsePlugin(text))
      } catch (err: any) {
        if (ok) setError(err?.message ?? String(err))
      }
    })()
    return () => { ok = false }
  }, [url])

  if (error) return (
    <div className="plug-msg-card bad">
      <Icon name="flag" size={16} />
      <span>Это не похоже на плагин: {error}</span>
    </div>
  )
  if (!manifest) return (
    <div className="plug-msg-card">
      <Icon name="cube" size={16} />
      <span className="mut">Читаю плагин…</span>
    </div>
  )

  const existing = getPlugin(manifest.id)
  return <>
    <div className="plug-msg-card">
      <div className="plug-msg-head">
        <Icon name="cube" size={18} />
        <div className="plug-msg-name">
          {manifest.name} <span className="plug-ver">{manifest.version}</span>
          <div className="plug-msg-author">автор: {manifest.author}{sizeLabel ? ' · ' + sizeLabel : ''}</div>
        </div>
      </div>
      {manifest.description && <div className="plug-msg-desc">{manifest.description}</div>}
      {manifest.permissions.length > 0 && (
        <div className="plug-perms-row">
          {manifest.permissions.map(p => (
            <span key={p} className={'plug-chip' + (SENSITIVE_PERMISSIONS.includes(p) ? ' warn' : '')}>{PERMISSION_LABEL[p]}</span>
          ))}
        </div>
      )}
      <div className="plug-msg-foot">
        <a className="pqs2-btn ghost" href={url} target="_blank" rel="noreferrer">Посмотреть код</a>
        <button className="pqs2-btn" onClick={() => setGate(true)}>
          {installed ? 'Установлено' : existing ? 'Обновить' : 'Установить'}
        </button>
      </div>
    </div>
    {gate && (
      <PermissionGate
        manifest={manifest}
        existing={existing}
        onCancel={() => setGate(false)}
        onConfirm={async () => {
          setGate(false)
          try {
            await installPlugin(manifest, code)
            setInstalled(true)
            toastOk(`Плагин «${manifest.name}» установлен`)
          } catch (err: any) {
            toastErr(`Плагин установлен, но не запустился: ${err?.message ?? err}`)
          }
        }}
      />
    )}
  </>
}
