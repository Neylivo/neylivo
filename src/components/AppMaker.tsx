import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { installPlugin } from '../lib/plugins/install'
import { loadPlugins, removePlugin } from '../lib/plugins/store'
import { startPlugin, stopPlugin } from '../lib/plugins/host'
import { parsePlugin } from '../lib/plugins/manifest'
import {
  APP_DEFAULT, APP_TEMPLATES, buildApp, buildPage, parseApp, makeAppId, isApp,
  type AppDraft,
} from '../lib/plugins/appMaker'
import { frameDoc } from '../lib/plugins/htmlFrame'

// v1.496.0: свои ПРИЛОЖЕНИЯ прямо в Ponoi.
//
// Владелец попросил это отдельно и с тремя восклицательными знаками: «добавь
// новое для разработчиков рядом с ботами и плагинами, а точнее создание своих
// приложений прямо в ponoi».
//
// Чем это отличается от конструктора плагинов, который рядом. Плагин
// вписывается в само приложение: команда, кнопка, перехват сообщений — и его
// автору нужны разрешения и события. Приложение — это ОКНО со своей страницей:
// игра, редактор, инструмент. Его автору нужны html, css, js и чтобы это
// открылось; ни про какие разрешения он думать не должен.
//
// Внутри — обычный плагин (см. appMaker.ts). Второй системы здесь нет.
//
// ЧТО ЗДЕСЬ ГЛАВНОЕ — ЖИВОЙ ПОКАЗ. Писать код в окно, которое ничего не
// показывает, и нажимать «Сохранить», чтобы увидеть результат, — это цикл в
// полминуты на каждую правку. Здесь страница собирается на лету и крутится
// рядом, в такой же песочнице, как настоящая.

type Вкладка = 'html' | 'css' | 'js'

