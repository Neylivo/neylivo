import { useEffect, useState } from 'react'
import { Portal } from './Portal'
import { AssetImg } from './PluginPanels'
import type { SettingsRow } from '../lib/plugins/registry'
import type { DialogAsk } from '../lib/plugins/dialog'

// v1.475.0: окно-вопрос плагина. Рисуем МЫ, плагин только описал строки.
//
// Почему это не «окно плагина» (apps.ts). Там плагин живёт: рисует, крутит
// анимацию, слушает клавиши. Здесь он ЖДЁТ ответа — окно модальное, поверх
// всего, с двумя кнопками, и никакого своего кода в нём не выполняется. Разные
// вещи с разными правилами: у окна-вопроса нет ни холста, ни кнопок плагина,
// ни своей жизни после ответа.
//
// Что здесь нельзя убирать: имя плагина в шапке. Модальное окно поверх всего —
// самое подходящее место, чтобы притвориться приложением и спросить пароль.
// Поэтому видно, КТО спрашивает, и это рисуем мы, а не плагин.

function Row(
  { r, val, set }: { r: SettingsRow; val: Record<string, unknown>; set: (k: string, v: unknown) => void },
) {
  const v = (k: string, d: unknown) => (val[k] !== undefined ? val[k] : d)
  switch (r.type) {
    case 'label': return (
      <div className="pdlg-row"><span className="pdlg-lbl">{r.label}</span><b>{String(r.value ?? '')}</b></div>
    )
    case 'image': return (
      <div className="pdlg-row pdlg-col">
        <span className="pdlg-lbl">{r.label}</span>
        <AssetImg pluginId={(val.__pid as string) ?? ''} className="plugpanel-img" src={r.value} alt={r.label} />
      </div>
    )
    case 'text': return (
      <div className="pdlg-row pdlg-col">
        <span className="pdlg-lbl">{r.label}</span>
        {r.description && <span className="pdlg-desc">{r.description}</span>}
        <input className="cfm-input" value={String(v(r.key, r.value) ?? '')}
          placeholder={r.placeholder ?? ''} onChange={e => set(r.key, e.target.value)} />
      </div>
    )
    case 'toggle': return (
      <label className="pdlg-row">
        <span className="pdlg-lbl">{r.label}</span>
        <input type="checkbox" checked={!!v(r.key, r.value)} onChange={e => set(r.key, e.target.checked)} />
      </label>
    )
    case 'select': return (
      <div className="pdlg-row">
        <span className="pdlg-lbl">{r.label}</span>
        <select className="pdlg-sel" value={String(v(r.key, r.value) ?? '')}
          onChange={e => set(r.key, e.target.value)}>
          {r.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    )
    case 'slider': return (
      <div className="pdlg-row pdlg-col">
        <span className="pdlg-lbl">{r.label} <b>{String(v(r.key, r.value))}</b></span>
        <input type="range" className="plugpanel-range" min={r.min} max={r.max} step={r.step}
          value={Number(v(r.key, r.value))} onChange={e => set(r.key, Number(e.target.value))} />
      </div>
    )
    case 'color': return (
      <div className="pdlg-row">
        <span className="pdlg-lbl">{r.label}</span>
        <input type="color" className="plugpanel-color" value={String(v(r.key, r.value) ?? '#5865f2')}
          onChange={e => set(r.key, e.target.value)} />
      </div>
    )
    default: return null
  }
}

export function PluginDialogHost() {
  const [ask, setAsk] = useState<DialogAsk | null>(null)
  const [val, setVal] = useState<Record<string, unknown>>({})

  useEffect(() => {
    const open = (e: Event) => {
      const a = (e as CustomEvent).detail as DialogAsk
      const начальные: Record<string, unknown> = { __pid: a.pluginId }
      for (const r of a.rows) {
        if (r.type !== 'label' && r.type !== 'image') начальные[r.key] = (r as { value?: unknown }).value
      }
      setVal(начальные)
      setAsk(a)
    }
    // Плагин выключили, пока он ждал ответа: отвечаем отказом и убираем окно.
    // Иначе оно висело бы поверх приложения, отвечать было бы некому, а плагин
    // больше не смог бы открыть новое.
    const close = (e: Event) => {
      const { pluginId } = (e as CustomEvent).detail as { pluginId: string | null }
      setAsk(cur => {
        if (!cur) return null
        if (pluginId && cur.pluginId !== pluginId) return cur
        cur.resolve(null)
        return null
      })
    }
    window.addEventListener('ponoi-plugin-dialog', open)
    window.addEventListener('ponoi-plugin-dialog-close', close)
    return () => {
      window.removeEventListener('ponoi-plugin-dialog', open)
      window.removeEventListener('ponoi-plugin-dialog-close', close)
    }
  }, [])

  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); готово(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, val])

  function готово(да: boolean) {
    if (!ask) return
    if (!да) ask.resolve(null)
    else {
      const ответ = { ...val }
      delete ответ.__pid
      ask.resolve(ответ)
    }
    setAsk(null)
  }

  if (!ask) return null
  return (
    <Portal>
      <div className="cfm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) готово(false) }}>
        <div className="cfm-box pdlg-box">
          <div className="pdlg-h">
            <b className="notr" translate="no">{ask.title}</b>
            {/* Кто спрашивает — рисуем мы. Без этого модальное окно поверх всего
                стало бы способом притвориться приложением. */}
            <span className="plugapp-tag">плагин «{ask.pluginName}»</span>
          </div>
          {ask.text && <div className="pdlg-text">{ask.text}</div>}
          <div className="pdlg-rows">
            {ask.rows.map(r => (
              <Row key={r.key} r={r} val={val} set={(k, v) => setVal(s => ({ ...s, [k]: v }))} />
            ))}
          </div>
          <div className="cfm-btns">
            <button className="cfm-cancel" onClick={() => готово(false)}>{ask.cancelText}</button>
            <button className="cfm-ok" onClick={() => готово(true)}>{ask.okText}</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
