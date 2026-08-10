import { useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { supabase } from '../lib/supabase'
import { useBackClose } from '../lib/mobileBack'
import { toastErr, toastOk } from '../lib/toast'
import { REPORT_REASONS, reportReady, reportNote, type ReportReason } from '../lib/accountGuard'
import { blockUser } from '../lib/block'

// v1.534.0: окно «Пожаловаться на человека».
//
// Требование Google Play к мессенджерам: в приложении, где люди пишут друг
// другу, обязаны быть кнопки «заблокировать» и «пожаловаться». Блокировка у нас
// была, жалобы не было.
//
// ЧТО УХОДИТ НА СЕРВЕР: кто, на кого, причина и пояснение — и НИ ОДНОГО слова
// из переписки. Это не мелочь: сервер у нас не умеет читать сообщения, и если
// бы жалоба несла с собой текст, любой мог бы положить свою переписку на сервер
// открытой, пожаловавшись сам на себя. Модерация от этого потеряет в удобстве,
// зато обещание «сервер не видит текст» останется правдой.
//
// Поэтому же рядом стоит галочка «заблокировать»: она действует немедленно и
// целиком на устройстве — от неё польза есть сразу, в отличие от жалобы,
// которую кто-то должен разобрать.
export function ReportUserModal({ userId, name, onClose }: {
  userId: string
  name: string
  onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const [busy, setBusy] = useState(false)
  useBackClose(true, onClose)

  const готово = reportReady({ target: userId, reason, note })

  async function отправить() {
    if (!готово || busy) return
    setBusy(true)
    try {
      const { data: u } = await supabase.auth.getUser()
      const me = u.user?.id
      if (!me) throw new Error('нет входа')
      const { error } = await supabase.from('user_reports').insert({
        reporter_id: me, target_id: userId, reason, note: reportNote(note),
      })
      if (error) throw error
      if (alsoBlock) { try { await blockUser(me, userId) } catch { /* блок не вышел — жалоба всё равно ушла */ } }
      toastOk(alsoBlock ? 'Жалоба отправлена, человек заблокирован' : 'Жалоба отправлена')
      onClose()
    } catch (e) { toastErr(e) } finally { setBusy(false) }
  }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal rep-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title" style={{ margin: 0 }}>Пожаловаться на {name}</div>

        <label className="modal-lbl">Что случилось</label>
        <div className="rep-reasons">
          {REPORT_REASONS.map(r => (
            <button key={r.id} type="button"
              className={'rep-reason' + (reason === r.id ? ' on' : '')}
              onClick={() => setReason(r.id)}>{r.label}</button>
          ))}
        </div>

        <label className="modal-lbl">
          Пояснение{reason === 'other' ? ' — обязательно' : ' (необязательно)'}
        </label>
        <textarea className="modal-in" rows={3} value={note} onChange={e => setNote(e.target.value)}
          placeholder="Что именно произошло" />

        <label className="rep-block">
          <input type="checkbox" checked={alsoBlock} onChange={e => setAlsoBlock(e.target.checked)} />
          <span>Заблокировать — его сообщения сразу пропадут</span>
        </label>

        <div className="cset-hint">
          В жалобу не попадает текст переписки: сервер не может его прочитать. Опиши произошедшее
          словами — по описанию и будут разбираться.
        </div>

        <div className="lyr-btns">
          <button className="pqs2-btn ghost" onClick={onClose}>Отмена</button>
          <button className="pqs2-btn danger" disabled={!готово || busy} onClick={отправить}>
            {busy ? 'Отправляю…' : 'Отправить жалобу'}
          </button>
        </div>
      </div>
    </div></Portal>
  )
}
