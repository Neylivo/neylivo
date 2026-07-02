import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo, isImage } from '../lib/storage'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker } from './GifPicker'

export function Composer({ placeholder, onSend }:
  { placeholder: string; onSend: (text: string, attach?: { url: string; type: string }) => Promise<void> }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [emoji, setEmoji] = useState(false)
  const [gif, setGif] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function insertEmoji(t: string) { setText(x => x + t); setEmoji(false) }
  async function sendGif(url: string) {
    setGif(false)
    if (!user) return
    setBusy(true)
    try { await onSend('', { url, type: 'image' }) } catch (err: any) { alert(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

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
      <input placeholder={file ? ('📎 ' + file.name) : placeholder} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setEmoji(false); setGif(false) } }} />
      <div className="composer-tools">
        <button type="button" className="ctool" title="GIF" onClick={() => { setGif(g => !g); setEmoji(false) }}>GIF</button>
        <button type="button" className="ctool" title="Эмодзи" onClick={() => { setEmoji(v => !v); setGif(false) }}>😊</button>
        {emoji && <div className="pop-anchor"><EmojiPicker onPick={insertEmoji} onClose={() => setEmoji(false)} /></div>}
        {gif && <div className="pop-anchor"><GifPicker onPick={sendGif} onClose={() => setGif(false)} /></div>}
      </div>
      <button type="submit" disabled={busy}>{busy ? '…' : '➤'}</button>
    </form>
  )
}

export function Attachment({ url, type }: { url?: string | null; type?: string | null }) {
  if (!url) return null
  if (type === 'image') return <a href={url} target="_blank" rel="noreferrer"><img className="msg-att" src={url} alt="вложение" /></a>
  return <a className="msg-file" href={url} target="_blank" rel="noreferrer">📎 Скачать файл</a>
}
