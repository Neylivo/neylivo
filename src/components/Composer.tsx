import { toastErr } from '../lib/toast'
import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo, isImage } from '../lib/storage'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker } from './GifPicker'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'

const MENTION_TAIL = /@([\p{L}\p{N}_.\-]*)$/u
const MAXLEN = 2000

// Команды-камодзи как в Discord: /shrug и компания.
const SLASH: Record<string, string> = {
  '/shrug': '\u00af\\_(\u30c4)_/\u00af',
  '/tableflip': '(\u256f\u00b0\u25a1\u00b0)\u256f\ufe35 \u253b\u2501\u253b',
  '/unflip': '\u252c\u2500\u252c \u30ce( \u309c-\u309c\u30ce)',
  '/lenny': '( \u0361\u00b0 \u035c\u0296 \u0361\u00b0)',
  '/happy': '(\u1d54\u25e1\u1d54)',
  '/cry': '(\u2565\ufe4f\u2565)',
  '/bear': '\u0295\u2022\u1d25\u2022\u0294',
}

function applySlash(t: string): string {
  const sp = t.indexOf(' ')
  const cmd = (sp === -1 ? t : t.slice(0, sp)).toLowerCase()
  const rep = SLASH[cmd]
  if (!rep) return t
  const rest = sp === -1 ? '' : t.slice(sp + 1).trim()
  return rest ? rest + ' ' + rep : rep
}

export function Composer({ placeholder, onSend, replyingTo, onCancelReply, onType, mentionables }:
  { placeholder: string; onSend: (text: string, attach?: { url: string; type: string }) => Promise<void>;
    replyingTo?: { author: string; preview: string } | null; onCancelReply?: () => void; onType?: () => void;
    mentionables?: string[] }) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [emoji, setEmoji] = useState(false)
  const [gif, setGif] = useState(false)
  const [mQ, setMQ] = useState<string | null>(null)
  const [mIdx, setMIdx] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Автодополнение @упоминаний: имена участников + @everyone.
  const names = Array.from(new Set(['everyone', ...(mentionables ?? [])])).filter(Boolean)
  const sugg = mQ !== null
    ? names.filter(n => n.toLowerCase().startsWith(mQ.toLowerCase())).slice(0, 8)
    : []

  function updateMention(v: string, caret: number | null) {
    const upto = v.slice(0, caret ?? v.length)
    const m = upto.match(MENTION_TAIL)
    setMQ(m ? m[1] : null)
    setMIdx(0)
  }

  function pickMention(name: string) {
    const el = inputRef.current
    const caret = el?.selectionStart ?? text.length
    const upto = text.slice(0, caret)
    const m = upto.match(MENTION_TAIL)
    if (!m) { setMQ(null); return }
    const start = caret - m[0].length
    const next = text.slice(0, start) + '@' + name + ' ' + text.slice(caret)
    setText(next)
    setMQ(null)
    requestAnimationFrame(() => {
      const p = start + name.length + 2
      el?.focus(); el?.setSelectionRange(p, p)
    })
  }

  function insertEmoji(t: string) { setText(x => x + t); setEmoji(false) }
  async function sendGif(url: string) {
    setGif(false)
    if (!user) return
    setBusy(true)
    try { await onSend('', { url, type: 'image' }) } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const t = applySlash(text.trim())
    if ((!t && !file) || !user) return
    if (t.length > MAXLEN) { toastErr('Сообщение слишком длинное — максимум ' + MAXLEN + ' символов'); return }
    setBusy(true)
    try {
      let attach: { url: string; type: string } | undefined
      if (file) {
        const url = await uploadTo('attachments', user.id, file)
        attach = { url, type: isImage(file) ? 'image' : 'file' }
      }
      await onSend(t, attach)
      setText(''); setFile(null); setMQ(null); if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  return (
    <>
      {replyingTo && <div className="reply-banner">
        <Icon name="reply" size={14} /> Ответ <b>{replyingTo.author}</b>
        <span>{replyingTo.preview}</span>
        <button type="button" title="Отменить" onClick={() => onCancelReply?.()}><Icon name="close" size={14} /></button>
      </div>}
      <form className="composer" onSubmit={submit}>
        {sugg.length > 0 && <div className="mention-pop">
          <div className="mention-h">Упомянуть</div>
          {sugg.map((n, i) => (
            <div key={n} className={'mention-it' + (i === mIdx ? ' on' : '')}
              onMouseEnter={() => setMIdx(i)}
              onMouseDown={e => { e.preventDefault(); pickMention(n) }}>
              <span className="mention-at">@</span>{n}
              {n === 'everyone' && <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>все участники</span>}
            </div>
          ))}
        </div>}
        <button type="button" className="attach-btn" title="Прикрепить файл" onClick={() => fileRef.current?.click()}><Icon name="plus-circle" size={20} /></button>
        <input ref={fileRef} type="file" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <input ref={inputRef} placeholder={file ? file.name : placeholder} value={text}
          onChange={e => { setText(e.target.value); onType?.(); updateMention(e.target.value, e.target.selectionStart) }}
          onClick={e => updateMention(text, (e.target as HTMLInputElement).selectionStart)}
          onKeyDown={e => {
            if (sugg.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMIdx(i => (i + 1) % sugg.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMIdx(i => (i - 1 + sugg.length) % sugg.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(sugg[mIdx]); return }
              if (e.key === 'Escape') { e.preventDefault(); setMQ(null); return }
            }
            if (e.key === 'ArrowUp' && !text) { e.preventDefault(); window.dispatchEvent(new Event('ponoi-edit-last')); return }
            if (e.key === 'Escape') { setEmoji(false); setGif(false); onCancelReply?.(); return }
            if (e.key === 'Enter') {
              const hasCtrl = e.ctrlKey || e.metaKey
              if (settings.sendKey === 'ctrl') {
                if (hasCtrl) { e.preventDefault(); submit(e as any) } else { e.preventDefault() }
              }
              // 'enter' mode: let the form submit naturally
            }
          }} />
        {text.length > MAXLEN - 200 && <span className={'char-count' + (text.length > MAXLEN ? ' over' : '')}>{MAXLEN - text.length}</span>}
        <div className="composer-tools">
          <button type="button" className="ctool" title="GIF" onClick={() => { setGif(g => !g); setEmoji(false) }}>GIF</button>
          <button type="button" className="ctool" title="Эмодзи" onClick={() => { setEmoji(v => !v); setGif(false) }}><Icon name="smile" size={20} /></button>
          {emoji && <div className="pop-anchor"><EmojiPicker onPick={insertEmoji} onClose={() => setEmoji(false)} /></div>}
          {gif && <div className="pop-anchor"><GifPicker onPick={sendGif} onClose={() => setGif(false)} /></div>}
        </div>
        <button type="submit" disabled={busy}>{busy ? '…' : <Icon name="send" size={18} />}</button>
      </form>
    </>
  )
}

export function Attachment({ url, type }: { url?: string | null; type?: string | null }) {
  if (!url) return null
  if (type === 'image') return <a href={url} target="_blank" rel="noreferrer"><img className="msg-att" src={url} alt="вложение" /></a>
  return <a className="msg-file" href={url} target="_blank" rel="noreferrer"><Icon name="paperclip" size={16} /> Скачать файл</a>
}
