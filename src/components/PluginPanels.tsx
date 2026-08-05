import { useEffect, useRef, useState } from 'react'
import { usePanels, type PanelSlot, type SettingsRow } from '../lib/plugins/registry'
import { invokePlugin, emitToPlugin, pluginAssetUrl } from '../lib/plugins/bridge'
import { readStorage, writeStorage } from '../lib/plugins/store'
import { ensureCanvas } from '../lib/plugins/canvasHub'
import { comboFromEvent, isComboComplete } from '../lib/keybind'
import { okCombo, setKeybind } from '../lib/plugins/registry'
import { toastErr } from '../lib/toast'

/**
 * Картинка в строке панели (v1.473.0).
 *
 * Обычная https-ссылка показывается как есть. А «asset:имя» — это СВОЙ файл
 * плагина, и настоящего адреса у плагина нет: он знает только имя, а адрес
 * собирает приложение здесь и для этого же плагина. Так ссылку неоткуда взять
 * ни другому плагину, ни сообщению, ни чужому сайту (см. assets.ts, правило 2).
 *
 * Адрес спрашивается через прослойку (bridge.ts), а не у самого хранилища.
 * Вход в систему плагинов из горячего кода должен быть ОДИН: свой ленивый
 * импорт отсюда — это второй вход в ту же систему, а два входа в неё уже
 * однажды кончились тем, что она уехала в стартовую сборку всем (v1.469.0).
 */
export function AssetImg(
  { pluginId, src, alt, className }: { pluginId: string; src: string; alt: string; className?: string },
) {
  const свой = src.startsWith('asset:')
  const [url, setUrl] = useState<string | null>(свой ? null : src)
  useEffect(() => {
    if (!свой) { setUrl(src); return }
    let живо = true
    setUrl(null)
    pluginAssetUrl(pluginId, src.slice('asset:'.length))
      .then(u => { if (живо) setUrl(u) })
      .catch(() => { if (живо) setUrl(null) })
    return () => { живо = false }
  }, [pluginId, src, свой])
  // Пока адреса нет — пустая рамка, а не <img src="">: пустой src браузер
  // считает ссылкой на саму страницу и честно её скачивает.
  if (!url) return <span className={className} aria-label={alt} />
  return <img className={className} src={url} alt={alt} loading="lazy" />
}

/**
 * Холст плагина в панели (v1.465.0).
 *
 * Элемент здесь НЕ создаётся: он живёт в canvasHub и переживает любое число
 * перерисовок. Причина — управление холстом отдаётся воркеру ровно один раз
 * (transferControlToOffscreen нельзя позвать дважды), а панель размонтируется
 * при каждом уходе с экрана. Создавай мы элемент тут — первый же переход в
 * настройки убивал бы холст плагина навсегда.
 *
 * Поэтому компонент только ВСТАВЛЯЕТ готовый элемент в себя и говорит плагину,
 * видно его сейчас или нет: пока не видно, крутить анимацию незачем — это
 * впустую съеденная батарея на телефоне.
 */
export function PanelCanvas({ pluginId, row }: { pluginId: string; row: Extract<SettingsRow, { type: 'canvas' }> }) {
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = box.current
    if (!host) return
    let el: HTMLCanvasElement
    try { el = ensureCanvas(pluginId, row.key, row.height) } catch { return }
    host.appendChild(el)
    emitToPlugin(pluginId, 'canvas', { key: row.key, width: el.width, height: el.height, visible: true })
    return () => {
      // Элемент не удаляем — он общий и переживает уход с экрана; убираем только
      // из этого места, иначе при возврате он оказался бы вставлен дважды.
      if (el.parentNode === host) host.removeChild(el)
      // «Не видно» говорим, только если холста правда нет на экране. Один и тот
      // же ключ можно объявить и в панели, и на своей странице настроек — тогда
      // элемент один, и вставка во второе место просто ПЕРЕНОСИТ его из первого.
      // Без этой проверки закрытие панели говорило бы «не видно» про холст,
      // который в этот момент прекрасно виден в настройках, и плагин остановил
      // бы анимацию посреди работы.
      if (!el.isConnected) {
        emitToPlugin(pluginId, 'canvas', { key: row.key, width: el.width, height: el.height, visible: false })
      }
    }
  }, [pluginId, row.key, row.height])
  return <div className="plugpanel-cbox" ref={box} style={{ height: row.height }} />
}

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

