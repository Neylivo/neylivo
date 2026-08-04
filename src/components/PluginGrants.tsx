import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import {
  createGrant, myGrants, grantClaims, revokeGrant, deleteGrant,
  prettyCode, normCode, looksLikeCode, peekGrant, claimGrant, clampUses,
  GRANT_HONESTY, MAX_DAYS, grantError,
  type Grant, type GrantClaim,
} from '../lib/plugins/grants'
import { parsePlugin } from '../lib/plugins/manifest'
import { installPlugin } from '../lib/plugins/install'
import { getPlugin } from '../lib/plugins/store'
import { PermissionGate } from './PluginPermissionGate'
import type { PluginManifest } from '../lib/plugins/types'

// v1.468.0: личная передача плагина.
//
// Зачем это выглядит именно так. Владелец описал случай прямо: «если хочешь
// продать, а в каталог выкладывать не вариант — находишь клиента и за деньги
// скидываешь плагин». Значит нужен не каталог и не файл в переписке, а код,
// который автор отдаёт одному человеку.
//
// Денег приложение не касается вовсе — они между людьми. Здесь только передача:
// кому, сколько раз, до какого числа, и кто в итоге забрал.
//
// Отдельно про честность. На экране передачи стоит прямой текст о том, что это
// НЕ защита от копирования (GRANT_HONESTY). Соблазн промолчать тут большой, но
// молчание тут было бы обещанием, которого приложение не может выполнить:
// плагин — обычный JavaScript, и получивший его видит весь код.

