import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { frameDoc } from '../lib/plugins/htmlFrame'
import { libList, libSource } from '../lib/plugins/libs'
import {
  KIND_LABEL, addNode, duplicateNode, num, removeNode, scenePage, updateNode,
  type NodeKind, type Scene, type SceneNode,
} from '../lib/plugins/scene'

// v1.498.0: визуальный редактор сцены — то, о чём просил владелец.
//
// «Не рандомные кубики туда-сюда без объяснения, буквально Unity в Ponoi».
//
// Из Unity взято ровно то, без чего сцену не собрать, и ничего сверх:
//
//   СЛЕВА — что есть в сцене (иерархия). Список объектов, кнопка «добавить»,
//     глаз «спрятать», копия, удаление.
//   В СЕРЕДИНЕ — вид. Настоящая трёхмерная сцена: тянешь мышью — облетаешь,
//     колесо — ближе-дальше, щелчок по объекту — выбрал его.
//   СПРАВА — свойства выбранного (инспектор). Место, поворот, размер, цвет,
//     блеск, и его собственный скрипт.
//   СВЕРХУ — «Играть»: та же сцена, но скрипты работают и можно ходить.
//
// ГЛАВНОЕ РЕШЕНИЕ: и вид, и игра рисуются ОДНИМ движком (scene.ts). Если бы
// редактор рисовал одно, а игра другое, они разошлись бы на второй же версии, и
// «в редакторе было по-другому» стало бы обычным делом.

const ВИДЫ: NodeKind[] = ['box', 'sphere', 'cylinder', 'plane', 'light', 'empty']

/** Подсказка для скрипта — чтобы не гадать, что писать. */
const ПРИМЕР_СКРИПТА = `// «это» — сам объект. Крутим его:
function onFrame(dt) {
  это.rotation.y += dt
}

// Ещё есть onStart() — выполнится один раз при запуске.`

