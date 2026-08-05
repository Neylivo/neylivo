import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { PanelRows } from './PluginPanels'
import { emitToPlugin } from '../lib/plugins/bridge'
import {
  appList, subscribeApps, closeAppByUser, moveApp,
  type PluginApp,
} from '../lib/plugins/apps'

// v1.471.0: своя область экрана у плагина — окно, вкладка, полный экран, PiP.
//
// Один компонент на все четыре вида. Различаются они ровно местом: где стоит
// прямоугольник. Всё остальное — шапка, содержимое, закрытие, поведение на
// телефоне — общее, и разводить это на четыре компонента значило бы обречь их
// разойтись (в одном появится закрытие по Esc, в другом нет).
//
// ЧТО ЗДЕСЬ НЕЛЬЗЯ УБИРАТЬ. Шапку с именем плагина и крестиком. Плагин не может
// ни спрятать её, ни перехватить крестик: содержимое — это описание строк, а
// рисуем мы. Без неё окно во весь экран стало бы способом подделать приложение
// целиком и не дать себя закрыть — то есть ровно тем, ради чего в приложении
// держится аварийный режим.

/** Куда человек утащил окно. Держим в пикселях от левого верхнего угла. */
function useDrag(app: PluginApp) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      // Не даём утащить окно за край: вернуть его оттуда было бы нечем.
      const w = el.offsetWidth, h = el.offsetHeight
      const x = Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, window.innerWidth - w))
      const y = Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, window.innerHeight - h))
      moveApp(app.id, x, y)
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, app.id])

  const start = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top })
  }
  return { ref, start, dragging: !!drag }
}

function AppFrame({ app }: { app: PluginApp }) {
  const { ref, start, dragging } = useDrag(app)
  const плавает = app.mode === 'window' || app.mode === 'pip'

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

  return (
    <div ref={ref} className={'plugapp plugapp-' + app.mode + (dragging ? ' dragging' : '')} style={style}
      // Окно должно уметь принимать фокус — иначе клавиш ему не достанется
      // вовсе. Фокус ставится сам при открытии: игра обязана работать сразу, а
      // не после того, как человек догадается щёлкнуть по ней.
      tabIndex={-1}
      onKeyDown={e => клавиша(e, true)}
      onKeyUp={e => клавиша(e, false)}>
      <div className={'plugapp-h' + (плавает ? ' draggable' : '')}
        onPointerDown={плавает ? start : undefined}>
        <Icon name={app.icon} size={16} />
        <b className="notr" translate="no">{app.title}</b>
        {/* Пометка «плагин» обязательна: человек должен видеть, что это окно
            нарисовано не приложением, а поставленным им плагином. */}
        <span className="plugapp-tag">плагин</span>
        <button className="plugapp-x" title="Закрыть (Esc)"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => closeAppByUser(app.id)}>×</button>
      </div>
      <div className="plugapp-body">
        <PanelRows pluginId={app.pluginId} rows={app.rows} />
      </div>
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
  const порядок = { tab: 0, fullscreen: 1, window: 2, pip: 3 } as const
  return (
    <div className="plugapps">
      {[...list].sort((a, b) => порядок[a.mode] - порядок[b.mode]).map(a => (
        <AppFrame key={a.id} app={a} />
      ))}
    </div>
  )
}
