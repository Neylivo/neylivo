import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { supabase } from '../lib/supabase'
import { useBackClose } from '../lib/mobileBack'
import { toastErr, toastOk } from '../lib/toast'
import { wipeDevice, wipeSummary } from '../lib/wipe'
import { HOLD_MS, WIPES, deleteConfirmed, holdDue, holdLabel, type HoldState } from '../lib/accountGuard'

// v1.534.0: окно «Удалить аккаунт и все данные».
//
// Требование Google Play к мессенджерам — такая кнопка обязана быть. Владелец
// добавил к этому защиту уровня Steam: не мгновенно, а с задержкой, чтобы у
// настоящего владельца было окно на отмену, если аккаунт увели.
//
// Как это работает по шагам:
//   1. Человек видит список того, что исчезнет, и вводит СВОЁ ИМЯ. Не «вы
//      уверены?» — на такое отвечают «да» не читая.
//   2. Запрос ложится в базу и ждёт неделю. Всё это время на каждом устройстве
//      висит баннер с отсчётом и кнопкой «Отменить».
//   3. Когда срок вышел, человек нажимает «Удалить сейчас»: сервер стирает свои
//      данные (delete_my_account), устройство затирает своё, вход закрывается.
//
// Почему сервер и устройство стираются ОТДЕЛЬНО: ключи шифрования существуют
// только на устройстве, и сервер не может их удалить при всём желании. Если бы
// мы стирали только на сервере, ключи остались бы лежать здесь; если только
// здесь — переписка осталась бы на сервере. Поэтому оба шага и оба видны.
export function DeleteAccountModal({ username, onClose }: { username: string; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [hold, setHold] = useState<HoldState | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  useBackClose(true, onClose)

  // Отсчёт живой: человек смотрит на баннер и должен видеть, что время идёт.
  useEffect(() => {
    const t = window.setInterval(() => setTick(n => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    let жив = true
    void (async () => {
      const { data } = await supabase.from('account_holds').select('action, requested_at').maybeSingle()
      if (!жив) return
      const r = data as { action?: string; requested_at?: string } | null
      setHold(r?.action === 'delete' && r.requested_at
        ? { action: 'delete', at: new Date(r.requested_at).getTime() }
        : null)
    })()
    return () => { жив = false }
  }, [])

  async function запросить() {
    if (!deleteConfirmed(typed, username) || busy) return
    setBusy(true)
    try {
      const { data: u } = await supabase.auth.getUser()
      const me = u.user?.id
      if (!me) throw new Error('нет входа')
      const at = Date.now()
      const { error } = await supabase.from('account_holds').upsert({
        user_id: me, action: 'delete',
        requested_at: new Date(at).toISOString(),
        due_at: new Date(at + HOLD_MS.delete).toISOString(),
        device: navigator.userAgent.slice(0, 120),
      })
      if (error) throw error
      setHold({ action: 'delete', at })
      toastOk('Удаление запрошено. Отменить можно в любой момент до срока.')
    } catch (e) { toastErr(e) } finally { setBusy(false) }
  }

  async function отменить() {
    setBusy(true)
    try {
      const { error } = await supabase.from('account_holds').delete().eq('action', 'delete')
      if (error) throw error
      setHold(null)
      setTyped('')
      toastOk('Удаление отменено')
    } catch (e) { toastErr(e) } finally { setBusy(false) }
  }

  async function удалитьСейчас() {
    if (!hold || !holdDue(hold) || busy) return
    setBusy(true)
    try {
      // Сначала сервер: если он откажет, устройство останется рабочим и человек
      // увидит причину. Обратный порядок оставил бы его без ключей при живой
      // учётной записи — то есть без переписки и без возможности что-то сделать.
      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error
      const отчёт = await wipeDevice()
      toastOk(wipeSummary(отчёт))
      await supabase.auth.signOut()
      location.reload()
    } catch (e) { toastErr(e); setBusy(false) }
  }

  const готов = deleteConfirmed(typed, username)
  const пора = hold ? holdDue(hold) : false

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal del-acc" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title" style={{ margin: 0 }}>Удалить аккаунт и все данные</div>

        {hold === undefined && <div className="cset-hint">Смотрю, не запрошено ли уже…</div>}

        {hold === null && <>
          <div className="del-acc-warn">
            <Icon name="shield" size={18} /> Это необратимо. Восстановить ничего будет нельзя.
          </div>
          <div className="del-acc-list">
            {WIPES.map(w => <div key={w} className="del-acc-item"><Icon name="close" size={13} /> {w}</div>)}
          </div>
          <div className="cset-hint">
            Удаление произойдёт не сразу: запрос ждёт {Math.round(HOLD_MS.delete / 86400000)} дней. Всё это
            время его можно отменить с любого своего устройства — так у настоящего владельца остаётся
            время, если в аккаунт вошёл кто-то чужой.
          </div>
          <label className="modal-lbl">Чтобы продолжить, введи своё имя: <b>{username}</b></label>
          <input className="modal-in" value={typed} onChange={e => setTyped(e.target.value)}
            placeholder={username} autoFocus />
          <div className="lyr-btns">
            <button className="pqs2-btn ghost" onClick={onClose}>Отмена</button>
            <button className="pqs2-btn danger" disabled={!готов || busy} onClick={запросить}>
              {busy ? 'Запрашиваю…' : 'Запросить удаление'}
            </button>
          </div>
        </>}

        {hold && <>
          <div className="del-acc-warn">
            <Icon name="clock" size={18} /> Удаление запрошено — {holdLabel(hold, Date.now() + tick * 0)}
          </div>
          <div className="cset-hint">
            Когда срок выйдет, нажми «Удалить сейчас». Если это были не вы — отмените, и ничего не
            произойдёт: пароль при этом стоит сменить.
          </div>
          <div className="lyr-btns">
            <button className="pqs2-btn ghost" disabled={busy} onClick={отменить}>Отменить удаление</button>
            <button className="pqs2-btn danger" disabled={!пора || busy} onClick={удалитьСейчас}>
              {busy ? 'Удаляю…' : пора ? 'Удалить сейчас' : 'Срок ещё не вышел'}
            </button>
          </div>
        </>}
      </div>
    </div></Portal>
  )
}
