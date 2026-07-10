import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastErr } from '../lib/toast'
import { scanLocalPack, uploadMissingMods, createPack, type QlManifest } from '../lib/quicklaunch'

const SCAN_ERRORS: Record<string, string> = {
  'no-minecraft': 'Minecraft не найден — папка .minecraft отсутствует.',
  'no-mods-folder': 'В сборке нет папки mods — делиться пока нечем.',
  'no-loader': 'Не удалось определить Forge/NeoForge — запусти сборку хотя бы раз через лаунчер.',
}

// v1.180.0: «Поделиться сборкой» — сканирует текущую сборку Minecraft, даёт
// указать адрес сервера и одной кнопкой заливает недостающие моды + создаёт
// карточку в чате (см. sysQuickLaunch в src/lib/sysmsg.ts).
export function ShareBuildModal({ hostId, onClose, onShared }: {
  hostId: string
  onClose: () => void
  onShared: (packId: string, manifest: QlManifest) => void
}) {
  const [manifest, setManifest] = useState<QlManifest | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('25565')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let ok = true
    scanLocalPack().then(r => {
      if (!ok) return
      if ('error' in r) setScanError(r.error)
      else setManifest(r)
    })
    return () => { ok = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const totalMb = manifest ? Math.round(manifest.mods.reduce((a, m) => a + m.size, 0) / 1024 / 1024) : 0

  async function share() {
    if (!manifest) return
    const cleanIp = ip.trim()
    if (!cleanIp) { toastErr('Укажи адрес сервера'); return }
    const p = parseInt(port, 10) || 25565
    setBusy(true); setProgress(0)
    try {
      await uploadMissingMods(manifest.mods, setProgress)
      const packId = await createPack(hostId, manifest, cleanIp, p)
      onShared(packId, manifest)
    } catch (err: any) {
      toastErr(err.message ?? String(err))
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
        <div className="modal-title">Поделиться сборкой</div>
        <div className="modal-sub">Друг сможет докачать недостающие моды и зайти к тебе одной кнопкой.</div>

        {scanError && <div className="cset-hint" style={{ marginTop: 16, textAlign: 'center' }}>{SCAN_ERRORS[scanError] ?? scanError}</div>}

        {!scanError && !manifest && <div className="modal-empty">Сканирую сборку…</div>}

        {manifest && <>
          <div className="sset-info" style={{ marginTop: 16 }}>
            <Icon name="gamepad" size={16} />
            <span>{manifest.mcVersion} · {manifest.loader === 'neoforge' ? 'NeoForge' : 'Forge'} {manifest.loaderVersion} · {manifest.mods.length} модов · {totalMb} МБ</span>
          </div>
          <label className="modal-lbl">Адрес сервера</label>
          <div className="modal-inline">
            <input className="modal-in" placeholder="IP или домен" value={ip} onChange={e => setIp(e.target.value)} disabled={busy} style={{ flex: 2 }} />
            <input className="modal-in" placeholder="Порт" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} disabled={busy} style={{ flex: 1, maxWidth: 90 }} />
          </div>
          {busy && <div className="up-progress" style={{ position: 'relative', marginTop: 14 }}>
            <div className="up-progress-fill" style={{ width: Math.round(progress * 100) + '%' }} />
            <span className="up-progress-tx">Заливаю моды… {Math.round(progress * 100)}%</span>
          </div>}
          <div className="modal-foot">
            <button className="modal-ghost" onClick={onClose} disabled={busy}>Отмена</button>
            <button className="modal-primary" onClick={share} disabled={busy || !ip.trim()}>{busy ? 'Отправка…' : 'Поделиться в чате'}</button>
          </div>
        </>}
      </div>
    </div>
  )
}
