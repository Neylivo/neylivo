import { useState } from 'react'
import { usePanels, type PanelSlot, type SettingsRow } from '../lib/plugins/registry'
import { invokePlugin, emitToPlugin } from '../lib/plugins/host'
import { readStorage, writeStorage } from '../lib/plugins/store'

// v1.417.0: панели плагинов в самом приложении.
//
// Плагин выполняется в песочнице ровно для того, чтобы его код никогда не
// оказался в окне. Поэтому «свой уголок» устроен не как кусок разметки от
// плагина, а как ОПИСАНИЕ: плагин присылает список строк, а рисует их вот этот
// файл — своими компонентами, своими стилями, со своими ограничениями.
//
// Отсюда и безопасность: подделать чужое окно, прочитать чужой ввод или
// подсунуть ссылку в чужой разметке через панель невозможно — разметки от
// плагина попросту нет. Значения строк хранятся в его собственном хранилище,
// как и на его странице настроек, и при изменении плагин получает событие.

function PanelRows({ pluginId, rows }: { pluginId: string; rows: SettingsRow[] }) {
  // То, что видно человеку, держим локально: плагин описывает строки один раз
  // при загрузке и не обязан перерисовывать их на каждое нажатие.
  const [local, setLocal] = useState<Record<string, unknown>>({})

  function valueOf(r: Extract<SettingsRow, { value: unknown }>): unknown {
    if (r.key in local) return local[r.key]
    const saved = readStorage(pluginId, r.key)
    return saved === undefined ? r.value : saved
  }

  function change(key: string, value: unknown) {
    setLocal(v => ({ ...v, [key]: value }))
    writeStorage(pluginId, key, value)
    emitToPlugin(pluginId, 'settings', { key, value })
  }

  return <>
    {rows.map(r => {
      switch (r.type) {
        case 'toggle': return (
          <div key={r.key} className="plugpanel-row">
            <span>{r.label}</span>
            <button className={'pqs-toggle' + (valueOf(r) ? ' on' : '')}
              onClick={() => change(r.key, !valueOf(r))}><span /></button>
          </div>
        )
        case 'text': return (
          <div key={r.key} className="plugpanel-row">
            <span>{r.label}</span>
            <input className="modal-in" style={{ maxWidth: 160 }} placeholder={r.placeholder}
              value={String(valueOf(r) ?? '')} onChange={e => change(r.key, e.target.value)} />
          </div>
        )
        case 'select': return (
          <div key={r.key} className="plugpanel-row">
            <span>{r.label}</span>
            <select className="modal-in" style={{ maxWidth: 160 }} value={String(valueOf(r) ?? '')}
              onChange={e => change(r.key, e.target.value)}>
              {r.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )
        case 'button': return (
          <button key={r.key} className="pqs2-btn ghost plugpanel-btn"
            onClick={() => { void invokePlugin(pluginId, r.onClick, []) }}>{r.label}</button>
        )
        default: return null
      }
    })}
  </>
}

export function PluginPanels({ slot }: { slot: PanelSlot }) {
  const panels = usePanels(slot)
  if (panels.length === 0) return null
  return (
    <div className="plugpanels">
      {panels.map(p => (
        <div key={p.pluginId + ':' + p.slot} className="plugpanel">
          {/* Заголовок с пометкой «плагин»: человек должен видеть, что этот
              уголок нарисован не приложением, а поставленным им плагином. */}
          <div className="plugpanel-h">
            <span className="plugpanel-tag">плагин</span>
            <b className="notr" translate="no">{p.title}</b>
          </div>
          <PanelRows pluginId={p.pluginId} rows={p.rows} />
        </div>
      ))}
    </div>
  )
}
