import { toastErr } from '../lib/toast'
import { useEffect, useRef, useState } from 'react'
import { Room } from '../lib/livekit'
import { CallRecorder, playToAll } from '../lib/callAudio'
import { fetchClips, addClip, removeClip, decodeAudio, audioBufferToWav, fmtDur, saveMoment as saveMomentClip, type Clip } from '../lib/soundboard'
import { uploadTo } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { Icon } from './icons'

export function Soundboard({ room, recorder, meId, meName, onClose }:
  { room: Room; recorder: CallRecorder | null; meId: string; meName: string; onClose: () => void }) {
  const [clips, setClips] = useState<Clip[]>([])
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [trim, setTrim] = useState<{ clip: Clip; buf: AudioBuffer; start: number; end: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<HTMLAudioElement | null>(null)

  async function refresh() { setClips(await fetchClips()) }

  useEffect(() => {
    refresh()
    const ch = supabase.channel('soundboard_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'soundboard_clips' }, () => refresh())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Закрыли панель во время предпрослушивания — не оставляем звук играть в фоне.
  useEffect(() => () => { previewRef.current?.pause() }, [])

  // Save the last 15 seconds of the ongoing call as a clip.
  async function saveMoment() {
    setBusy('moment')
    try {
      await saveMomentClip(recorder, meId, meName, 15)
      refresh()
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setBusy('') }
  }

  // Upload any audio from device as a soundboard sound.
  async function uploadAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setBusy('upload')
    try {
      for (const f of files) {
        let dur = 0
        try { const b = await decodeAudio(await f.arrayBuffer()); dur = b.duration } catch {}
        const url = await uploadTo('attachments', meId, f)
        await addClip({ url, name: f.name.replace(/\.[^.]+$/, ''), ownerId: meId, ownerName: meName, duration: dur })
      }
      refresh()
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
  }

  async function play(c: Clip) {
    // play locally as a preview
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null }
    const a = new Audio(c.url); previewRef.current = a; a.play().catch(() => {})
  }

  async function blast(c: Clip) {
    // Клик по уже играющему клипу — это кнопка «Стоп» (onEnded этого клипа сам обнулит playingId).
    if (playingId === c.id) { stopRef.current?.(); return }
    // Клик по ДРУГОМУ клипу, пока что-то играет — раньше это молча только останавливало
    // старый звук и не запускало новый; теперь останавливаем старый и сразу играем новый.
    if (playingId) stopRef.current?.()
    setPlayingId(c.id)
    try {
      const { stop } = await playToAll(room, c.url, { onEnded: () => { setPlayingId(id => id === c.id ? null : id); stopRef.current = null } })
      stopRef.current = stop
    } catch (e: any) { toastErr(e.message ?? String(e)); setPlayingId(id => id === c.id ? null : id) }
  }

  async function openTrim(c: Clip) {
    setBusy('trim')
    try {
      const resp = await fetch(c.url)
      const buf = await decodeAudio(await resp.arrayBuffer())
      setTrim({ clip: c, buf, start: 0, end: buf.duration })
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setBusy('') }
  }

  async function saveTrim() {
    if (!trim) return
    setBusy('savetrim')
    try {
      const blob = audioBufferToWav(trim.buf, trim.start, trim.end)
      const name = trim.clip.name + ' (обрезка)'
      const file = new File([blob], name.replace(/[^\w]+/g, '_') + '.wav', { type: 'audio/wav' })
      const url = await uploadTo('attachments', meId, file)
      await addClip({ url, name, ownerId: meId, ownerName: meName, duration: Math.max(0, trim.end - trim.start) })
      setTrim(null)
      refresh()
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setBusy('') }
  }

  function previewTrim() {
    if (!trim) return
    const blob = audioBufferToWav(trim.buf, trim.start, trim.end)
    const a = new Audio(URL.createObjectURL(blob)); a.play().catch(() => {})
  }

  const list = q ? clips.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : clips

  return (
    <div className="sb" onClick={e => e.stopPropagation()}>
      <div className="sb-head">
        <span className="sb-title"><Icon name="soundboard" size={16} /> Саундпад</span>
        <button className="sb-x" title="Закрыть" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>

      <div className="sb-actions">
        <button className="sb-moment" disabled={!recorder?.ok || busy === 'moment'} onClick={saveMoment}
          title="Сохранить последние 15 секунд разговора">
          <Icon name="clock" size={15} /> {busy === 'moment' ? 'Сохраняю…' : 'Последние 15с'}
        </button>
        <button className="sb-upload" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}
          title="Загрузить аудио с устройства">
          <Icon name="paperclip" size={15} /> {busy === 'upload' ? 'Загрузка…' : 'Загрузить звук'}
        </button>
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={uploadAudio} />
      </div>

      <input className="sb-search" placeholder="Поиск звука…" value={q} onChange={e => setQ(e.target.value)} />

      <div className="sb-list">
        {list.length === 0 && <div className="sb-empty">Пока нет сохранённых звуков. Сохрани момент из звонка или загрузи аудио — их увидят все.</div>}
        {list.map(c => (
          <div key={c.id} className={'sb-item' + (playingId === c.id ? ' playing' : '')}>
            <button className="sb-play" title="Прослушать у себя" onClick={() => play(c)}><Icon name="play" size={15} /></button>
            <div className="sb-meta">
              <div className="sb-name">{c.name}</div>
              <div className="sb-sub">{fmtDur(c.duration)} · {c.owner}</div>
            </div>
            <button className="sb-blast" title="Включить всем в канале" onClick={() => blast(c)}>
              <Icon name={playingId === c.id ? 'pause' : 'volume'} size={15} /> {playingId === c.id ? 'Стоп' : 'Всем'}
            </button>
            <button className="sb-trim" title="Обрезать" onClick={() => openTrim(c)}><Icon name="scissors" size={15} /></button>
            {c.ownerId === meId && <button className="sb-del" title="Удалить" onClick={async () => { await removeClip(c.id); refresh() }}><Icon name="trash" size={14} /></button>}
          </div>
        ))}
      </div>

      {trim && <div className="sb-trim-modal" onClick={() => setTrim(null)}>
        <div className="sb-trim-inner" onClick={e => e.stopPropagation()}>
          <div className="sb-trim-h">Обрезать: {trim.clip.name}</div>
          <div className="sb-trim-row">
            <label>Начало: {trim.start.toFixed(2)}с</label>
            <input type="range" min={0} max={trim.buf.duration} step={0.01} value={trim.start}
              onChange={e => setTrim(t => t && { ...t, start: Math.min(Number(e.target.value), t.end - 0.05) })} />
          </div>
          <div className="sb-trim-row">
            <label>Конец: {trim.end.toFixed(2)}с</label>
            <input type="range" min={0} max={trim.buf.duration} step={0.01} value={trim.end}
              onChange={e => setTrim(t => t && { ...t, end: Math.max(Number(e.target.value), t.start + 0.05) })} />
          </div>
          <div className="sb-trim-dur">Длительность: {fmtDur(Math.max(0, trim.end - trim.start))}</div>
          <div className="sb-trim-foot">
            <button className="sb-ghost" onClick={previewTrim}><Icon name="play" size={14} /> Прослушать</button>
            <button className="sb-ghost" onClick={() => setTrim(null)}>Отмена</button>
            <button className="sb-primary" disabled={busy === 'savetrim'} onClick={saveTrim}>{busy === 'savetrim' ? 'Сохраняю…' : 'Сохранить обрезку'}</button>
          </div>
        </div>
      </div>}
    </div>
  )
}