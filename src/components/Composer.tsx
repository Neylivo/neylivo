import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo, isImage } from '../lib/storage'

export function Composer({ placeholder, onSend }:
  { placeholder: string; onSend: (text: string, attach?: { url: string; type: string }) => Promise<void> }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if ((!t && !file) || !user) return
    setBusy(true)
    try {
      let attach: { url: string; type: string } | undefined
      if (file) {
        const url = await uploadTo('attachments', user.id, file)
        attach = { url, type: isImage(file) ? 'image' : 'file' }
      }
      await onSend(t, attach)
      setText(''); setFile(null); if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) { alert(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <button type="button" className="attach-btn" title="Прикрепить файл" onClick={() => fileRef.current?.click()}>＋</button>
      <input ref={fileRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <input placeholder={file ? ('📎 ' + file.name) : placeholder} value={text} onChange={e => setText(e.target.value)} />
      <button type="submit" disabled={busy}>{busy ? '…' : '➤'}</button>
    </form>
  )
}

export function Attachment({ url, type }: { url?: string | null; type?: string | null }) {
  if (!url) return null
  if (type === 'image') return <a href={url} target="_blank" rel="noreferrer"><img className="msg-att" src={url} alt="вложение" /></a>
  return <a className="msg-file" href={url} target="_blank" rel="noreferrer">📎 Скачать файл</a>
}