/** Экран «Передать лично» для одного плагина. */
export function GrantCreate({ meId, pluginId, name, version, code, onClose }: {
  meId: string
  pluginId: string
  name: string
  version: string
  code: string
  onClose: () => void
}) {
  const [uses, setUses] = useState(1)
  const [days, setDays] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [готово, setГотово] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    try {
      const g = await createGrant(meId, {
        pluginId, pluginName: name, pluginVersion: version, payload: code,
        uses: clampUses(uses), days, note,
      })
      setГотово(g.code)
    } catch (e: any) { toastErr(grantError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal grant-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h"><b>Передать лично</b>
          <button className="modal-x" onClick={onClose}>×</button></div>

        <div className="grant-plug"><Icon name="zap" size={16} /> <b className="notr" translate="no">{name}</b>
          <span className="grant-ver">{version}</span></div>

        {готово ? <>
          {/* Код показывается один раз крупно: его сейчас скопируют и отдадут. */}
          <div className="grant-code notr" translate="no">{prettyCode(готово)}</div>
          <button className="pqs2-btn" onClick={() => {
            navigator.clipboard?.writeText(prettyCode(готово))
            toastOk('Код скопирован')
          }}><Icon name="copy" size={16} /> Скопировать код</button>
          <div className="grant-note">
            Отдай этот код тому, кому передаёшь. Он введёт его в «Плагины → Получить по коду».
          </div>
          <button className="pqs2-btn ghost" onClick={onClose}>Готово</button>
        </> : <>
          <div className="grant-honesty"><Icon name="shield" size={14} /> {GRANT_HONESTY}</div>

          <label className="grant-row">
            <span>Сколько раз можно забрать</span>
            <input className="modal-in" type="number" min={1} max={1000} value={uses}
              onChange={e => setUses(clampUses(e.target.value))} />
          </label>
          <label className="grant-row">
            <span>Перестанет работать через (дней)</span>
            <input className="modal-in" type="number" min={0} max={MAX_DAYS} value={days}
              onChange={e => setDays(Math.max(0, Math.min(MAX_DAYS, Number(e.target.value) || 0)))} />
          </label>
          <div className="grant-hint">0 — без срока.</div>
          <label className="grant-row">
            <span>Записка для себя</span>
            <input className="modal-in" placeholder="например: продано @ник" value={note}
              maxLength={300} onChange={e => setNote(e.target.value)} />
          </label>
          <div className="grant-hint">Записку видишь только ты.</div>

          <div className="modal-btns">
            <button className="pqs2-btn ghost" onClick={onClose}>Отмена</button>
            <button className="pqs2-btn" disabled={busy} onClick={create}>
              {busy ? 'Создаю…' : 'Создать код'}
            </button>
          </div>
        </>}
      </div>
    </div>
  )
}

/** Список своих передач: кто забрал, что отозвать. */
export function GrantList() {
  const [list, setList] = useState<Grant[] | null>(null)
  const [claims, setClaims] = useState<GrantClaim[]>([])

  async function load() {
    try {
      const g = await myGrants()
      setList(g)
      setClaims(await grantClaims(g.map(x => x.id)))
    } catch (e: any) { toastErr(grantError(e)); setList([]) }
  }
  useEffect(() => { void load() }, [])

  if (list === null) return <div className="grant-empty">Загружаю…</div>
  if (list.length === 0) {
    return <div className="grant-empty">Передач пока нет. Создать можно на карточке своего плагина — «Передать лично».</div>
  }
  return (
    <div className="grant-list">
      {list.map(g => {
        const взяли = claims.filter(c => c.grant_id === g.id)
        const истёк = !!g.expires_at && new Date(g.expires_at).getTime() < Date.now()
        const мертва = g.revoked || истёк || g.uses_left <= 0
        return (
          <div key={g.id} className={'grant-item' + (мертва ? ' dead' : '')}>
            <div className="grant-item-h">
              <b className="notr" translate="no">{g.plugin_name}</b>
              <span className="grant-code-sm notr" translate="no">{prettyCode(g.code)}</span>
              <button className="pqs2-btn ghost" title="Скопировать код"
                onClick={() => { navigator.clipboard?.writeText(prettyCode(g.code)); toastOk('Код скопирован') }}>
                <Icon name="copy" size={14} />
              </button>
            </div>
            <div className="grant-item-d">
              {g.revoked ? 'отозвана'
                : истёк ? 'срок истёк'
                : g.uses_left <= 0 ? 'забрали, попыток не осталось'
                : `осталось получений: ${g.uses_left}`}
              {g.to_user && ' · именная'}
              {g.expires_at && !истёк && ' · до ' + new Date(g.expires_at).toLocaleDateString()}
              {взяли.length > 0 && ` · забрали: ${взяли.length}`}
            </div>
            {g.note && <div className="grant-item-n">{g.note}</div>}
            <div className="grant-item-a">
              {!g.revoked && <button className="pqs2-btn ghost" onClick={async () => {
                if (!await confirmUi('Отозвать передачу? Код перестанет работать; тем, кто уже забрал, это ничего не отменит', { okText: 'Отозвать' })) return
                try { await revokeGrant(g.id); toastOk('Передача отозвана'); void load() }
                catch (e: any) { toastErr(grantError(e)) }
              }}>Отозвать</button>}
              <button className="pqs2-btn ghost danger" onClick={async () => {
                if (!await confirmUi('Удалить запись о передаче? Пропадёт и след о том, кто её забрал', { okText: 'Удалить', danger: true })) return
                try { await deleteGrant(g.id); void load() }
                catch (e: any) { toastErr(grantError(e)) }
              }}>Удалить</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Получение по коду.
 *
 * Порядок нарочный: посмотреть → показать разрешения → забрать. Разрешения
 * спрашиваются ТАК ЖЕ, как у любого другого плагина: то, что за плагин заплатили,
 * не делает его безопаснее, и пропускать этот экран было бы худшим из решений.
 */
export function GrantClaimBox({ onInstalled }: { onInstalled: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [ждёт, setЖдёт] = useState<{ manifest: PluginManifest; code: string; author: string } | null>(null)

  async function go() {
    if (!looksLikeCode(code)) { toastErr('Код состоит из 12 знаков — проверь, всё ли переписал'); return }
    setBusy(true)
    try {
      // Сперва смотрим: человек должен увидеть, что ему предлагают, до согласия.
      await peekGrant(code)
      const got = await claimGrant(code)
      // Файл разбираем ТЕМ ЖЕ разбором, что и при установке из файла: передача не
      // повод верить содержимому на слово.
      const manifest = parsePlugin(got.payload)
      setЖдёт({ manifest, code: got.payload, author: got.author })
    } catch (e: any) { toastErr(grantError(e)) }
    finally { setBusy(false) }
  }

  return <>
    <div className="grant-claim">
      <input className="modal-in notr" translate="no" placeholder="Код передачи, например ABCD-EFGH-2345"
        value={code} onChange={e => setCode(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void go() }} />
      <button className="pqs2-btn" disabled={busy || !normCode(code)} onClick={go}>
        {busy ? 'Проверяю…' : 'Получить'}
      </button>
    </div>
    {ждёт && (
      <PermissionGate manifest={ждёт.manifest} existing={getPlugin(ждёт.manifest.id)} code={ждёт.code}
        onCancel={() => setЖдёт(null)}
        onConfirm={async () => {
          try {
            await installPlugin(ждёт.manifest, ждёт.code, ждёт.author, false)
            toastOk('Плагин установлен')
            setЖдёт(null); setCode(''); onInstalled()
          } catch (e: any) { toastErr(grantError(e)) }
        }} />
    )}
  </>
}