export function SceneEditor({
  scene, onChange, onLog,
}: {
  scene: Scene
  onChange: (s: Scene) => void
  onLog: (уровень: 'log' | 'error' | 'warn', текст: string) => void
}) {
  const [выбран, setВыбран] = useState<string | null>(null)
  const [играем, setИграем] = useState(false)
  const [обновить, setОбновить] = useState(0)
  const рамка = useRef<HTMLIFrameElement | null>(null)
  const [скриптОткрыт, setСкриптОткрыт] = useState(false)

  const узел = scene.nodes.find(n => n.id === выбран) ?? null

  // Вид пересобирается не на каждую букву: перезапуск сцены сбрасывает облёт
  // камеры, и правка полей превращалась бы в мигание.
  const таймер = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (таймер.current) clearTimeout(таймер.current)
    таймер.current = setTimeout(() => setОбновить(v => v + 1), 400)
    return () => { if (таймер.current) clearTimeout(таймер.current) }
  }, [scene])

  const страница = useMemo(
    () => frameDoc(scenePage(scene, играем ? 'игра' : 'редактор')),
    [обновить, играем],
  )

  // Ответчик вида: он зовёт ponoi так же, как настоящее окно, и сообщает, по
  // какому объекту щёлкнули.
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (!рамка.current || e.source !== рамка.current.contentWindow) return
      const m = e.data as any
      if (!m || m.ponoi !== 1) return
      if (m.k === 'сцена') {
        if (m.выбран !== undefined && !играем) setВыбран(m.выбран)
        return
      }
      if (m.k !== 'call') return
      const ответ = (ok: boolean, value: unknown, error: string) =>
        рамка.current?.contentWindow?.postMessage({ ponoi: 1, k: 'res', id: m.id, ok, value, error }, '*')
      const args = Array.isArray(m.args) ? m.args : []
      try {
        switch (String(m.method)) {
          case 'log':
            onLog(args[1] === 'error' ? 'error' : args[1] === 'warn' ? 'warn' : 'log', String(args[0] ?? ''))
            return ответ(true, null, '')
          case 'libs.list': return ответ(true, await libList(), '')
          case 'libs.get': {
            const b = await libSource(String(args[0] ?? ''))
            return b ? ответ(true, b, '') : ответ(false, null, 'Нет такой библиотеки')
          }
          case 'subscribe': return ответ(true, null, '')
          default: return ответ(false, null, `«${m.method}» в показе недоступен`)
        }
      } catch (err: any) { ответ(false, null, String(err?.message ?? err)) }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [onLog, играем])

  // Выбранный объект подсвечивается прямо в сцене — иначе по списку не понять,
  // какой из трёх кубов сейчас правишь.
  useEffect(() => {
    рамка.current?.contentWindow?.postMessage({ ponoi: 1, k: 'выбрать', id: выбран }, '*')
  }, [выбран, обновить, играем])

  const правь = (patch: Partial<SceneNode>) => {
    if (!узел) return
    onChange(updateNode(scene, узел.id, patch))
  }
  const тройка = (поле: 'pos' | 'rot' | 'scale', i: number, v: string) => {
    if (!узел) return
    const т = [...узел[поле]] as [number, number, number]
    т[i] = num(v, т[i])
    правь({ [поле]: т } as Partial<SceneNode>)
  }

  return (
    <div className="sc-grid">
      {/* ── Что есть в сцене ─────────────────────────────────────────── */}
      <div className="sc-tree">
        <div className="ws-pane-h"><span>Сцена</span></div>
        <div className="sc-add">
          {ВИДЫ.map(k => (
            <button key={k} className="pqs2-btn ghost" title={'Добавить: ' + KIND_LABEL[k]}
              onClick={() => { const r = addNode(scene, k); onChange(r.scene); setВыбран(r.id) }}>
              + {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="sc-list">
          {scene.nodes.map(n => (
            <div key={n.id} className={'sc-node' + (n.id === выбран ? ' on' : '') + (n.visible ? '' : ' off')}
              onClick={() => setВыбран(n.id)}>
              <span className="sc-node-k">{KIND_LABEL[n.kind][0]}</span>
              <span className="sc-node-n notr" translate="no">{n.name}</span>
              <span className="sc-node-a">
                <button title={n.visible ? 'Спрятать' : 'Показать'}
                  onClick={e => { e.stopPropagation(); onChange(updateNode(scene, n.id, { visible: !n.visible })) }}>
                  {n.visible ? '👁' : '–'}
                </button>
                <button title="Копия" onClick={e => {
                  e.stopPropagation()
                  const r = duplicateNode(scene, n.id); onChange(r.scene); setВыбран(r.id)
                }}>⧉</button>
                <button title="Удалить" onClick={e => {
                  e.stopPropagation()
                  onChange(removeNode(scene, n.id))
                  if (выбран === n.id) setВыбран(null)
                }}>×</button>
              </span>
            </div>
          ))}
          {scene.nodes.length === 0 && <div className="sc-empty">Пусто. Добавь объект кнопкой выше.</div>}
        </div>

        <div className="ws-pane-h" style={{ marginTop: 8 }}><span>Мир</span></div>
        <div className="sc-world">
          <label>Небо<input type="color" value={scene.sky}
            onChange={e => onChange({ ...scene, sky: e.target.value })} /></label>
          <label>Подсветка
            <input type="range" min={0} max={2} step={0.05} value={scene.ambient}
              onChange={e => onChange({ ...scene, ambient: num(e.target.value, 0.6) })} />
            <b>{scene.ambient.toFixed(2)}</b></label>
          <label className="sc-chk"><input type="checkbox" checked={scene.shadows}
            onChange={e => onChange({ ...scene, shadows: e.target.checked })} /> тени</label>
          <label className="sc-chk"><input type="checkbox" checked={scene.fly}
            onChange={e => onChange({ ...scene, fly: e.target.checked })} /> ходить в игре (WASD)</label>
        </div>
      </div>

      {/* ── Вид ──────────────────────────────────────────────────────── */}
      <div className="sc-view">
        <div className="ws-pane-h">
          <span>{играем ? 'Игра идёт' : 'Вид — тяни мышью, колесо приближает, щелчок выбирает'}</span>
          <span className="sc-view-acts">
            <button className={'pqs2-btn' + (играем ? ' ghost' : '')}
              onClick={() => setИграем(v => !v)}>
              {играем ? '■ Стоп' : '▶ Играть'}
            </button>
            <button className="pqs2-btn ghost" title="Перезапустить"
              onClick={() => setОбновить(v => v + 1)}><Icon name="rotate" size={14} /></button>
          </span>
        </div>
        <iframe key={String(обновить) + String(играем)} ref={рамка} className="sc-canvas" title="Сцена"
          sandbox="allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox"
          allow="autoplay; fullscreen; gamepad; xr-spatial-tracking"
          srcDoc={страница} />
      </div>

      {/* ── Свойства ─────────────────────────────────────────────────── */}
      <div className="sc-insp">
        <div className="ws-pane-h"><span>Свойства</span></div>
        {!узел && <div className="sc-empty">Выбери объект — в списке или щелчком по сцене.</div>}
        {узел && <>
          <label className="sc-row"><span>Имя</span>
            <input className="modal-in" value={узел.name}
              onChange={e => правь({ name: e.target.value })} /></label>
          <div className="sc-kind">{KIND_LABEL[узел.kind]}</div>

          {([['pos', 'Место'], ['rot', 'Поворот, °'], ['scale', 'Размер']] as const).map(([поле, подпись]) => (
            <div className="sc-vec" key={поле}>
              <span>{подпись}</span>
              <div>
                {[0, 1, 2].map(i => (
                  <input key={i} className="modal-in" type="number" step={поле === 'rot' ? 5 : 0.1}
                    value={узел[поле][i]}
                    onChange={e => тройка(поле, i, e.target.value)} />
                ))}
              </div>
            </div>
          ))}

          <label className="sc-row"><span>Цвет</span>
            <input type="color" value={узел.color} onChange={e => правь({ color: e.target.value })} /></label>
          <label className="sc-row"><span>{узел.kind === 'light' ? 'Яркость' : 'Блеск'}</span>
            <input type="range" min={0} max={узел.kind === 'light' ? 5 : 1} step={0.05} value={узел.shine}
              onChange={e => правь({ shine: num(e.target.value, 0.4) })} />
            <b>{узел.shine.toFixed(2)}</b></label>

          <div className="ws-pane-h" style={{ marginTop: 10 }}>
            <span>Скрипт объекта</span>
            <button className="pqs2-btn ghost" onClick={() => setСкриптОткрыт(v => !v)}>
              {скриптОткрыт ? 'Свернуть' : (узел.script.trim() ? 'Править' : 'Добавить')}
            </button>
          </div>
          {скриптОткрыт && <>
            <textarea className="sc-script notr" translate="no" spellCheck={false}
              value={узел.script} placeholder={ПРИМЕР_СКРИПТА}
              onChange={e => правь({ script: e.target.value })} />
            <div className="sc-hint">
              <code>это</code> — сам объект, <code>сцена</code> — вся сцена, <code>THREE</code> —
              библиотека. Пиши <code>onStart()</code> и <code>onFrame(dt)</code>.
              Скрипты работают только когда нажато «Играть».
            </div>
          </>}
          {!скриптОткрыт && узел.script.trim() && (
            <div className="sc-hint">Скрипт есть — {узел.script.trim().split('\n').length} строк.</div>
          )}
        </>}
      </div>
    </div>
  )
}
