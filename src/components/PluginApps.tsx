import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { PanelRows } from './PluginPanels'
import { emitToPlugin, callFromFrame } from '../lib/plugins/bridge'
import { subscribeFrameEvents } from '../lib/plugins/frameBus'
import { useBackClose } from '../lib/mobileBack'
import {
  appList, subscribeApps, closeAppByUser, moveApp, resizeApp, toggleMaxApp, snapApp, holdApp, setAppRect,
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
// v1.489.0: у обычного окна шапка есть, у безрамочного её НЕТ СОВСЕМ.
//
// Раньше здесь стояло правило «шапку убирать нельзя»: я боялся, что окно без
// подписи выдаст себя за приложение. Владелец решил иначе и сказал прямо: «не
// надо бояться, главное чтобы не было лишнего». Правило снято, и это его
// решение, а не недосмотр.
//
// ЧТО ЗДЕСЬ НЕЛЬЗЯ УБИРАТЬ — три выхода, ни один из которых ничего не занимает
// на экране: Esc (плагину его не перехватить), системная «назад» на телефоне и
// строка окна на карточке плагина в настройках с кнопкой «Закрыть». Окно,
// которое нечем убрать, — это не «чисто», это ловушка.

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
      holdApp(app.id, false)
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
      holdApp(app.id, false)
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
    // Пока окно в руке у человека, движения плагина игнорируются: иначе окно
    // дёргалось бы прямо под пальцем (v1.485.0).
    holdApp(app.id, true)
    setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top })
  }
  /**
   * Взять окно за ТЕЛО, а не за шапку (v1.487.0).
   *
   * Нужно безрамочному окну: шапки на виду у него нет, и без этого его нельзя
   * было бы сдвинуть вовсе — то есть «поставь куда угодно» перестало бы
   * работать ровно там, где оно нужнее всего.
   *
   * По кнопке, полю и ползунку окно НЕ едет: иначе любое нажатие в плагине
   * превращалось бы в перетаскивание, и нажать что-либо стало бы нельзя.
   *
   * Список нарочно короткий — только то, что человек и правда нажимает. Ставить
   * сюда всё подряд («а вдруг») опаснее, чем кажется: каждая лишняя строка —
   * это кусок окна, за который его больше не сдвинуть, и «поставь куда угодно»
   * незаметно перестаёт работать.
   */
  const startBodyDrag = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement | null
    if (t?.closest('button, input, select, textarea, a, [role="slider"], .plugapp-rz')) return
    startDrag(e)
  }
  const startResize = (side: string) => (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    e.stopPropagation()
    const r = el.getBoundingClientRect()
    holdApp(app.id, true)
    setRz({ side, x0: e.clientX, y0: e.clientY, w0: r.width, h0: r.height, left: r.left, top: r.top })
  }
  return { ref, startDrag, startBodyDrag, startResize, dragging: !!drag || !!rz, подсказка }
}

/**
 * Страница плагина внутри окна (v1.490.0).
 *
 * Внутри — полноценный браузерный документ: свой DOM, свой canvas с webgl и
 * webgpu, свой requestAnimationFrame, мышь, клавиатура, звук, любые
 * библиотеки. Всё это работает само, без единой нашей строки: мы лишь даём
 * место и мост к возможностям плагина.
 *
 * ЧТО ЗДЕСЬ ВАЖНО И ЧЕГО НЕЛЬЗЯ ТРОГАТЬ.
 *
 * sandbox="allow-scripts" БЕЗ allow-same-origin. Это даёт странице уникальное
 * непрозрачное происхождение: она не видит ни наш DOM, ни localStorage, ни
 * куки, ни сессию. Добавь сюда allow-same-origin — и любой поставленный плагин
 * сможет прочитать ключ сессии человека. Это вторая из границ, которые
 * владелец назвал нерушимыми сам.
 *
 * Письма принимаем ТОЛЬКО от своей рамки (сверяем e.source) и приписываем их
 * своему плагину: подделать отправителя нельзя, а чужая рамка на этой странице
 * попадёт в чужой же обработчик.
 */
