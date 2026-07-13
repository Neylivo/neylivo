import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { toastErr } from '../lib/toast'
import { scanLocalPack, uploadMissingMods, createPack, listSources, type QlManifest, type QlSource } from '../lib/quicklaunch'
import { uploadTo } from '../lib/storage'

const SCAN_ERRORS: Record<string, string> = {
  'no-minecraft': 'Minecraft не найден — папка .minecraft отсутствует.',
  'no-mods-folder': 'В сборке нет папки mods — делиться пока нечем.',
  'no-loader': 'Не удалось определить загрузчик — запусти сборку хотя бы раз через лаунчер.',
}
const LOADER_LABEL: Record<string, string> = { neoforge: 'NeoForge', forge: 'Forge', fabric: 'Fabric' }

export interface ShareCardCustom { cardBg?: string; cardTitle?: string; cardSubtitle?: string }

// v1.180.0: «Поделиться сборкой» — сканирует текущую сборку Minecraft, даёт
// указать адрес сервера и одной кнопкой заливает недостающие моды + создаёт
// карточку в чате (см. sysQuickLaunch в src/lib/sysmsg.ts).
// v1.285.0: источник (обычный лаунчер / инстанс Prism), режим «только версия»
// (без сканирования и докачки модов — для случаев, когда у друга та же сборка
// уже стоит и нужен только IP) и свободная кастомизация карточки (фон/текст).
export function ShareBuildModal({ hostId, onClose, onShared }: {
  hostId: string
  onClose: () => void
  onShared: (packId: string, manifest: QlManifest, card: ShareCardCustom) => void
}) {
  const [sources, setSources] = useState<QlSource[] | null>(null)
  const [source, setSource] = useState<QlSource | null>(null)
  const [fast, setFast] = useState(false)
  const [manifest, setManifest] = useState<QlManifest | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('25565')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [cardTitle, setCardTitle] = useState('')
  const [cardSubtitle, setCardSubtitle] = useState('')
  const [cardBgFile, setCardBgFile] = useState<File | null>(null)
  const [cardBgPreview, setCardBgPreview] = useState<string | null>(null)
  const cardBgRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let ok = true
    listSources().then(list => { if (ok) setSources(list) })
    return () => { ok = false }
  }, [])

  useEffect(() => {
    let ok = true
    setManifest(null); setScanError(null)
    const src = source?.prismInstance ? { prismInstance: source.prismInstance } : undefined
    scanLocalPack(src, { fast }).then(r => {
      if (!ok) return
      if ('error' in r) setScanError(r.error)
      else setManifest(r)
    })
    return () => { ok = false }
  }, [source, fast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  function pickCardBg(f: File | null) {
    setCardBgFile(f)
    setCardBgPreview(f ? URL.createObjectURL(f) : null)
  }

  const totalMb = manifest ? Math.round(manifest.mods.reduce((a, m) => a + m.size, 0) / 1024 / 1024) : 0

  async function share() {
    if (!manifest) return
    const cleanIp = ip.trim()
    if (!cleanIp) { toastErr('Укажи адрес сервера'); return }
    const p = parseInt(port, 10) || 25565
    const src = source?.prismInstance ? { prismInstance: source.prismInstance } : undefined
    setBusy(true); setProgress(0)
    try {
      if (!fast) await uploadMissingMods(manifest.mods, setProgress, src)
      const packId = await createPack(hostId, manifest, cleanIp, p)
      const cardBg = cardBgFile ? await uploadTo('attachments', hostId, cardBgFile) : undefined
      onShared(packId, manifest, { cardBg, cardTitle: cardTitle.trim() || undefined, cardSubtitle: cardSubtitle.trim() || undefined })
    } catch (err: any) {
      toastErr(err.message ?? String(err))
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
        <div className="modal-title">Поделиться сборкой</div>
        <div className="modal-sub">{fast ? 'Друг увидит версию и лоадер и подключится одной кнопкой — без докачки модов.' : 'Друг сможет докачать недостающие моды и зайти к тебе одной кнопкой.'}</div>

        {sources && sources.length > 1 && <>
          <label className="modal-lbl">Что делиться</label>
          <select className="modal-in" value={source?.id ?? sources[0].id} disabled={busy}
            onChange={e => setSource(sources.find(s => s.id === e.target.value) ?? null)}>
            {sources.map(s => <option key={s.id} value={s.id}>{s.label}{s.mcVersion ? ` (${s.mcVersion})` : ''}</option>)}
          </select>
        </>}

        <label className="modal-check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={fast} onChange={e => setFast(e.target.checked)} disabled={busy} />
          <span>Только версия, без модов (быстрее для друга)</span>
        </label>

        {scanError && <div className="cset-hint" style={{ marginTop: 16, textAlign: 'center' }}>{SCAN_ERRORS[scanError] ?? scanError}</div>}

        {!scanError && !manifest && <div className="modal-empty">Сканирую сборку…</div>}

        {manifest && <>
          <div className="sset-info" style={{ marginTop: 16 }}>
            <Icon name="gamepad" size={16} />
            <span>{manifest.mcVersion} · {LOADER_LABEL[manifest.loader] ?? manifest.loader} {manifest.loaderVersion} · {fast ? 'без модов' : manifest.mods.length + ' модов · ' + totalMb + ' МБ'}</span>
          </div>
          <label className="modal-lbl">Адрес сервера</label>
          <div className="modal-inline">
            <input className="modal-in" placeholder="IP или домен" value={ip} onChange={e => setIp(e.target.value)} disabled={busy} style={{ flex: 2 }} />
            <input className="modal-in" placeholder="Порт" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} disabled={busy} style={{ flex: 1, maxWidth: 90 }} />
          </div>

          <label className="modal-lbl">Карточка в чате (необязательно)</label>
          <input className="modal-in" placeholder={`${manifest.mcVersion} — ${LOADER_LABEL[manifest.loader] ?? manifest.loader}`} value={cardTitle} onChange={e => setCardTitle(e.target.value)} disabled={busy} />
          <input className="modal-in" style={{ marginTop: 8 }} placeholder="Подпись под заголовком" value={cardSubtitle} onChange={e => setCardSubtitle(e.target.value)} disabled={busy} />
          <div className="modal-inline" style={{ marginTop: 8, alignItems: 'center' }}>
            <button type="button" className="pqs2-btn ghost" onClick={() => cardBgRef.current?.click()} disabled={busy}>Фон карточки…</button>
            <input ref={cardBgRef} type="file" accept="image/*" hidden disabled={busy}
              onChange={e => pickCardBg(e.target.files?.[0] ?? null)} />
            {cardBgPreview && <>
              <span className="ql-bg-thumb" style={{ backgroundImage: `url(${cardBgPreview})` }} />
              <button type="button" className="pqs2-btn ghost" onClick={() => pickCardBg(null)} disabled={busy}>Убрать</button>
            </>}
          </div>

          {busy && !fast && <div className="up-progress" style={{ position: 'relative', marginTop: 14 }}>
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
