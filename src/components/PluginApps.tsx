import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { PanelRows } from './PluginPanels'
import { emitToPlugin } from '../lib/plugins/bridge'
import {
  appList, subscribeApps, closeAppByUser, moveApp, resizeApp, toggleMaxApp, snapApp,
  type PluginApp,
} from '../lib/plugins/apps'

// v1.471.0: своя область экрана у плагина — окно, вкладка, полный экран, PiP.
//
// Один компонент на все четыре вида. Различаются они ровно местом: где стоит
// прямоугольник. Всё остальное — шапка, содержимое, закрытие, поведение на
// телефоне — общее, и разводить это на четыре компонента значило бы обречь их
// разойтись (в одном появится закрытие по Esc, в другом нет).
//
// v1.479.0: окно стало НАСТОЯЩИМ окном. Раньше его можно было только таскать —
// размер задавал плагин, место забывалось при закрытии, а развернуть было
// нечем. Теперь: тянется за любой край и угол, разворачивается двойным щелчком
// по шапке, прилипает к краям экрана половиной (как в Windows), а место и
// размер помнятся между запусками.
//
// ЧТО ЗДЕСЬ НЕЛЬЗЯ УБИРАТЬ. Шапку с кнопкой закрытия и ИМЕНЕМ ПЛАГИНА. Само
// слово «плагин» владелец попросил убрать — оно и правда только шумело, — но
// имя того, чьё это окно, остаётся: окно во весь экран без единой подписи
// стало бы способом подделать приложение целиком и попросить, например,
// пароль. Имя плагина отвечает на этот вопрос, не мешая глазу.

/** Насколько близко к краю надо подвести окно, чтобы оно прилипло. */
const SNAP_PX = 24

/**
 * Перетаскивание и растягивание.
 *
 * Обе задачи здесь вместе не для краткости: у них общий указатель и общий
 * набор границ экрана. Разведи их по разным местам — и правило «не утащить
 * окно за край» пришлось бы писать дважды, а значит однажды разойтись.
 */
function useDragResize(app: PluginApp) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [rz, setRz] = useState<{ side: string; x0: number; y0: number; w0: number; h0: number; left: number; top: number } | null>(null)
  const [подсказка, setПодсказка] = useState<'left' | 'right' | 'top' | null>(null)
  /** Куда доехали, пока тянем. В модель уходит один раз, при отпускании. */
  const место = useRef<{ x: number; y: number } | null>(null)
  const размер = useRef<{ w: number; h: number; x?: number; y?: number } | null>(null)

  const экран = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight })

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const { w: sw, h: sh } = экран()
      const w = el.offsetWidth, h = el.offsetHeight
      // Не даём утащить окно за край: вернуть его оттуда было бы нечем.
      const x = Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, sw - w))
      const y = Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, sh - h))
      // v1.479.0: пока тянем — двигаем САМ элемент, а не состояние. Каждое
      // движение мыши через состояние перерисовывало ВСЕ окна плагинов вместе
      // с их содержимым, а это десятки раз в секунду и рядом с работающей
      // игрой на холсте. В модель кладём один раз, когда отпустили.
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      место.current = { x, y }
      // Подсказка прилипания: у самого края показываем, куда окно встанет.
      setПодсказка(e.clientY <= SNAP_PX ? 'top'
        : e.clientX <= SNAP_PX ? 'left'
        : e.clientX >= sw - SNAP_PX ? 'right' : null)
    }
    const up = (e: PointerEvent) => {
      const { w: sw } = экран()
      // Сначала кладём в модель то, куда доехали: иначе прилипание считало бы
      // от старого места, а без прилипания окно вернулось бы назад.
      if (место.current) moveApp(app.id, место.current.x, место.current.y)
      место.current = null
      if (e.clientY <= SNAP_PX) toggleMaxApp(app.id, экран())
      else if (e.clientX <= SNAP_PX) snapApp(app.id, 'left', экран())
      else if (e.clientX >= sw - SNAP_PX) snapApp(app.id, 'right', экран())
      setПодсказка(null)
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, app.id])

  useEffect(() => {
    if (!rz) return
    const move = (e: PointerEvent) => {
      const дх = e.clientX - rz.x0, ду = e.clientY - rz.y0
      let w = rz.w0, h = rz.h0, x = rz.left, y = rz.top
      if (rz.side.includes('e')) w = rz.w0 + дх
      if (rz.side.includes('s')) h = rz.h0 + ду
      // За левый и верхний край окно и растёт, и переезжает — иначе оно
      // «уползало» бы от указателя.
      if (rz.side.includes('w')) { w = rz.w0 - дх; x = rz.left + дх }
      if (rz.side.includes('n')) { h = rz.h0 - ду; y = rz.top + ду }
      const el = ref.current
      if (!el) return
      // Как и с перетаскиванием: пока тянем — меняем элемент, в модель кладём
      // при отпускании. Иначе каждый кадр перерисовывает всё содержимое окна.
      w = Math.max(app.minW, Math.min(w, 1600))
      h = Math.max(app.minH, Math.min(h, 1200))
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      if (rz.side.includes('w')) el.style.left = Math.max(0, x) + 'px'
      if (rz.side.includes('n')) el.style.top = Math.max(0, y) + 'px'
      размер.current = { w, h, x: rz.side.includes('w') ? Math.max(0, x) : undefined, y: rz.side.includes('n') ? Math.max(0, y) : undefined }
    }
    const up = () => {
      const р = размер.current
      if (р) resizeApp(app.id, р.w, р.h, р.x, р.y)
      размер.current = null
      setRz(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [rz, app.id])

  const startDrag = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top })
  }
  const startResize = (side: string) => (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    e.stopPropagation()
    const r = el.getBoundingClientRect()
    setRz({ side, x0: e.clientX, y0: e.clientY, w0: r.width, h0: r.height, left: r.left, top: r.top })
  }
  return { ref, startDrag, startResize, dragging: !!drag || !!rz, подсказка }
}

