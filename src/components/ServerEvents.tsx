// Мероприятия сервера — модалка со списком событий и трёхшаговым визардом
// создания («Место → Сведения о событии → Просмотреть»), 1-в-1 как в Discord.
// События лежат в таблице server_events (миграция 17_server_settings.sql).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toastOk, toastErr } from '../lib/toast'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel } from '../types'
import { Icon } from './icons'

export function ServerEvents({ server, channels, onClose }: { server: Server; channels: Channel[]; onClose: () => void }) {
  const { user } = useAuth()
  const [events, setEvents] = useState<any[]>([])
  const [create, setCreate] = useState(false)
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [place, setPlace] = useState<'voice' | 'other' | null>(null)
  const [chId, setChId] = useState('')
  const [loc, setLoc] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('20:00')
  const [desc, setDesc] = useState('')
  const voice = channels.filter(c => (c as any).kind === 'voice')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { load() /* eslint-disable-next-line */ }, [server.id])
  async function load() {
    const { data } = await supabase.from('server_events').select('*').eq('server_id', server.id).order('starts_at')
    setEvents(data ?? [])
  }

  const canNext = step === 0 ? !!place : step === 1 ? !!title.trim() : true
  function next() {
    if (step === 0 && place === 'voice' && !chId && voice[0]) setChId(voice[0].id)
    if (step < 2) setStep((step + 1) as any)
    else createEvent()
  }
  async function createEvent() {
    const starts = date ? new Date(date + 'T' + (time || '00:00')) : new Date()
    const { error } = await supabase.from('server_events').insert({
      server_id: server.id, title: title.trim(), description: desc || null,
      place, channel_id: place === 'voice' ? (chId || null) : null,
      location: place === 'other' ? (loc || null) : null,
      starts_at: starts.toISOString(), created_by: user?.id,
    })
    if (error) return toastErr(String(error.message ?? error).includes('server_events') ? 'Сначала примени миграцию supabase/17_server_settings.sql' : String(error.message ?? error))
    toastOk('Событие создано')
    setCreate(false); setStep(0); setPlace(null); setTitle(''); setDesc(''); setLoc(''); setDate('')
    load()
  }
  async function del(id: string) {
    await supabase.from('server_events').delete().eq('id', id)
    setEvents(list => list.filter(e => e.id !== id))
  }
  const fmt = (x: string) => new Date(x).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const placeLabel = () => place === 'voice' ? ('🔊 ' + (voice.find(c => c.id === chId)?.name ?? voice[0]?.name ?? 'Голосовой канал')) : (loc || 'В другом месте')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sev" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        {!create && <>
          <div className="sev-head"><Icon name="calendar" size={20} /> <b>Мероприятия</b>
            <button className="modal-primary" style={{ marginLeft: 8 }} onClick={() => setCreate(true)}>Создать событие</button></div>
          {events.length === 0
            ? <div className="sev-empty">
              <div className="sev-cal-big"><Icon name="calendar" size={34} /></div>
              <b>Нет предстоящих событий.</b>
              <div>Назначьте событие для любой запланированной деятельности на вашем сервере.<br />Вы можете разрешить другим людям создавать события, перейдя в раздел «Роли» в настройках сервера.</div>
            </div>
            : <div className="sev-list">{events.map(ev => (
              <div key={ev.id} className="sev-row">
                <span className="sev-cal"><Icon name="calendar" size={20} /></span>
                <div style={{ flex: 1 }}>
                  <b>{ev.title}</b>
                  <div className="mut" style={{ fontSize: 12, marginTop: 2 }}>{ev.starts_at ? fmt(ev.starts_at) : ''} · {ev.place === 'voice' ? ('🔊 ' + (channels.find(c => c.id === ev.channel_id)?.name ?? 'голосовой канал')) : (ev.location || 'в другом месте')}</div>
                  {ev.description && <div className="mut" style={{ fontSize: 12, marginTop: 4 }}>{ev.description}</div>}
                </div>
                {ev.created_by === user?.id && <button className="sev-del" title="Удалить событие" onClick={() => del(ev.id)}><Icon name="trash" size={15} /></button>}
              </div>
            ))}</div>}
        </>}
        {create && <>
          <div className="sev-steps">
            {['Место', 'Сведения о событии', 'Просмотреть'].map((t, i) => (
              <div key={t} className={'sev-step' + (i <= step ? ' on' : '')}><div className="sev-bar" /><span>{t}</span></div>
            ))}
          </div>
          {step === 0 && <>
            <div className="modal-title">Где пройдёт ваше событие?</div>
            <div className="modal-sub">Чтобы все знали, где его искать.</div>
            <button className={'cch-type' + (place === 'voice' ? ' on' : '')} onClick={() => setPlace('voice')}>
              <span className="dot" /><Icon name="volume" size={20} />
              <span className="cch-t"><b>Голосовой канал</b><span>Голос, видео, показ экрана и стриминг.</span></span>
            </button>
            <button className={'cch-type' + (place === 'other' ? ' on' : '')} onClick={() => setPlace('other')}>
              <span className="dot" /><Icon name="pin" size={20} />
              <span className="cch-t"><b>В другом месте</b><span>Текстовый канал, внешняя ссылка или место проведения.</span></span>
            </button>
            {place === 'voice' && voice.length > 0 && <select className="modal-in" value={chId || voice[0].id} onChange={e => setChId(e.target.value)}>
              {voice.map(c => <option key={c.id} value={c.id}>🔊 {c.name}</option>)}
            </select>}
            {place === 'voice' && voice.length === 0 && <div className="modal-sub" style={{ color: '#ed4245' }}>На сервере нет голосовых каналов — создайте канал или выберите «В другом месте».</div>}
            {place === 'other' && <input className="modal-in" placeholder="Куда идти?" value={loc} onChange={e => setLoc(e.target.value)} />}
          </>}
          {step === 1 && <>
            <div className="modal-title">Сведения о событии</div>
            <label className="modal-lbl">Тема события <span style={{ color: '#ed4245' }}>*</span></label>
            <input className="modal-in" autoFocus placeholder="Как называется ваше событие?" value={title} onChange={e => setTitle(e.target.value)} />
            <div className="sev-2col">
              <div><label className="modal-lbl">Дата начала</label>
                <input type="date" className="modal-in" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div><label className="modal-lbl">Время начала</label>
                <input type="time" className="modal-in" value={time} onChange={e => setTime(e.target.value)} /></div>
            </div>
            <label className="modal-lbl">Описание</label>
            <textarea className="cset-topic" style={{ minHeight: 70 }} placeholder="Расскажите людям немного о вашем событии." value={desc} onChange={e => setDesc(e.target.value)} />
          </>}
          {step === 2 && <>
            <div className="modal-title" style={{ textAlign: 'center' }}>Вот так будет выглядеть ваше событие для всех. Готовы его создать?</div>
            <div className="sev-row" style={{ marginTop: 14 }}>
              <span className="sev-cal"><Icon name="calendar" size={20} /></span>
              <div style={{ flex: 1 }}>
                <b>{title}</b>
                <div className="mut" style={{ fontSize: 12, marginTop: 2 }}>{date ? new Date(date + 'T' + (time || '00:00')).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Сейчас'} · {placeLabel()}</div>
                {desc && <div className="mut" style={{ fontSize: 12, marginTop: 4 }}>{desc}</div>}
              </div>
            </div>
          </>}
          <div className="modal-foot">
            <button className="modal-ghost" onClick={() => step === 0 ? setCreate(false) : setStep((step - 1) as any)}>{step === 0 ? 'Отмена' : 'Назад'}</button>
            <button className="modal-primary" disabled={!canNext} onClick={next}>{step === 2 ? 'Создать событие' : 'Далее'}</button>
          </div>
        </>}
      </div>
    </div>
  )
}