function AppFrameHtml({ app }: { app: PluginApp }) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  // Документ собираем один раз на каждое изменение html: пересборка на каждой
  // перерисовке перезагружала бы страницу плагина по десять раз в секунду и
  // убивала бы всё, что он в ней успел сделать.
  //
  // Мост подгружается по требованию, а не ввозится сюда: он весит около пяти
  // килобайт текста, а этот компонент живёт в стартовой сборке у КАЖДОГО, в том
  // числе у тех, кто не ставил ни одного плагина. Ровно так система плагинов
  // однажды целиком уехала в старт (v1.469.0), и поймал это смоук.
  const [doc, setDoc] = useState('')
  useEffect(() => {
    let живы = true
    void import('../lib/plugins/htmlFrame').then(m => { if (живы) setDoc(m.frameDoc(app.html ?? '')) })
    return () => { живы = false }
  }, [app.html])
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const m = e.data as any
      if (!m || m.ponoi !== 1 || m.k !== 'call') return
      const ответ = (ok: boolean, value: unknown, error: string) => {
        ref.current?.contentWindow?.postMessage({ ponoi: 1, k: 'res', id: m.id, ok, value, error }, '*')
      }
      callFromFrame(app.pluginId, String(m.method), Array.isArray(m.args) ? m.args : [])
        .then(v => ответ(true, v, ''))
        .catch(err => ответ(false, null, String(err?.message ?? err)))
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [app.pluginId])

  // Событие плагина уходит и в страницу: подписка ponoi.on внутри рамки должна
  // работать так же, как в потоке, — иначе пришлось бы объяснять, что «здесь
  // события есть, а здесь нет».
  useEffect(() => {
    const снять = subscribeFrameEvents(app.pluginId, (name, data) => {
      ref.current?.contentWindow?.postMessage({ ponoi: 1, k: 'ev', name, data }, '*')
    })
    return снять
  }, [app.pluginId])

  // Пока мост не подгрузился, рамки нет: вставить её с пустым документом
  // значило бы дать плагину страницу БЕЗ ponoi, и его код упал бы на первой
  // строке. Возврат стоит ПОСЛЕ всех хуков намеренно — React не прощает
  // условного выхода до них.
  if (!doc) return null

  return (
    <iframe
      ref={ref}
      className="plugapp-frame"
      // БЕЗ allow-same-origin — см. объяснение выше. Это не забытый флаг.
      sandbox="allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox"
      allow="autoplay; fullscreen; gamepad; xr-spatial-tracking"
      title={app.title}
      srcDoc={doc}
    />
  )
}

/** Восемь ручек по краям — как у любого окна. */
const СТОРОНЫ = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const

