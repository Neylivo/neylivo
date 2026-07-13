import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { uploadTo } from '../lib/storage'
import { toastErr } from '../lib/toast'
import type { ShareCardCustom } from './ShareBuildModal'

const GAME_LABEL: Record<string, string> = { roblox: 'Roblox', cs2: 'Counter-Strike 2', terraria: 'Terraria' }
const DEFAULT_PORT: Record<string, string> = { cs2: '27015', terraria: '7777' }

// v1.184.0: «Поделиться игрой» для Roblox — всё уже известно из детекта игры
// (placeId/jobId читаются из лога Roblox в main-процессе, см. robloxCurrentSession()
// в electron/main.cjs), просто подтверждение. v1.192.0: CS2/Terraria — хостовский
// сервер автоматически не определить (ни GSI, ни файлы Terraria этого не отдают),
// поэтому для них добавлены поля IP/порт, как в ShareBuildModal.tsx (Minecraft).
// v1.285.0: своя карточка — фон/заголовок/подпись, как у «Поделиться сборкой».
export function ShareGameLinkModal({ game, label, hostId, onClose, onShared }: {
  game: 'roblox' | 'cs2' | 'terraria'
  label: string | null
  hostId: string
  onClose: () => void
  onShared: (ip: string, port: number, card: ShareCardCustom) => void
}) {
  const needsAddr = game !== 'roblox'
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT[game] ?? '')
  const [cardTitle, setCardTitle] = useState('')
  const [cardSubtitle, setCardSubtitle] = useState('')
  const [cardBgFile, setCardBgFile] = useState<File | null>(null)
  const [cardBgPreview, setCardBgPreview] = useState<string | null>(null)
  const cardBgPreviewRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cardBgRef = useRef<HTMLInputElement>(null)
  const portNum = parseInt(port, 10)
  const portValid = !needsAddr || (Number.isFinite(portNum) && portNum > 0 && portNum <= 65535)

  function pickCardBg(f: File | null) {
    if (cardBgPreviewRef.current) URL.revokeObjectURL(cardBgPreviewRef.current)
    const url = f ? URL.createObjectURL(f) : null
    cardBgPreviewRef.current = url
    setCardBgFile(f)
    setCardBgPreview(url)
  }
  useEffect(() => () => { if (cardBgPreviewRef.current) URL.revokeObjectURL(cardBgPreviewRef.current) }, [])

  async function share() {
    setBusy(true)
    try {
      const cardBg = cardBgFile ? await uploadTo('attachments', hostId, cardBgFile) : undefined
      onShared(ip.trim(), portNum, { cardBg, cardTitle: cardTitle.trim() || undefined, cardSubtitle: cardSubtitle.trim() || undefined })
    } catch (err: any) {
      toastErr(err.message ?? String(err))
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
        <div className="modal-title">Поделиться игрой</div>
        <div className="modal-sub">Друг сможет присоединиться прямо к твоей игре одной кнопкой.</div>
        <div className="sset-info" style={{ marginTop: 16 }}>
          <Icon name="gamepad" size={16} />
          <span>{GAME_LABEL[game]}{label ? ' · ' + label : ''}</span>
        </div>
        {needsAddr && <>
          <label className="modal-lbl">Адрес сервера</label>
          <div className="modal-inline">
            <input className="modal-in" placeholder="IP или домен" value={ip} onChange={e => setIp(e.target.value)} disabled={busy} style={{ flex: 2 }} />
            <input className="modal-in" placeholder="Порт" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} disabled={busy} style={{ flex: 1, maxWidth: 90 }} />
          </div>
        </>}

        <label className="modal-lbl">Карточка в чате (необязательно)</label>
        <input className="modal-in" placeholder={GAME_LABEL[game]} value={cardTitle} onChange={e => setCardTitle(e.target.value)} disabled={busy} />
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

        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="modal-primary" disabled={busy || (needsAddr && !ip.trim()) || !portValid} onClick={share}>{busy ? 'Отправка…' : 'Поделиться в чате'}</button>
        </div>
      </div>
    </div>
  )
}
