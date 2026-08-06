import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { installPlugin } from '../lib/plugins/install'
import { parsePlugin } from '../lib/plugins/manifest'
import { loadPlugins, removePlugin } from '../lib/plugins/store'
import { startPlugin, stopPlugin } from '../lib/plugins/host'
import { frameDoc } from '../lib/plugins/htmlFrame'
import { libSource, libList } from '../lib/plugins/libs'
import {
  PROJ_TEMPLATES, buildPage, buildProject, parseProject, fromOldApp, isProject,
  projId, kindOf, okFileName, newSceneProject, type Project, type ProjFile,
} from '../lib/plugins/workshop'
import { SceneEditor } from './SceneEditor'

// v1.497.0: МАСТЕРСКАЯ — отдельный отдел для своих приложений.
//
// Владелец: «сделай создание приложения отдельным окном рядом с ботами и
// плагинами, чтобы был гигантский отдел, где можно хоть 3д игру создать в нашем
// редакторе наподобие Unity».
//
// Что здесь от «наподобие Unity» и почему именно это. Не кнопки и не панели
// ради панелей, а четыре вещи, без которых игру не сделать:
//
//   1. ПРОЕКТ ИЗ ФАЙЛОВ, а не одно поле. У игры есть сцена, управление,
//      физика — в одной простыне их не найти.
//   2. ЖИВОЙ ПОКАЗ рядом. Цикл «правка → результат» должен идти секунду, а не
//      полминуты через сохранение и открытие.
//   3. КОНСОЛЬ. Внутри окна её нет, и без неё ошибка выглядит как «ничего не
//      происходит». Сюда приходят и ponoi.log, и настоящие ошибки страницы.
//   4. ЧЕСТНАЯ ПЕСОЧНИЦА. Показ идёт в той же рамке и с теми же правами, что
//      настоящее окно. Иначе здесь работало бы то, что в жизни откажет.
//
// Почему мастерская сама отвечает на вызовы страницы. В показе плагин ещё не
// установлен — отвечать некому. Поэтому здесь свой маленький ответчик: журнал,
// встроенные библиотеки, хранилище в памяти. Всё остальное честно отказывает с
// объяснением, а не молчит.

interface Строка { уровень: 'log' | 'error' | 'warn'; текст: string; время: number }

const ПУСТОЙ = (): Project => ({
  id: '', name: '', version: '1.0.0', author: '', description: '',
  files: PROJ_TEMPLATES[0].files.map(f => ({ ...f })),
  width: 960, height: 640, frameless: false, transparent: false, permissions: [],
})

export function AppWorkshop({ onClose }: { onClose: () => void }) {
  const [проект, setПроект] = useState<Project | null>(null)
  const [список, setСписок] = useState(0)

  const свои = useMemo(() => loadPlugins().filter(p => isProject(p.code) || p.code.includes('const СТРАНИЦА = ')), [список])

  if (проект) {
    return <Редактор проект={проект} onClose={() => { setПроект(null); setСписок(v => v + 1) }} />
  }

  return (
    <div className="ws-screen">
      <div className="ws-top">
        <button className="pqs2-btn ghost" onClick={onClose}><Icon name="arrow-left" size={16} /> Назад</button>
        <h2 className="ws-title">Мастерская</h2>
      </div>
      <div className="ws-intro">
        Здесь делают приложения: игру, редактор, инструмент — всё, что живёт в своём окне.
        Внутри обычные HTML, CSS и JavaScript, рядом — живой показ и консоль. Готовое
        сохраняется обычным плагином: его можно скачать файлом и отдать кому угодно.
      </div>

      {/* v1.498.0: визуальный путь — первым и крупно. Он и есть ответ на
          «буквально Unity»: сцену собирают мышью, а не переписывают чужой
          пример. Код рядом остаётся для тех, кому нужен именно код. */}
      <button className="ws-big" onClick={() => setПроект(newSceneProject())}>
        <span className="ws-big-n">Собрать 3D-сцену</span>
        <span className="ws-big-h">
          Визуально: ставишь объекты, крутишь камеру мышью, задаёшь цвет и размер полями.
          Нажал «Играть» — ходишь по своей сцене. Скрипт можно повесить на любой объект.
        </span>
      </button>

      <div className="pqs-sec-t" style={{ marginTop: 18 }}>Или начать кодом</div>
      <div className="ws-tpls">
        {PROJ_TEMPLATES.map(т => (
          <button key={т.id} className={'ws-tpl' + (т.big ? ' big' : '')}
            onClick={() => setПроект({ ...ПУСТОЙ(), name: '', files: т.files.map(f => ({ ...f })) })}>
            <span className="ws-tpl-n">{т.label}</span>
            <span className="ws-tpl-h">{т.hint}</span>
          </button>
        ))}
      </div>

      {свои.length > 0 && <>
        <div className="pqs-sec-t" style={{ marginTop: 22 }}>Мои приложения</div>
        <div className="ws-list">
          {свои.map(p => (
            <div key={p.manifest.id} className="ws-item">
              <div className="ws-item-n">
                <b>{p.manifest.name}</b>
                <span className="plug-ver">{p.manifest.version}</span>
              </div>
              <div className="ws-item-d">{p.manifest.description || 'без описания'}</div>
              <button className="pqs2-btn ghost" onClick={() => {
                const пр = parseProject(p.code) ?? fromOldApp(p.code)
                if (пр) setПроект(пр)
                else toastErr('Этот файл собран не мастерской — открой его в конструкторе плагинов')
              }}><Icon name="edit" size={15} /> Открыть</button>
            </div>
          ))}
        </div>
      </>}
    </div>
  )
}