export function PanelRows({ pluginId, rows }: { pluginId: string; rows: SettingsRow[] }) {
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
        // v1.419.0: строки, которые показывают. Значение приходит от плагина и
        // рисуется текстом — никакой разметки от него здесь не появляется.
        case 'label': return (
          <div key={r.key} className="plugpanel-row">
            <span>{r.label}</span>
            <b className="plugpanel-val notr" translate="no">{r.value}</b>
          </div>
        )
        case 'progress': return (
          <div key={r.key} className="plugpanel-prow">
            <div className="plugpanel-row"><span>{r.label}</span><b className="plugpanel-val">{Math.round(r.value)}%</b></div>
            <div className="plugpanel-bar"><i style={{ width: Math.max(0, Math.min(100, r.value)) + '%' }} /></div>
          </div>
        )
        case 'slider': return (
          <div key={r.key} className="plugpanel-prow">
            <div className="plugpanel-row"><span>{r.label}</span><b className="plugpanel-val">{String(valueOf(r) ?? r.value)}</b></div>
            <input type="range" className="plugpanel-range" min={r.min} max={r.max} step={r.step}
              value={Number(valueOf(r) ?? r.value)} onChange={e => change(r.key, Number(e.target.value))} />
          </div>
        )
        case 'color': return (
          <div key={r.key} className="plugpanel-row">
            <span>{r.label}</span>
            <input type="color" className="plugpanel-color" value={String(valueOf(r) ?? r.value)}
              onChange={e => change(r.key, e.target.value)} />
          </div>
        )
        case 'image': return (
          <AssetImg key={r.key} pluginId={pluginId} className="plugpanel-img" src={r.value} alt={r.label} />
        )
        case 'canvas': return <PanelCanvas key={r.key} pluginId={pluginId} row={r} />
        // v1.488.0: сочетание клавиш умеет рисоваться и здесь — в панели и в
        // окне плагина, а не только на странице настроек.
        case 'keybind': return (
          <div key={r.key} className="plugpanel-row">
            <span>{r.label}</span>
            <KeybindRow pluginId={pluginId} rowKey={r.key} value={String(valueOf(r) ?? '')}
              onSet={v => change(r.key, v)} />
          </div>
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
          {/* v1.488.0: вместо ярлыка «ПЛАГИН» — имя того, чьё это.
              Владелец про этот ярлык сказал прямо: «уродски», — и был прав:
              заглавные буквы в рамочке кричали громче самого содержимого, а
              отвечали при этом не на тот вопрос. Человеку важно не то, что
              перед ним «плагин» вообще, а КАКОЙ. Окна перешли на имя ещё в
              v1.479.0 — панели остались с ярлыком, и это была единственная
              часть плагина, которая всё ещё так выглядела. */}
          <div className="plugpanel-h">
            <b className="notr" translate="no">{p.title}</b>
            <span className="plugpanel-by notr" translate="no">{p.pluginId}</span>
          </div>
          <PanelRows pluginId={p.pluginId} rows={p.rows} />
        </div>
      ))}
    </div>
  )
}

/**
 * Выбор сочетания клавиш (v1.467.0).
 *
 * Живёт ЗДЕСЬ, а не на странице настроек плагина, хотя написан был для
 * неё. Причина простая: строки у панели, у окна плагина и у страницы
 * настроек одни и те же, и рисовальщиков у них два. Пока keybind знал
 * только один из них, плагин мог описать строку в своём окне — и не
 * увидеть ничего. Ни ошибки, ни пустого места: просто null.
 *
 * Плагин говорит «мне нужна клавиша вызова», а какая именно — решает человек.
 * Нажал кнопку, нажал сочетание — записалось.
 *
 * Проверка та же, что у клавиш самого плагина (okCombo): нужны два модификатора.
 * Иначе плагин отобрал бы у человека обычную букву, и виновника он бы не нашёл —
 * клавиша просто перестала бы работать. Занятое другим плагином сочетание тоже
 * не назначается, и об этом говорится вслух, а не молчанием.
 */
export function KeybindRow({ pluginId, rowKey, value, onSet }: {
  pluginId: string; rowKey: string; value: string; onSet: (v: string) => void
}) {
  const [ловим, setЛовим] = useState(false)
  useEffect(() => {
    if (!ловим) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') { setЛовим(false); return }
      const combo = comboFromEvent(e)
      if (!isComboComplete(combo)) return    // ждём, пока отпустят модификаторы
      if (!okCombo(combo)) { toastErr('Нужны два модификатора — например Ctrl+Shift+P'); return }
      if (!setKeybind(pluginId, rowKey, combo)) {
        toastErr('Это сочетание уже занято другим плагином')
        setЛовим(false)
        return
      }
      onSet(combo)
      setЛовим(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ловим, pluginId, rowKey, onSet])

  return (
    <div className="plug-keybind">
      <button className={'pqs2-btn ghost' + (ловим ? ' on' : '')} onClick={() => setЛовим(v => !v)}>
        {ловим ? 'Нажми сочетание…' : (value || 'Не назначено')}
      </button>
      {value && !ловим && (
        <button className="pqs2-btn ghost danger" title="Убрать сочетание"
          onClick={() => { setKeybind(pluginId, rowKey, ''); onSet('') }}>×</button>
      )}
    </div>
  )
}
