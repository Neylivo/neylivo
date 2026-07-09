import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { uploadWithProgress, isImage, isVideo } from '../lib/storage'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker } from './GifPicker'
import { Icon } from './icons'
import { Lightbox } from './Lightbox'
import { CodeFileCard, isCodeFile } from './CodeFileCard'
import { useSettings } from '../lib/settings'

const MENTION_TAIL = /@([\p{L}\p{N}_.\-]*)$/u
const MAXLEN = 50000
// v1.150.0: лимит подняли до 50 000 символов — без анти-спам-проверки это была бы
// дыра для «залить чат 50 000 одинаковых букв». Реальный текст никогда не повторяет
// один и тот же символ подряд сотни раз, поэтому режем длинные однобуквенные пробеги.
const MAX_SAME_CHAR_RUN = 300
function hasSpamRun(t: string): boolean {
  let run = 1
  for (let i = 1; i < t.length; i++) {
    run = t[i] === t[i - 1] ? run + 1 : 1
    if (run > MAX_SAME_CHAR_RUN) return true
  }
  return false
}
// 40 ГБ — потолок для вложений (см. также migration 33: file_size_limit бакетов Storage).
const MAX_FILE_SIZE = 40 * 1024 ** 3

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
  // v1.70.0: несколько вложений в одном сообщении (как в Discord, до 10).
  const [files, setFiles] = useState<File[]>([])
  const [spoilers, setSpoilers] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [emoji, setEmoji] = useState(false)
  const [gif, setGif] = useState(false)
  const [mQ, setMQ] = useState<string | null>(null)
  const [mIdx, setMIdx] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSent = useRef<{ t: string; at: number }>({ t: '', at: 0 })
  // v1.42.0: синхронный замок от двойной отправки (второй Enter до того, как busy успеет выставиться)
  const sendingRef = useRef(false)
  // Сообщение, которое не ушло из-за сбоя сети: текст остаётся в поле, баннер даёт повторить одной кнопкой.
  const [failed, setFailed] = useState(false)
  // Прогресс загрузки файла (0..1) для полосы над композером; null — ничего не грузится.
  const [upProg, setUpProg] = useState<number | null>(null)
  // Предпросмотр картинки до отправки (v1.28.0): миниатюра + спойлер/просмотр/убрать.
  const [previews, setPreviews] = useState<string[]>([])
  const [pvOpen, setPvOpen] = useState<string | null>(null)
  useEffect(() => {
    const urls = files.map(f => isImage(f) ? URL.createObjectURL(f) : '')
    setPreviews(urls)
    return () => { urls.forEach(u => { if (u) URL.revokeObjectURL(u) }); setPvOpen(null) }
  }, [files])
  const MAXFILES = 10
  function addFiles(fs: File[]) {
    if (fs.length === 0) return
    const tooBig = fs.filter(f => f.size > MAX_FILE_SIZE)
    if (tooBig.length) toastErr('Слишком большой файл (максимум 40 ГБ): ' + tooBig.map(f => f.name).join(', '))
    const ok = fs.filter(f => f.size <= MAX_FILE_SIZE)
    if (ok.length === 0) return
    setFiles(prev => {
      const next = [...prev, ...ok]
      if (next.length > MAXFILES) toastErr('Не больше ' + MAXFILES + ' вложений в одном сообщении')
      return next.slice(0, MAXFILES)
    })
  }
  function removeFile(i: number) {
    setFiles(prev => prev.filter((_, x) => x !== i))
    setSpoilers(s => {
      const n: Record<number, boolean> = {}
      Object.keys(s).forEach(k => { const ki = Number(k); if (ki < i) n[ki] = s[ki]; else if (ki > i) n[ki - 1] = s[ki] })
      return n
    })
  }
  // Меню «плюса» слева (Фото / Файл / Папка / Голосовое) — как в Discord.
  const [plusMenu, setPlusMenu] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  // Запись голосового: { t } — секунды записи; recRef держит MediaRecorder.
  const [rec, setRec] = useState<{ t: number } | null>(null)
  const recRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; timer: number; cancel: boolean } | null>(null)

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

  // Внешние события (например, начало редактирования сообщения) закрывают панели эмодзи/GIF.
  useEffect(() => {
    const h = () => { setEmoji(false); setGif(false) }
    window.addEventListener('ponoi-close-pickers', h)
    return () => window.removeEventListener('ponoi-close-pickers', h)
  }, [])

  // Drag-and-drop файла в чат + вставка картинки из буфера (Ctrl+V).
  const [drag, setDrag] = useState(false)
  const dragDepth = useRef(0)
  useEffect(() => {
    // v1.127.0: перетаскивания, начавшиеся ВНУТРИ приложения (картинка из чата, аватарка и т.п.),
    // не считаются вложениями — прикрепить можно только файлы, притащенные снаружи (из проводника).
    let internalDrag = false
    const dstart = () => { internalDrag = true }
    const dend = () => { internalDrag = false }
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => { if (internalDrag || !hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDrag(true) }
    const over = (e: DragEvent) => { if (!internalDrag && hasFiles(e)) e.preventDefault() }
    const leave = (e: DragEvent) => { if (internalDrag || !hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDrag(false) }
    const drop = (e: DragEvent) => {
      if (internalDrag) { e.preventDefault(); internalDrag = false; dragDepth.current = 0; setDrag(false); return }
      if (!hasFiles(e)) return
      e.preventDefault(); dragDepth.current = 0; setDrag(false)
      const fs = Array.from(e.dataTransfer?.files ?? [])
      if (fs.length) { addFiles(fs); inputRef.current?.focus() }
    }
    window.addEventListener('dragstart', dstart, true)
    window.addEventListener('dragend', dend, true)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', dstart, true)
      window.removeEventListener('dragend', dend, true)
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

  // Горячие клавиши форматирования: оборачивают выделенный текст маркдауном (как в Discord).
  function wrapFormat(marker: string) {
    const el = inputRef.current
    if (!el) return
    const s = el.selectionStart ?? text.length, en = el.selectionEnd ?? s
    const sel = text.slice(s, en)
    const nv = text.slice(0, s) + marker + sel + marker + text.slice(en)
    setText(nv); keepDraft(nv)
    requestAnimationFrame(() => {
      el.focus()
      if (sel) el.setSelectionRange(s + marker.length, en + marker.length)
      else { const p = s + marker.length; el.setSelectionRange(p, p) }
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

  // Выбор папки (v1.70.0): файлы прикрепляются к сообщению группой (до 10),
  // можно добавить подпись и отправить всё одним сообщением.
  async function sendFiles(fs: File[]) {
    if (fs.length === 0) return
    addFiles(fs)
    inputRef.current?.focus()
  }

  // Голосовое сообщение: запись с микрофона, капсула с таймером, отмена/отправка.
  async function startRec() {
    if (recRef.current || !user) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop())
        const st = recRef.current
        recRef.current = null
        setRec(null)
        if (!st || st.cancel || !user) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        if (blob.size < 500) return
        const f = new File([blob], 'voice_' + Date.now() + '.webm', { type: 'audio/webm' })
        setBusy(true); setUpProg(0)
        try {
          const url = await uploadWithProgress('attachments', user.id, f, p => setUpProg(p))
          await onSend('', { url, type: 'audio' })
        } catch (err: any) { toastErr(err.message ?? String(err)) }
        finally { setBusy(false); setUpProg(null) }
      }
      mr.start()
      const timer = window.setInterval(() => setRec(r => r ? { t: r.t + 1 } : r), 1000)
      recRef.current = { mr, chunks, timer, cancel: false }
      setRec({ t: 0 })
    } catch { toastErr('Микрофон недоступен — проверь доступ в системе') }
  }
  function stopRec(send: boolean) {
    const st = recRef.current
    if (!st) return
    st.cancel = !send
    window.clearInterval(st.timer)
    try { st.mr.stop() } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || sendingRef.current) return   // v1.42.0: защита от двойной отправки
    const t = polish(applySlash(text.trim()))
    if ((!t && files.length === 0) || !user) return
    // Блокировка сообщений, состоящих только из пробелов и невидимых символов юникода.
    if (t && files.length === 0 && !t.replace(/[\u200B-\u200F\u2060\uFEFF\u00A0\u034F\u2800\u3164]/g, '').trim()) return
    // Защита от дублей: одно и то же сообщение дважды подряд за секунду не уходит.
    if (t && files.length === 0 && t === lastSent.current.t && Date.now() - lastSent.current.at < 1000) return
    if (t.length > MAXLEN) { toastErr('Сообщение слишком длинное — максимум ' + MAXLEN + ' символов'); return }
    if (t && hasSpamRun(t)) { toastErr('Слишком много одинаковых символов подряд'); return }
    sendingRef.current = true
    setBusy(true)
    try {
      let attach: { url: string; type: string } | undefined
      if (files.length) {
        const urls: string[] = []
        const types: string[] = []
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          setUpProg(files.length > 1 ? i / files.length : 0)
          let url = await uploadWithProgress('attachments', user.id, f,
            p => setUpProg(files.length > 1 ? (i + p) / files.length : p))
          if (spoilers[i] && isImage(f)) url += '#spoiler'
          urls.push(url)
          types.push(isImage(f) ? 'image' : isVideo(f) ? 'video' : 'file')
        }
        // v1.70.0: группа вложений кодируется в одну строку через \n — без миграции БД.
        attach = { url: urls.join('\n'), type: types.join('\n') }
      }
      await onSend(t, attach)
      lastSent.current = { t, at: Date.now() }
      setFailed(false)
      setText(''); keepDraft(''); setFiles([]); setSpoilers({}); setMQ(null); if (fileRef.current) fileRef.current.value = ''; if (photoRef.current) photoRef.current.value = ''
    } catch (err: any) { setFailed(true); toastErr(err.message ?? String(err)) }
    finally { setBusy(false); setUpProg(null); sendingRef.current = false }
  }

  return (
    <>
      {drag && <div className="drop-overlay"><div className="drop-box">Отпусти, чтобы прикрепить файл<small>картинки, документы — что угодно</small></div></div>}
      {failed && !busy && <div className="send-fail">
        Сообщение не отправлено — проверь соединение
        <button type="button" onClick={e => { setFailed(false); submit(e as any) }}>Повторить</button>
        <button type="button" className="send-fail-x" title="Скрыть" onClick={() => setFailed(false)}>×</button>
      </div>}
      {upProg !== null && <div className="up-progress">
        <div className="up-progress-fill" style={{ width: Math.round(upProg * 100) + '%' }} />
        <span className="up-progress-tx">Загрузка{files.length === 1 ? ' «' + files[0].name + '»' : files.length > 1 ? ' (файлов: ' + files.length + ')' : ''}… {Math.round(upProg * 100)}%</span>
      </div>}
      {files.length > 0 && upProg === null && <div className="att-row">
        {files.map((f, i) => isImage(f) && previews[i] ? (
          <div key={i} className="att-card">
            <div className="att-card-actions">
              <button type="button" className={'att-act' + (spoilers[i] ? ' on' : '')} title={spoilers[i] ? 'Картинка будет спойлером' : 'Отправить как спойлер'} onClick={() => setSpoilers(s => ({ ...s, [i]: !s[i] }))}><span className="att-sp">| |</span></button>
              <button type="button" className="att-act" title="Посмотреть" onClick={() => setPvOpen(previews[i])}><Icon name="zoom-in" size={16} /></button>
              <button type="button" className="att-act danger" title="Убрать вложение" onClick={() => removeFile(i)}><Icon name="trash" size={16} /></button>
            </div>
            <div className="att-thumb">
              <img src={previews[i]} alt="" className={spoilers[i] ? 'blurred' : ''} />
              {spoilers[i] && <span className="att-spoiler-tag">СПОЙЛЕР</span>}
            </div>
            <div className="att-card-nm" title={f.name}>{f.name}</div>
            <div className="att-card-sz">{fmtSize(f.size)}</div>
          </div>
        ) : (
          <div key={i} className="file-chip">
            <Icon name="paperclip" size={14} /> <b className="file-chip-nm">{f.name}</b> <span className="file-chip-sz">{fmtSize(f.size)}</span>
            <button type="button" className="file-chip-x" title="Убрать файл" onClick={() => removeFile(i)}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>}
      {pvOpen && <Lightbox url={pvOpen} onClose={() => setPvOpen(null)} />}
      {replyingTo && <div className="reply-banner">
        <Icon name="reply" size={14} /> Ответ <b>{replyingTo.author}</b>
        <span>{replyingTo.preview}</span>
        <button type="button" title="Отменить" onClick={() => onCancelReply?.()}><Icon name="close" size={14} /></button>
      </div>}
      {rec && <div className="voice-pill">
        <span className="voice-dot" />
        <b className="voice-time">{Math.floor(rec.t / 60)}:{String(rec.t % 60).padStart(2, '0')}</b>
        <button type="button" className="voice-x" title="Отменить запись" onClick={() => stopRec(false)}><Icon name="close" size={16} /></button>
        <button type="button" className="voice-send" title="Отправить голосовое" onClick={() => stopRec(true)}><Icon name="send" size={16} /></button>
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
        <div className="plus-wrap">
          <button type="button" className="attach-btn" title="Прикрепить" onClick={() => setPlusMenu(v => !v)}><Icon name="plus-circle" size={20} /></button>
          {plusMenu && <>
            <div className="plus-overlay" onClick={() => setPlusMenu(false)} />
            <div className="plus-menu">
              <button type="button" onClick={() => { setPlusMenu(false); photoRef.current?.click() }}><Icon name="image" size={17} /> Фото</button>
              <button type="button" onClick={() => { setPlusMenu(false); fileRef.current?.click() }}><Icon name="paperclip" size={17} /> Файл</button>
              <button type="button" onClick={() => { setPlusMenu(false); folderRef.current?.click() }}><Icon name="folder" size={17} /> Папка</button>
              <button type="button" onClick={() => { setPlusMenu(false); startRec() }}><Icon name="mic" size={17} /> Голосовое</button>
            </div>
          </>}
        </div>
        <input ref={fileRef} type="file" hidden multiple onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <input ref={photoRef} type="file" accept="image/*" hidden multiple onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '' } as any)} onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; sendFiles(fs) }} />
        <input ref={inputRef} placeholder={files.length === 1 ? files[0].name : files.length > 1 ? 'Вложений: ' + files.length : placeholder} value={text}
          onChange={e => { const v = e.target.value; setText(v); keepDraft(v); if (v.trim()) onType?.(); if (emoji) setEmoji(false); if (gif) setGif(false); updateMention(v, e.target.selectionStart) }}
          onPaste={e => {
            const pf = Array.from(e.clipboardData?.files ?? [])
            if (pf.length) { e.preventDefault(); addFiles(pf); return }
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
            // Ctrl+B — жирный, Ctrl+I — курсив, Ctrl+E — код, Ctrl+Shift+S — спойлер.
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
              const k = e.key.toLowerCase()
              if (k === 'b') { e.preventDefault(); wrapFormat('**'); return }
              if (k === 'i') { e.preventDefault(); wrapFormat('*'); return }
              if (k === 'e') { e.preventDefault(); wrapFormat('`'); return }
              if (e.shiftKey && k === 's') { e.preventDefault(); wrapFormat('||'); return }
            }
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
          <button type="button" className="ctool ctool-clip" title="Прикрепить файл" onClick={() => fileRef.current?.click()}><Icon name="paperclip" size={20} /></button>
          <button type="button" className="ctool" title="Эмодзи" onClick={() => { setEmoji(v => !v); setGif(false) }}><Icon name="smile" size={20} /></button>
          <button type="button" className="ctool gif-badge" title="GIF, стикеры и эмодзи" onClick={() => { setGif(g => !g); setEmoji(false) }}><span className="gif-badge-oval"><i>G</i><i>I</i><i>F</i></span></button>
          <button type="button" className={'ctool' + (rec ? ' rec-on' : '')} title="Голосовое сообщение" onClick={() => rec ? stopRec(true) : startRec()}><Icon name="mic" size={20} /></button>
          {emoji && <div className="pop-anchor"><EmojiPicker onPick={insertEmoji} onClose={() => setEmoji(false)} /></div>}
          {gif && <div className="pop-anchor"><GifPicker onPick={sendGif} onClose={() => setGif(false)} onEmojiTab={() => { setGif(false); setEmoji(true) }} /></div>}
        </div>
        {!busy && <button type="submit" className="send-tg" title="Отправить"><Icon name="send" size={18} /></button>}
        {busy && <button type="submit" className="send-busy" disabled>…</button>}
      </form>
    </>
  )
}

export function Attachment({ url, type, meta }: { url?: string | null; type?: string | null; meta?: import('./Lightbox').LightboxMeta }) {
  const [revealed, setRevealed] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [size, setSize] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Вес файла для подсказки: лёгкий HEAD-запрос, сам файл не скачивается.
  useEffect(() => {
    if (!url || type === 'image' || type === 'video' || url.includes('\n')) { setSize(null); return }
    let on = true
    fetch(url.replace('#spoiler', ''), { method: 'HEAD' })
      .then(r => { const n = Number(r.headers.get('content-length')); if (on && n > 0) setSize(fmtSize(n)) })
      .catch(() => {})
    return () => { on = false }
  }, [url, type])
  if (!url) return null
  // v1.70.0: группа вложений в одном сообщении — url/type склеены через \n.
  if (url.includes('\n')) {
    const urls = url.split('\n')
    const types = (type ?? '').split('\n')
    const imgCount = types.filter(t => t === 'image').length
    return <div className={'att-group' + (imgCount > 1 ? ' grid' : '')}>
      {urls.map((u, i) => <Attachment key={i} url={u} type={types[i] ?? type} meta={meta} />)}
    </div>
  }
  const clean = url.replace('#spoiler', '')
  // Голосовое сообщение / аудио — встроенный плеер.
  if (type === 'audio') return <audio className="msg-audio" controls preload="metadata" src={clean} />
  if (type === 'image') {
    if (failed) return (
      <a className="msg-att-broken" href={clean} target="_blank" rel="noreferrer" title="Открыть ссылку в браузере">
        <Icon name="image" size={16} /> Не удалось загрузить изображение
      </a>
    )
    if (url.includes('#spoiler') && !revealed) return (
      <div className="att-spoiler" title="Спойлер — нажми, чтобы показать" onClick={() => setRevealed(true)}>
        <img className="msg-att blurred" src={clean} alt="спойлер" loading="lazy" decoding="async" draggable={false} onDragStart={e => e.preventDefault()} onError={() => setFailed(true)} />
        <span className="att-spoiler-tag">СПОЙЛЕР</span>
      </div>
    )
    return <>
      <img className="msg-att zoomable" src={clean} alt="вложение" loading="lazy" decoding="async" draggable={false} onDragStart={e => e.preventDefault()} onClick={() => setViewer(true)} onError={() => setFailed(true)} />
      {viewer && <Lightbox url={clean} meta={meta} onClose={() => setViewer(false)} />}
    </>
  }
  // v1.153.0: видео проигрывается прямо в чате (как в Discord), не скачивается как файл.
  if (type === 'video') {
    if (failed) return (
      <a className="msg-att-broken" href={clean} target="_blank" rel="noreferrer" title="Открыть ссылку в браузере">
        <Icon name="video" size={16} /> Не удалось загрузить видео
      </a>
    )
    return <video className="msg-att msg-att-video" controls preload="metadata" src={clean} onError={() => setFailed(true)} />
  }
  // v1.83.0: txt и файлы с кодом — карточка с подсветкой, 1-в-1 как в Discord.
  if (isCodeFile(clean)) return <CodeFileCard url={clean} sizeLabel={size} />
  return <a className="msg-file" href={clean} target="_blank" rel="noreferrer" title={size ? 'Размер файла: ' + size : undefined}><Icon name="paperclip" size={16} /> Скачать файл{size && <span className="msg-file-size">{size}</span>}</a>
}
