import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { supabase } from '../lib/supabase'
import { toastErr, toastOk } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { copyText } from '../lib/copyMedia'
import { listDevices, trustDevice, forgetDevice, freezeEverywhere, issueRecoveryCode, type DeviceRow } from '../lib/devices'
import { lockLeft, NEW_DEVICE_LOCK_MS } from '../lib/deviceGuard'

// v1.536.0: «Устройства и безопасность» в настройках.
//
// Тут человек видит, откуда заходили в его аккаунт, и может ответить на главный
// вопрос — «это был я или нет». Всё остальное отсюда же: снять замок со своего
// устройства, забыть чужое, выйти отовсюду разом и выпустить код восстановления.
//
// Почему список устройств вообще нужен. Пароль могли подсмотреть, и человек об
// этом не узнает никогда — если ему не показать, что вчера в его аккаунт вошли
// с Android, которого у него нет. Это и есть вся защита: не помешать входу
// (помешать нельзя), а сделать его заметным.
function когда(мс: number): string {
  const прошло = Date.now() - мс
  if (прошло < 60_000) return 'только что'
  if (прошло < 3600_000) return Math.round(прошло / 60_000) + ' мин назад'
  if (прошло < 86400_000) return Math.round(прошло / 3600_000) + ' ч назад'
  return new Date(мс).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function DevicesPanel() {
  const [me, setMe] = useState<string | null>(null)
  const [rows, setRows] = useState<DeviceRow[] | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let жив = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      const id = data.user?.id ?? null
      if (!жив) return
      setMe(id)
      if (!id) return
      try { setRows(await listDevices(id)) }
      catch (e) { if (жив) { setErr(String((e as Error).message || e)); setRows([]) } }
    })()
    return () => { жив = false }
  }, [])

  async function обновить() {
    if (!me) return
    try { setRows(await listDevices(me)) } catch (e) { toastErr(e) }
  }

  async function этоЯ(id: string) {
    if (!me) return
    setBusy(true)
    try { await trustDevice(me, id); await обновить(); toastOk('Устройство подтверждено') }
    catch (e) { toastErr(e) } finally { setBusy(false) }
  }

  async function этоНеЯ(id: string) {
    if (!me) return
    if (!await confirmUi(
      'Выйти со всех устройств и забыть это? Придётся войти заново везде, включая это устройство. Пароль после этого стоит сменить.',
      { okText: 'Выйти отовсюду', danger: true })) return
    setBusy(true)
    try {
      await forgetDevice(me, id)
      await freezeEverywhere()
      // Дальше приложение само окажется на экране входа: сеанса больше нет.
    } catch (e) { toastErr(e); setBusy(false) }
  }

  async function выпустить() {
    if (!me || busy) return
    if (rows && !await confirmUi(
      'Выпустить новый код восстановления? Прежний перестанет работать сразу.',
      { okText: 'Выпустить' })) return
    setBusy(true)
    try { setCode(await issueRecoveryCode(me)) }
    catch (e) { toastErr(e) } finally { setBusy(false) }
  }

  return (
    <div className="dev-panel">
      <h2>Устройства и безопасность</h2>
      <div className="pqs2-desc">
        Здесь видно, откуда заходили в аккаунт. Помешать чужому входу нельзя — можно сделать его
        заметным: если в списке есть устройство, которого у тебя нет, нажми «Это не я».
      </div>

      {err && <div className="cset-hint">Список не загрузился: {err}. Возможно, не применена миграция supabase/108_device_guard.sql.</div>}
      {rows === null && !err && <div className="cset-hint">Загрузка…</div>}
      {rows && rows.length === 0 && !err && <div className="cset-hint">Пока ни одного устройства не отмечено.</div>}

      <div className="dev-list">
        {(rows ?? []).map(d => {
          const осталось = lockLeft(d)
          return (
            <div key={d.id} className={'dev-row' + (d.me ? ' me' : '')}>
              <span className="dev-ic"><Icon name={/Android|iPhone/.test(d.label) ? 'smartphone' : 'monitor'} size={18} /></span>
              <span className="dev-meta">
                <span className="dev-nm">{d.label}{d.me && <span className="dev-tag">это устройство</span>}</span>
                <span className="dev-sub">
                  {когда(d.lastSeen)}
                  {d.trusted ? ' · подтверждено' : осталось > 0
                    ? ' · новое, опасное закрыто ещё ' + Math.ceil(осталось / 3600_000) + ' ч'
                    : ' · знакомое'}
                </span>
              </span>
              {!d.trusted && <button className="pqs2-btn" disabled={busy} onClick={() => этоЯ(d.id)}>Это я</button>}
              <button className="pqs2-btn danger" disabled={busy} onClick={() => этоНеЯ(d.id)}>Это не я</button>
            </div>
          )
        })}
      </div>

      <div className="pqs-sec-t">Экстренная заморозка</div>
      <div className="pqs2-desc">
        Выходит из аккаунта на всех устройствах разом, включая это. Работает сразу и без задержек:
        это действие защищает, и мешать ему нельзя.
      </div>
      <button className="pqs2-btn danger" disabled={busy} onClick={async () => {
        if (!await confirmUi('Выйти со всех устройств?', { okText: 'Выйти отовсюду', danger: true })) return
        setBusy(true)
        try { await freezeEverywhere() } catch (e) { toastErr(e); setBusy(false) }
      }}>Выйти со всех устройств</button>

      <div className="pqs-sec-t">Код восстановления</div>
      <div className="pqs2-desc">
        Им можно вернуть доступ, даже если увели и пароль, и почту. На сервере хранится только
        отпечаток кода — сам код есть лишь у тебя, поэтому его нельзя ни подсмотреть в базе, ни
        восстановить. Запиши его на бумагу: показан он будет один раз.
      </div>
      {code
        ? <div className="dev-code">
            <code>{code}</code>
            <button className="pqs2-btn" onClick={() => { void copyText(code, 'Код скопирован') }}>
              <Icon name="copy" size={14} /> Копировать
            </button>
          </div>
        : <button className="pqs2-btn" disabled={busy} onClick={выпустить}>
            {rows && rows.length ? 'Выпустить новый код' : 'Выпустить код'}
          </button>}
      {code && <div className="cset-hint">
        Сохрани и закрой это окно. Второй раз код показать невозможно — на сервере его нет.
        Замок нового устройства снимается через {Math.round(NEW_DEVICE_LOCK_MS / 3600_000)} часов или
        подтверждением «Это я».
      </div>}
    </div>
  )
}