export function AppMaker({ id, onClose }: { id?: string; onClose: () => void }) {
  const [d, setD] = useState<AppDraft>(() => {
    if (id) {
      const p = loadPlugins().find(x => x.manifest.id === id)
      const набор = p ? parseApp(p.code) : null
      if (набор) return набор
    }
    return { ...APP_DEFAULT, ...APP_TEMPLATES[0].draft } as AppDraft
  })
  const [вкладка, setВкладка] = useState<Вкладка>('js')
  const [занят, setЗанят] = useState(false)
  // Показ обновляется не на каждую букву: перезапускать страницу по клавише —
  // значит убивать всё, что она успела сделать, и мигать на каждом нажатии.
  const [показ, setПоказ] = useState(0)
  const таймер = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (таймер.current) clearTimeout(таймер.current)
    таймер.current = setTimeout(() => setПоказ(v => v + 1), 700)
    return () => { if (таймер.current) clearTimeout(таймер.current) }
  }, [d.html, d.css, d.js])

  const страница = useMemo(() => frameDoc(buildPage(d)), [показ])
  const текст = вкладка === 'html' ? d.html : вкладка === 'css' ? d.css : d.js
  const меняй = (v: string) => setD(x => ({ ...x, [вкладка]: v }))

  async function сохранить() {
    if (!d.name.trim()) { toastErr('Дай приложению название'); return }
    setЗанят(true)
    try {
      const код = buildApp(d)
      const ид = makeAppId(d.id || d.name)
      // Своё же приложение ставим без вопросов о разрешениях: человек его и
      // написал, и спрашивать у него согласия на его собственный код — пустая
      // церемония. Пометка authoredHere ставит его в «Свои».
      await installPlugin(parsePlugin(код), код, null, true)
      await stopPlugin(ид)
      const p = loadPlugins().find(x => x.manifest.id === ид)
      if (p) await startPlugin(p)
      toastOk('Приложение сохранено и запущено')
      onClose()
    } catch (e: any) {
      toastErr('Не вышло: ' + (e?.message ?? e))
    } finally { setЗанят(false) }
  }

  async function удалить() {
    const ид = makeAppId(d.id || d.name)
    if (!await confirmUi(`Удалить приложение «${d.name}»?`, { okText: 'Удалить', danger: true })) return
    await stopPlugin(ид)
    removePlugin(ид)
    toastOk('Удалено')
    onClose()
  }

  function скачать() {
    const b = new Blob([buildApp(d)], { type: 'text/javascript' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b)
    a.download = makeAppId(d.id || d.name) + '.ponoi'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="am-screen">
      <div className="am-head">
        <button className="pqs2-btn ghost" onClick={onClose}><Icon name="arrow-left" size={16} /> Назад</button>
        <input className="modal-in am-name" placeholder="Название приложения" value={d.name}
          onChange={e => setD(x => ({ ...x, name: e.target.value }))} />
        <div className="am-acts">
          <button className="pqs2-btn ghost" onClick={скачать} title="Файл .ponoi — можно отдать другу">
            <Icon name="download" size={15} />
          </button>
          {id && <button className="pqs2-btn ghost danger" onClick={() => void удалить()}><Icon name="trash" size={15} /></button>}
          <button className="modal-primary" disabled={занят} onClick={() => void сохранить()}>
            {занят ? 'Сохраняю…' : 'Сохранить и открыть'}
          </button>
        </div>
      </div>

      <div className="am-body">
        <div className="am-left">
          <div className="am-tabs">
            {(['js', 'html', 'css'] as Вкладка[]).map(в => (
              <button key={в} className={'am-tab' + (вкладка === в ? ' on' : '')} onClick={() => setВкладка(в)}>
                {в === 'js' ? 'Код' : в === 'html' ? 'Разметка' : 'Стили'}
              </button>
            ))}
            <select className="modal-in am-tpl" value=""
              onChange={e => {
                const т = APP_TEMPLATES.find(x => x.id === e.target.value)
                if (т) setD(x => ({ ...x, ...т.draft } as AppDraft))
              }}>
              <option value="">Заготовка…</option>
              {APP_TEMPLATES.map(т => <option key={т.id} value={т.id}>{т.label}</option>)}
            </select>
          </div>
          <textarea className="am-code notr" translate="no" spellCheck={false} value={текст}
            onChange={e => меняй(e.target.value)}
            placeholder={вкладка === 'js'
              ? 'const c = ponoi.canvas()\nconst g = c.getContext("2d")\nponoi.frame(dt => { … })'
              : вкладка === 'html' ? '<div id="что">…</div>' : 'body { background: #111 }'} />
          <div className="am-hint">
            Внутри — настоящая страница: DOM, canvas с webgl и webgpu, мышь, клавиатура, звук,
            свои файлы. Из Ponoi доступен объект <code>ponoi</code>:
            {' '}<code>ponoi.frame(dt =&gt; …)</code>, <code>ponoi.canvas()</code>,
            {' '}<code>ponoi.lib('three')</code>, <code>ponoi.files.open()</code>,
            {' '}<code>ponoi.cursor.lock()</code>.
          </div>
        </div>

        <div className="am-right">
          <div className="am-prev-h">
            <span>Как это выглядит</span>
            <button className="pqs2-btn ghost" onClick={() => setПоказ(v => v + 1)} title="Перезапустить">
              <Icon name="rotate" size={14} />
            </button>
          </div>
          {/* Показ идёт в ТОЙ ЖЕ песочнице, что и настоящее окно: без
              allow-same-origin. Иначе здесь работало бы то, что в жизни
              откажет, и человек узнавал бы об этом уже после сохранения. */}
          <iframe key={показ} className="am-prev" title="Показ"
            sandbox="allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox"
            allow="autoplay; fullscreen; gamepad; xr-spatial-tracking"
            srcDoc={страница} />
          <div className="am-size">
            <label>Ширина<input className="modal-in" type="number" value={d.width}
              onChange={e => setD(x => ({ ...x, width: Number(e.target.value) || 900 }))} /></label>
            <label>Высота<input className="modal-in" type="number" value={d.height}
              onChange={e => setD(x => ({ ...x, height: Number(e.target.value) || 600 }))} /></label>
            <label className="am-chk">
              <input type="checkbox" checked={d.frameless}
                onChange={e => setD(x => ({ ...x, frameless: e.target.checked }))} /> без рамки
            </label>
            <label className="am-chk">
              <input type="checkbox" checked={d.transparent}
                onChange={e => setD(x => ({ ...x, transparent: e.target.checked }))} /> прозрачно
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Список своих приложений — то, что видно на вкладке до открытия одного из них. */
export function AppList({ onOpen }: { onOpen: (id?: string) => void }) {
  const свои = loadPlugins().filter(p => isApp(p.code))
  return (
    <>
      <div className="pqs2-desc">
        Приложение — это окно со своей страницей: игра, редактор, инструмент. Внутри обычные
        HTML, CSS и JavaScript, а рядом — живой показ. Готовое сохраняется обычным плагином,
        его можно скачать файлом и отдать другому.
      </div>
      <div className="modal-inline" style={{ gap: 8, marginBottom: 12 }}>
        <button className="pqs2-btn" onClick={() => onOpen(undefined)}>
          <Icon name="plus" size={16} /> Создать приложение
        </button>
      </div>
      {свои.length === 0 && <div className="modal-empty">Своих приложений пока нет.</div>}
      {свои.map(p => (
        <div key={p.manifest.id} className="plug-card">
          <div className="plug-head">
            <div className="plug-name">
              <span className="plug-ic ph">🪟</span>
              {p.manifest.name}
              <span className="plug-ver">{p.manifest.version}</span>
            </div>
            <div className="plug-actions">
              <button className="pqs2-btn ghost" onClick={() => onOpen(p.manifest.id)}>
                <Icon name="edit" size={15} /> Открыть
              </button>
            </div>
          </div>
          <div className="plug-sub">{p.manifest.description || 'без описания'}</div>
        </div>
      ))}
    </>
  )
}