/** Восемь ручек по краям — как у любого окна. */
const СТОРОНЫ = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const

function AppFrame({ app }: { app: PluginApp }) {
  const { ref, startDrag, startResize, dragging, подсказка } = useDragResize(app)
  const плавает = app.mode === 'window' || app.mode === 'pip' || app.mode === 'widget'

  // Плагин узнаёт, что его окно открылось и что с ним стало: закрыть окно может
  // человек, и не сказать об этом значило бы оставить плагин рисовать в никуда.
  useEffect(() => {
    emitToPlugin(app.pluginId, 'app', {
      id: app.id, mode: app.mode, open: true, width: app.w, height: app.h,
    })
    return () => {
      emitToPlugin(app.pluginId, 'app', { id: app.id, mode: app.mode, open: false, width: app.w, height: app.h })
    }
  }, [app.id, app.pluginId, app.mode, app.w, app.h])

  // Фокус — сразу на окно (v1.474.0). Иначе клавиши достались бы ему только
  // после того, как человек догадается щёлкнуть по окну, и игра выглядела бы
  // сломанной ровно до этого щелчка.
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [app.id])

  // Esc закрывает — как любое окно приложения. Плагин перехватить это не может.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAppByUser(app.id) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app.id])

  // v1.474.0: клавиши — плагину, но только пока фокус внутри ЕГО окна.
  //
  // Зачем. ui.addHotkey требует Ctrl или Alt (иначе плагин отобрал бы обычные
  // буквы у всего приложения), а игре нужны стрелки и пробел. Без этого окно во
  // весь экран с холстом было бы картинкой, которой нельзя управлять.
  //
  // Почему это не шпион за набором. Слушаем не окно браузера, а ЭТОТ
  // прямоугольник: набор в чате, поиск и любое поле ввода живут снаружи, и
  // сюда их события не всплывают. Esc не отдаём вовсе — он закрывает окно, и
  // перехватить его плагин не должен.
  const клавиша = (e: React.KeyboardEvent, down: boolean) => {
    if (e.key === 'Escape') return
    // Стрелки и пробел прокручивают страницу под окном — для игры это значит
    // «нажал вверх, уехал экран». Отменяем, раз уж фокус здесь.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown'].includes(e.key)) {
      e.preventDefault()
    }
    emitToPlugin(app.pluginId, 'key', {
      id: app.id, key: e.key, code: e.code, down, repeat: e.repeat,
      shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey,
    })
  }

  const style: React.CSSProperties = плавает
    ? {
        width: app.w, height: app.h,
        left: app.x ?? undefined, top: app.y ?? undefined,
        // Пока человек не двигал окно, оно стоит по умолчанию: обычное — по
        // центру, маленькое — в правом нижнем углу, где ему и место.
        right: app.x === null && app.mode === 'pip' ? 20 : undefined,
        bottom: app.y === null && app.mode === 'pip' ? 20 : undefined,
      }
    : {}

  return (
    <div ref={ref} className={'plugapp plugapp-' + app.mode + (dragging ? ' dragging' : '')} style={style}
      // Окно должно уметь принимать фокус — иначе клавиш ему не достанется
      // вовсе. Фокус ставится сам при открытии: игра обязана работать сразу, а
      // не после того, как человек догадается щёлкнуть по ней.
      tabIndex={-1}
      onKeyDown={e => клавиша(e, true)}
      onKeyUp={e => клавиша(e, false)}>
      {/* Подсказка прилипания: полупрозрачная тень там, куда встанет окно. */}
      {подсказка && <div className={'plugapp-snap ' + подсказка} />}
      <div className={'plugapp-h' + (плавает ? ' draggable' : '')}
        onPointerDown={плавает ? startDrag : undefined}
        onDoubleClick={плавает ? () => toggleMaxApp(app.id, {
          w: document.documentElement.clientWidth, h: document.documentElement.clientHeight,
        }) : undefined}>
        <Icon name={app.icon} size={16} />
        <b className="notr" translate="no">{app.title}</b>
        {/* v1.479.0: вместо слова «плагин» — имя того, чьё это окно. Владелец
            попросил убрать надпись, и она правда только шумела; но совсем без
            подписи окно во весь экран стало бы способом выдать себя за само
            приложение. Имя отвечает на этот вопрос и не мешает. */}
        <span className="plugapp-by notr" translate="no">{app.pluginId}</span>
        {плавает && app.mode !== 'widget' && <button className="plugapp-x" title={app.max ? 'Свернуть' : 'Развернуть'}
          onPointerDown={e => e.stopPropagation()}
          onClick={() => toggleMaxApp(app.id, {
            w: document.documentElement.clientWidth, h: document.documentElement.clientHeight,
          })}>{app.max ? '❐' : '▢'}</button>}
        <button className="plugapp-x" title="Закрыть (Esc)"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => closeAppByUser(app.id)}>×</button>
      </div>
      <div className="plugapp-body">
        <PanelRows pluginId={app.pluginId} rows={app.rows} />
      </div>
      {/* Ручки по краям. Только у плавающих окон: у вкладки и полного экрана
          размер задаёт не человек, а место, где они стоят. */}
      {плавает && app.resizable && СТОРОНЫ.map(s => (
        <div key={s} className={'plugapp-rz ' + s} onPointerDown={startResize(s)} />
      ))}
    </div>
  )
}

/**
 * Все области плагинов. Ставится один раз, в самом верху приложения: окно во
 * весь экран не должно зависеть от того, какой экран сейчас открыт.
 *
 * Пока областей нет, не рисует ничего и почти ничего не стоит.
 */
export function PluginApps() {
  const [, bump] = useState(0)
  useEffect(() => subscribeApps(() => bump(v => v + 1)), [])
  const list = appList()
  if (list.length === 0) return null
  // Вкладки и полный экран рисуются поверх, плавающие — над ними: человек
  // только что взял окно в руку, оно и должно быть сверху.
  const порядок = { tab: 0, fullscreen: 1, window: 2, widget: 3, pip: 4 } as const
  return (
    <div className="plugapps">
      {[...list].sort((a, b) => порядок[a.mode] - порядок[b.mode]).map(a => (
        <AppFrame key={a.id} app={a} />
      ))}
    </div>
  )
}