function Редактор({ проект, onClose }: { проект: Project; onClose: () => void }) {
  const [p, setP] = useState<Project>(проект)
  const [выбран, setВыбран] = useState(0)
  const [журнал, setЖурнал] = useState<Строка[]>([])
  const [показ, setПоказ] = useState(0)
  const [занят, setЗанят] = useState(false)
  const [консоль, setКонсоль] = useState(true)
  const рамка = useRef<HTMLIFrameElement | null>(null)
  const хранилище = useRef<Record<string, unknown>>({})

  const файл = p.files[Math.min(выбран, p.files.length - 1)]

  // Показ пересобирается не на каждую букву: перезапуск убивает всё, что
  // страница успела сделать, и мигает на каждом нажатии.
  const таймер = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (таймер.current) clearTimeout(таймер.current)
    таймер.current = setTimeout(() => setПоказ(v => v + 1), 800)
    return () => { if (таймер.current) clearTimeout(таймер.current) }
  }, [p.files])

  const страница = useMemo(() => frameDoc(buildPage(p.files)), [показ])

  const пиши = useCallback((уровень: Строка['уровень'], текст: string) => {
    setЖурнал(ж => [...ж.slice(-199), { уровень, текст, время: Date.now() }])
  }, [])

  // ── Ответчик показа ──────────────────────────────────────────────────────
  //
  // Страница зовёт ponoi так же, как в настоящем окне. Плагина ещё нет, поэтому
  // отвечаем сами — тем, что можно отдать без установки: журналом, встроенными
  // библиотеками и хранилищем в памяти. Остальное честно отказывает: пусть
  // автор увидит отказ здесь, а не после сохранения.
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (!рамка.current || e.source !== рамка.current.contentWindow) return
      const m = e.data as any
      if (!m || m.ponoi !== 1 || m.k !== 'call') return
      const ответ = (ok: boolean, value: unknown, error: string) =>
        рамка.current?.contentWindow?.postMessage({ ponoi: 1, k: 'res', id: m.id, ok, value, error }, '*')
      const args = Array.isArray(m.args) ? m.args : []
      try {
        switch (String(m.method)) {
          case 'log':
            пиши((args[1] === 'error' ? 'error' : args[1] === 'warn' ? 'warn' : 'log'), String(args[0] ?? ''))
            return ответ(true, null, '')
          case 'notify':
            пиши('log', '🔔 ' + String(args[0] ?? ''))
            return ответ(true, null, '')
          case 'libs.list':
            return ответ(true, await libList(), '')
          case 'libs.get': {
            const b = await libSource(String(args[0] ?? ''))
            if (!b) return ответ(false, null, 'Нет такой библиотеки')
            return ответ(true, b, '')
          }
          case 'storage.set': хранилище.current[String(args[0])] = args[1]; return ответ(true, true, '')
          case 'storage.get': return ответ(true, хранилище.current[String(args[0])] ?? null, '')
          case 'storage.keys': return ответ(true, Object.keys(хранилище.current), '')
          case 'storage.remove': delete хранилище.current[String(args[0])]; return ответ(true, true, '')
          case 'subscribe': return ответ(true, null, '')
          default:
            return ответ(false, null, `«${m.method}» в показе недоступен — проверь это в настоящем окне после сохранения`)
        }
      } catch (err: any) { ответ(false, null, String(err?.message ?? err)) }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [пиши])

  useEffect(() => { setЖурнал([]) }, [показ])

  function правь(текст: string) {
    setP(x => ({ ...x, files: x.files.map((f, i) => (i === выбран ? { ...f, text: текст } : f)) }))
  }

  function добавьФайл() {
    const имя = prompt('Имя файла (например сцена.js, стили.css, окно.html)')
    if (!имя) return
    try {
      const ок = okFileName(имя, p.files.map(f => f.name))
      setP(x => ({ ...x, files: [...x.files, { name: ок, kind: kindOf(ок), text: '' }] }))
      setВыбран(p.files.length)
    } catch (e: any) { toastErr(e.message) }
  }

  async function удалиФайл(i: number) {
    if (p.files.length === 1) { toastErr('Последний файл удалить нельзя'); return }
    if (!await confirmUi(`Удалить файл «${p.files[i].name}»?`, { okText: 'Удалить', danger: true })) return
    setP(x => ({ ...x, files: x.files.filter((_, k) => k !== i) }))
    setВыбран(0)
  }

  /** Порядок файлов — это порядок выполнения. Двигать его надо руками. */
  function двинь(i: number, куда: -1 | 1) {
    const j = i + куда
    if (j < 0 || j >= p.files.length) return
    setP(x => {
      const f = [...x.files]
      const t = f[i]; f[i] = f[j]; f[j] = t
      return { ...x, files: f }
    })
    setВыбран(j)
  }

  async function сохранить() {
    if (!p.name.trim()) { toastErr('Дай приложению название'); return }
    setЗанят(true)
    try {
      const код = buildProject(p)
      const id = projId(p.id || p.name)
      await installPlugin(parsePlugin(код), код, null, true)
      await stopPlugin(id)
      const ст = loadPlugins().find(x => x.manifest.id === id)
      if (ст) await startPlugin(ст)
      toastOk('Сохранено и открыто окном')
    } catch (e: any) { toastErr('Не вышло: ' + (e?.message ?? e)) }
    finally { setЗанят(false) }
  }

  async function удалить() {
    const id = projId(p.id || p.name)
    if (!await confirmUi(`Удалить приложение «${p.name}»?`, { okText: 'Удалить', danger: true })) return
    await stopPlugin(id)
    removePlugin(id)
    toastOk('Удалено')
    onClose()
  }

  function скачать() {
    const b = new Blob([buildProject(p)], { type: 'text/javascript' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b)
    a.download = projId(p.id || p.name) + '.ponoi'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const ошибок = журнал.filter(с => с.уровень === 'error').length

  return (
    <div className="ws-screen ws-edit">
      <div className="ws-top">
        <button className="pqs2-btn ghost" onClick={onClose}><Icon name="arrow-left" size={16} /> К списку</button>
        <input className="modal-in ws-name" placeholder="Название приложения" value={p.name}
          onChange={e => setP(x => ({ ...x, name: e.target.value }))} />
        <div className="ws-top-acts">
          <button className="pqs2-btn ghost" title="Перезапустить показ" onClick={() => setПоказ(v => v + 1)}>
            <Icon name="rotate" size={15} />
          </button>
          <button className="pqs2-btn ghost" title="Скачать файлом" onClick={скачать}>
            <Icon name="download" size={15} />
          </button>
          <button className="pqs2-btn ghost danger" title="Удалить" onClick={() => void удалить()}>
            <Icon name="trash" size={15} />
          </button>
          <button className="modal-primary" disabled={занят} onClick={() => void сохранить()}>
            {занят ? 'Сохраняю…' : 'Сохранить и открыть'}
          </button>
        </div>
      </div>

      {p.scene ? (
        <SceneEditor
          scene={p.scene}
          onChange={s => setP(x => ({ ...x, scene: s }))}
          onLog={(у, т) => пиши(у, т)} />
      ) : (
      <div className="ws-grid">
        {/* Файлы проекта */}
        <div className="ws-files">
          <div className="ws-pane-h">
            <span>Файлы</span>
            <button className="pqs2-btn ghost" onClick={добавьФайл} title="Добавить файл">
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div className="ws-flist">
            {p.files.map((f, i) => (
              <div key={f.name + i} className={'ws-file' + (i === выбран ? ' on' : '')}
                onClick={() => setВыбран(i)}>
                <span className={'ws-file-k ' + f.kind}>{f.kind}</span>
                <span className="ws-file-n notr" translate="no">{f.name}</span>
                <span className="ws-file-acts">
                  <button title="Выше" onClick={e => { e.stopPropagation(); двинь(i, -1) }}>↑</button>
                  <button title="Ниже" onClick={e => { e.stopPropagation(); двинь(i, 1) }}>↓</button>
                  <button title="Удалить" onClick={e => { e.stopPropagation(); void удалиФайл(i) }}>×</button>
                </span>
              </div>
            ))}
          </div>
          <div className="ws-hint">
            Порядок = порядок выполнения. Библиотека должна стоять выше того, кто её зовёт.
          </div>
          <div className="ws-props">
            <label>Ширина<input className="modal-in" type="number" value={p.width}
              onChange={e => setP(x => ({ ...x, width: Number(e.target.value) || 960 }))} /></label>
            <label>Высота<input className="modal-in" type="number" value={p.height}
              onChange={e => setP(x => ({ ...x, height: Number(e.target.value) || 640 }))} /></label>
            <label className="ws-chk"><input type="checkbox" checked={p.frameless}
              onChange={e => setP(x => ({ ...x, frameless: e.target.checked }))} /> без рамки</label>
            <label className="ws-chk"><input type="checkbox" checked={p.transparent}
              onChange={e => setP(x => ({ ...x, transparent: e.target.checked }))} /> прозрачно</label>
          </div>
        </div>

        {/* Код */}
        <div className="ws-code-pane">
          <div className="ws-pane-h">
            <span className="notr" translate="no">{файл?.name ?? 'файл'}</span>
            <span className="ws-code-i">{(файл?.text ?? '').split('\n').length} строк</span>
          </div>
          <textarea className="ws-code notr" translate="no" spellCheck={false}
            value={файл?.text ?? ''} onChange={e => правь(e.target.value)}
            onKeyDown={e => {
              // Табом двигают код, а не уходят с поля: в редакторе это ожидаемо.
              if (e.key !== 'Tab') return
              e.preventDefault()
              const t = e.currentTarget
              const s = t.selectionStart, к = t.selectionEnd
              const v = t.value.slice(0, s) + '  ' + t.value.slice(к)
              правь(v)
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2 })
            }} />
        </div>

        {/* Показ и консоль */}
        <div className="ws-run">
          <div className="ws-pane-h">
            <span>Показ</span>
            <button className={'pqs2-btn ghost' + (консоль ? ' on' : '')}
              onClick={() => setКонсоль(v => !v)}>
              Консоль{ошибок > 0 ? ' · ' + ошибок : ''}
            </button>
          </div>
          {/* Та же песочница, что у настоящего окна: без allow-same-origin.
              Иначе здесь работало бы то, что в жизни откажет. */}
          <iframe key={показ} ref={рамка} className="ws-prev" title="Показ"
            sandbox="allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox"
            allow="autoplay; fullscreen; gamepad; xr-spatial-tracking"
            srcDoc={страница} />
          {консоль && (
            <div className="ws-console">
              {журнал.length === 0 && <div className="ws-con-empty">Здесь появятся ponoi.log и ошибки страницы.</div>}
              {журнал.map((с, i) => (
                <div key={i} className={'ws-con-l ' + с.уровень}>{с.текст}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Консоль у сцены — снизу во всю ширину: справа у неё инспектор. */}
      {p.scene && (
        <div className="ws-console sc-console">
          {журнал.length === 0
            ? <div className="ws-con-empty">Здесь появятся ошибки скриптов и ponoi.log.</div>
            : журнал.map((с, i) => <div key={i} className={'ws-con-l ' + с.уровень}>{с.текст}</div>)}
        </div>
      )}
    </div>
  )
}