function AppFrame({ app }: { app: PluginApp }) {
  const { ref, startDrag, startBodyDrag, startResize, dragging, подсказка } = useDragResize(app)
  const плавает = app.mode === 'window' || app.mode === 'pip' || app.mode === 'widget'

  // Плагин узнаёт, что его окно открылось и что с ним стало: закрыть окно может
  // человек, и не сказать об этом значило бы оставить плагин рисовать в никуда.
  // v1.485.0: событие теперь несёт и МЕСТО окна, и приходит при каждом
  // перемещении, а не только при открытии.
  //
  // Зачем. Плагин живёт в отдельном воркере и о перетаскивании не знал ничего:
  // окно уезжало под мышкой, а плагин продолжал считать, что оно на старом
  // месте. Всё, что связано с положением окон, было невозможно.
  //
  // Место берём из ЭЛЕМЕНТА, а не из модели: пока человек тянет, модель
  // отстаёт нарочно (мы двигаем сам элемент ради плавности), и без этого
  // плагин получал бы вчерашние координаты.
  const тянули = useRef(false)
  const где = () => {
    const r = app.hidden ? null : ref.current?.getBoundingClientRect()
    // Спрятанное окно меряется в нули (display: none), и записать эти нули в
    // модель значило бы сказать плагину «твоё окно схлопнулось» — при живом
    // окне, которое сейчас вернётся. Пока спрятано, отдаём то, что помним.
    const о = {
      x: Math.round(r?.left ?? app.x ?? 0), y: Math.round(r?.top ?? app.y ?? 0),
      width: Math.round(r?.width ?? app.w), height: Math.round(r?.height ?? app.h),
    }
    // Кладём измеренное в модель: у неподвинутого окна место задаёт вёрстка
    // («по центру»), и в модели там null — плагин получал бы null вместо
    // координат.
    if (r) setAppRect(app.id, { x: о.x, y: о.y, w: о.width, h: о.height })
    return о
  }
  // ОТКРЫЛОСЬ И ЗАКРЫЛОСЬ — ровно по разу на окно.
  //
  // v1.487.0: здесь была поломка, из-за которой плагин «ломался при
  // перетаскивании», — и владелец её видел, но объяснял иначе.
  //
  // В v1.485.0 место окна попало в зависимости ЭТОГО эффекта, вместе с уборкой,
  // которая шлёт open: false. React зовёт уборку перед каждым новым запуском —
  // то есть на каждое движение окна плагин получал «твоё окно ЗАКРЫЛИ», а
  // следом «открыли». Плагины на это отвечают по документации: `if (!e.open)`
  // — и останавливаются. Наша же «Змейка» так и написана: подвинул окно — игра
  // кончилась.
  //
  // Поэтому открытие и переезд разведены по разным эффектам. Уборка осталась
  // только там, где она и значит закрытие.
  useEffect(() => {
    emitToPlugin(app.pluginId, 'app', { id: app.id, mode: app.mode, open: true, ...где() })
    return () => {
      emitToPlugin(app.pluginId, 'app', { id: app.id, mode: app.mode, open: false, ...где() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, app.pluginId])

  // ПЕРЕЕЗД И РАЗМЕР. Отдельно и без уборки: окно никуда не делось.
  const первый = useRef(true)
  useEffect(() => {
    if (первый.current) { первый.current = false; return }
    // Пока окно держат рукой, кадры шлёт цикл ниже — здесь вышла бы двойня.
    if (dragging) return
    const о = где()
    emitToPlugin(app.pluginId, 'app', { id: app.id, mode: app.mode, open: true, ...о })
    emitToPlugin(app.pluginId, 'app:move', { id: app.id, mode: app.mode, ...о })
    emitToPlugin(app.pluginId, 'app:moveend', { id: app.id, mode: app.mode, ...о })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.mode, app.w, app.h, app.x, app.y, app.hidden])

  // Пока окно двигают или тянут — шлём место кадрами. Не чаще кадра: событие
  // уходит в воркер, и слать его на каждое движение мыши значит будить плагин
  // сотню раз в секунду ради того же самого.
  //
  // v1.487.0: у движения теперь СВОИ имена — 'app:move' на каждом кадре и
  // 'app:moveend' один раз, когда отпустили.
  //
  // Зачем отдельно от 'app'. То событие рассказывает обо всём сразу: открылось,
  // закрылось, сменило вид, переехало. Плагин, которому нужна только рамка под
  // мышкой, вынужден был на каждое движение разбирать «а это вообще про что» —
  // и, что хуже, не мог понять, тянут окно прямо сейчас или уже отпустили.
  // 'app' при этом никуда не делся и приходит как раньше: плагины, написанные
  // под v1.485, не ломаются.
  useEffect(() => {
    if (!dragging) {
      // Отпустили — сообщаем окончательное место. Но ТОЛЬКО если правда
      // отпустили: без этой проверки событие уходило на каждую перерисовку, и
      // плагин получал по два «открыто» на каждое окно.
      if (тянули.current) {
        тянули.current = false
        const о = где()
        emitToPlugin(app.pluginId, 'app', { id: app.id, mode: app.mode, open: true, ...о })
        emitToPlugin(app.pluginId, 'app:move', { id: app.id, mode: app.mode, ...о })
        emitToPlugin(app.pluginId, 'app:moveend', { id: app.id, mode: app.mode, ...о })
      }
      return
    }
    тянули.current = true
    let кадр = 0
    const шаг = () => {
      const о = где()
      emitToPlugin(app.pluginId, 'app', { id: app.id, mode: app.mode, open: true, ...о })
      emitToPlugin(app.pluginId, 'app:move', { id: app.id, mode: app.mode, ...о })
      кадр = requestAnimationFrame(шаг)
    }
    кадр = requestAnimationFrame(шаг)
    return () => cancelAnimationFrame(кадр)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, app.id])

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

  // v1.489.0: на телефоне окно закрывает системная «назад».
  //
  // Раньше выходов было два — крестик в шапке и Esc, — и оба исчезали разом у
  // безрамочного окна на телефоне: шапки нет, клавиатуры нет. Окно во весь
  // экран, которое нечем убрать, — это не «чисто», это ловушка; ровно на такой
  // уже ломался выход из приложения (mobileBack.ts).
  //
  // «Назад» ничего не занимает на экране и работает у ЛЮБОГО окна плагина, не
  // только у безрамочного: на телефоне это единственная кнопка, которая есть
  // всегда, и закрывать ею открытое поверх — то, чего человек и ждёт.
  useBackClose(true, () => closeAppByUser(app.id))

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
  // Спрятанное окно не убирается из разметки: холст живёт в нём, и снять его
  // значило бы показать плагину «холст пропал», а вернуть — начать заново.
  if (app.hidden) style.display = 'none'

  const классы = 'plugapp plugapp-' + app.mode
    + (dragging ? ' dragging' : '')
    + (app.frameless ? ' frameless' : '')
    + (app.transparent ? ' transparent' : '')
    + (app.smooth && !dragging ? ' smooth' : '')

  return (
    <div ref={ref} className={классы} style={style}
      // Безрамочное окно берётся за тело: шапки на виду у него нет, и без
      // этого его нельзя было бы сдвинуть вовсе.
      onPointerDown={плавает && app.frameless ? startBodyDrag : undefined}
      // Окно должно уметь принимать фокус — иначе клавиш ему не достанется
      // вовсе. Фокус ставится сам при открытии: игра обязана работать сразу, а
      // не после того, как человек догадается щёлкнуть по ней.
      tabIndex={-1}
      onKeyDown={e => клавиша(e, true)}
      onKeyUp={e => клавиша(e, false)}>
      {/* Подсказка прилипания: полупрозрачная тень там, куда встанет окно. */}
      {подсказка && <div className={'plugapp-snap ' + подсказка} />}
      {/* v1.489.0: у безрамочного окна шапки НЕТ СОВСЕМ.
          В v1.487.0 она пряталась до наведения — я боялся, что окно без подписи
          выдаст себя за приложение. Владелец решил иначе, и решение его:
          «не надо бояться, главное чтобы не было лишнего». Так что лишнего нет
          ничего: пустой прямоугольник, в котором рисует только плагин.

          ЧТО ПРИ ЭТОМ ОСТАЛОСЬ — и это не украшение, а выход:
            • Esc закрывает окно, и перехватить его плагин не может;
            • на телефоне окно закрывает системная «назад»;
            • окно видно на карточке плагина в настройках, там же «Закрыть».
          Ни одно из трёх ничего не занимает на экране. */}
      {!app.frameless && <div className={'plugapp-h' + (плавает ? ' draggable' : '')}
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
      </div>}
      <div className="plugapp-body">
        {app.html
          ? <AppFrameHtml app={app} />
          : <PanelRows pluginId={app.pluginId} rows={app.rows} />}
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
