import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { uploadTo, isImage } from '../lib/storage'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker } from './GifPicker'
import { Icon } from './icons'
import { Lightbox } from './Lightbox'
import { useSettings } from '../lib/settings'

const MENTION_TAIL = /@([\p{L}\p{N}_.\-]*)$/u
const MAXLEN = 2000

// Человекочитаемый размер файла для подсказки на ссылке скачивания.
function fmtSize(n: number): string {
  if (n < 1024) return n + ' Б'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ'
  return (n / 1048576).toFixed(1) + ' МБ'
}

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

// Типографика при отправке: -- становится тире, ... становится многоточием,
// случайные двойные пробелы схлопываются. Сообщения с кодом (`) не трогаем.
function polish(t: string): string {
  if (t.includes('\u0060')) return t
  return t.replace(/--/g, '\u2014').replace(/\.\.\./g, '\u2026').replace(/ {2,}/g, ' ')
}

function applySlash(t: string): string {
  const sp = t.indexOf(' ')
  const cmd = (sp === -1 ? t : t.slice(0, sp)).toLowerCase()
  const rep = SLASH[cmd]
  if (!rep) return t
  const rest = sp === -1 ? '' : t.slice(sp + 1).trim()
  return rest ? rest + ' ' + rep : rep
}

export function Composer({ placeholder, onSend, replyingTo, onCancelReply, onType, mentionables, draftKey }:
  { placeholder: string; onSend: (text: string, attach?: { url: string; type: string }) => Promise<void>;
    replyingTo?: { author: string; preview: string } | null; onCancelReply?: () => void; onType?: () => void;
    mentionables?: string[]; draftKey?: string }) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [spoiler, setSpoiler] = useState(false)
  const [busy, setBusy] = useState(false)
  const [emoji, setEmoji] = useState(false)
  const [gif, setGif] = useState(false)
  const [mQ, setMQ] = useState<string | null>(null)
  const [mIdx, setMIdx] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSent = useRef<{ t: string; at: number }>({ t: '', at: 0 })
  // Сообщение, которое не ушло из-за сбоя сети: текст остаётся в поле, баннер даёт повторить одной кнопкой.
  const [failed, setFailed] = useState(false)

  // Черновики: текст хранится отдельно для каждого канала/ЛС и переживает перезагрузку.
  useEffect(() => {
    if (draftKey === undefined) return
    setText(localStorage.getItem('ponoi_draft_' + draftKey) ?? '')
    setMQ(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])
  function keepDraft(v: string) {
    if (draftKey === undefined) return
    if (v) localStorage.setItem('ponoi_draft_' + draftKey, v)
    else localStorage.removeItem('ponoi_draft_' + draftKey)
  }

  // Любая буква/цифра возвращает фокус в строку ввода, где бы ни был курсор (как в Discord).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Drag-and-drop файла в чат + вставка картинки из буфера (Ctrl+V).
  const [drag, setDrag] = useState(false)
  const dragDepth = useRef(0)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDrag(true) }
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDrag(false) }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault(); dragDepth.current = 0; setDrag(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) { setFile(f); inputRef.current?.focus() }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

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

  function insertEmoji(t: string) { setText(x => { const nv = x + t; keepDraft(nv); return nv }); setEmoji(false) }
  async function sendGif(url: string) {
    setGif(false)
    if (!user) return
    setBusy(true)
    try { await onSend('', { url, type: 'image' }) } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const t = polish(applySlash(text.trim()))
    if ((!t && !file) || !user) return
    // Блокировка сообщений, состоящих только из пробелов и невидимых символов юникода.
    if (t && !file && !t.replace(/[\u200B-\u200F\u2060\uFEFF\u00A0\u034F\u2800\u3164]/g, '').trim()) return
    // Защита от дублей: одно и то же сообщение дважды подряд за секунду не уходит.
    if (t && !file && t === lastSent.current.t && Date.now() - lastSent.current.at < 1000) return
    if (t.length > MAXLEN) { toastErr('Сообщение слишком длинное — максимум ' + MAXLEN + ' символов'); return }
    setBusy(true)
    try {
      let attach: { url: string; type: string } | undefined
      if (file) {
        let url = await uploadTo('attachments', user.id, file)
        if (spoiler && isImage(file)) url += '#spoiler'
        attach = { url, type: isImage(file) ? 'image' : 'file' }
      }
      await onSend(t, attach)
      lastSent.current = { t, at: Date.now() }
      setFailed(false)
      setText(''); keepDraft(''); setFile(null); setSpoiler(false); setMQ(null); if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) { setFailed(true); toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  return (
    <>
      {drag && <div className="drop-overlay"><div className="drop-box">Отпусти, чтобы прикрепить файл<small>картинки, документы — что угодно</small></div></div>}
      {failed && !busy && <div className="send-fail">
        Сообщение не отправлено — проверь соединение
        <button type="button" onClick={e => { setFailed(false); submit(e as any) }}>Повторить</button>
        <button type="button" className="send-fail-x" title="Скрыть" onClick={() => setFailed(false)}>×</button>
      </div>}
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
          onChange={e => { const v = e.target.value; setText(v); keepDraft(v); if (v.trim()) onType?.(); if (emoji) setEmoji(false); if (gif) setGif(false); updateMention(v, e.target.selectionStart) }}
          onPaste={e => {
            const f = e.clipboardData?.files?.[0]
            if (f) { e.preventDefault(); setFile(f); return }
            // Вставленный текст очищаем от пробелов по краям.
            const p = e.clipboardData?.getData('text')
            if (p && p !== p.trim()) {
              e.preventDefault()
              const el = e.target as HTMLInputElement
              const s = el.selectionStart ?? text.length, en = el.selectionEnd ?? s
              const ins = p.trim()
              const nv = text.slice(0, s) + ins + text.slice(en)
              setText(nv); keepDraft(nv); updateMention(nv, s + ins.length)
              requestAnimationFrame(() => { const c = s + ins.length; el.setSelectionRange(c, c) })
            }
          }}
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
          {file && isImage(file) && <button type="button" className={'ctool spoiler-t' + (spoiler ? ' on' : '')}
            title={spoiler ? 'Картинка будет спойлером' : 'Отправить как спойлер'}
            onClick={() => setSpoiler(s => !s)}>| |</button>}
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
  const [revealed, setRevealed] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [size, setSize] = useState<string | null>(null)
  // Вес файла для подсказки: лёгкий HEAD-запрос, сам файл не скачивается.
  useEffect(() => {
    if (!url || type === 'image') { setSize(null); return }
    let on = true
    fetch(url.replace('#spoiler', ''), { method: 'HEAD' })
      .then(r => { const n = Number(r.headers.get('content-length')); if (on && n > 0) setSize(fmtSize(n)) })
      .catch(() => {})
    return () => { on = false }
  }, [url, type])
  if (!url) return null
  const clean = url.replace('#spoiler', '')
  if (type === 'image') {
    if (url.includes('#spoiler') && !revealed) return (
      <div className="att-spoiler" title="Спойлер — нажми, чтобы показать" onClick={() => setRevealed(true)}>
        <img className="msg-att blurred" src={clean} alt="спойлер" />
        <span className="att-spoiler-tag">СПОЙЛЕР</span>
      </div>
    )
    return <>
      <img className="msg-att zoomable" src={clean} alt="вложение" onClick={() => setViewer(true)} />
      {viewer && <Lightbox url={clean} onClose={() => setViewer(false)} />}
    </>
  }
  return <a className="msg-file" href={clean} target="_blank" rel="noreferrer" title={size ? 'Размер файла: ' + size : undefined}><Icon name="paperclip" size={16} /> Скачать файл{size && <span className="msg-file-size">{size}</span>}</a>
}
