// v1.443.0: экранная клавиатура на телефоне.
//
// Что было. Приложение ничего не знало про клавиатуру. Окно на Android с
// оформлением «во весь экран» при её появлении не уменьшается — клавиатура
// просто ложится поверх. Поле ввода оказывалось под ней: человек набирал
// вслепую, а последние сообщения переписки закрывались наглухо. Прокрутка при
// этом оставалась там, где была, то есть уезжала «под клавиатуру».
//
// Как теперь. Высоту клавиатуры даёт visualViewport (это работает и в WebView
// Android, и в мобильных браузерах), она кладётся в переменную --kb, а вёрстка
// на неё опирается: поле ввода поднимается ровно на эту высоту. Тем, кто читал
// низ переписки, низ и остаётся виден — список подкручивается на ту же дельту.
//
// Порог. Мелкие изменения высоты окна — это не клавиатура, а панель браузера,
// которая появляется и прячется при прокрутке. Поднимать из-за неё поле ввода
// значило бы дёргать раскладку на каждое движение пальцем.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

/** Ниже этого считаем, что клавиатуры нет (панель браузера, вырез, округление). */
export const KB_MIN = 80

export type ViewportSnap = {
  /** window.innerHeight — полная высота окна. */
  winH: number
  /** visualViewport.height — то, что реально видно. */
  vvH: number
  /** visualViewport.offsetTop — сдвиг при «наезде» страницы вверх. */
  vvTop: number
}

/** Высота клавиатуры в пикселях. 0 — клавиатуры нет. */
export function kbInset(s: ViewportSnap): number {
  if (!s.winH || !s.vvH) return 0
  const gap = Math.round(s.winH - s.vvH - (s.vvTop || 0))
  if (!Number.isFinite(gap) || gap < KB_MIN) return 0
  // Клавиатура выше самого окна — значит замер бессмысленный (так бывает в
  // момент поворота экрана). Лучше считать, что её нет, чем сдвинуть вёрстку
  // на всю высоту экрана.
  if (gap >= s.winH) return 0
  return gap
}

/** Насколько подкрутить список, чтобы низ остался на месте.
 *  Возвращает 0, если человек читал не низ: тогда двигать его прокрутку —
 *  значит утащить его с места, которое он сам выбрал. */
export function kbScrollDelta(prev: number, next: number, nearBottom: boolean): number {
  if (!nearBottom) return 0
  const d = next - prev
  return d > 0 ? d : 0
}

let stop: (() => void) | null = null

/** Следит за клавиатурой и держит --kb в актуальном состоянии.
 *  onChange получает (высота, предыдущая высота) — этим пользуется переписка,
 *  чтобы не терять низ списка. */
export function watchKeyboard(onChange?: (px: number, prev: number) => void): () => void {
  stop?.()
  const vv = (window as any).visualViewport as VisualViewport | undefined
  const root = document.documentElement
  let cur = 0

  const apply = () => {
    const px = vv
      ? kbInset({ winH: window.innerHeight, vvH: vv.height, vvTop: vv.offsetTop })
      : 0
    if (px === cur) return
    const prev = cur
    cur = px
    root.style.setProperty('--kb', px + 'px')
    document.body.classList.toggle('kb-open', px > 0)
    onChange?.(px, prev)
  }

  apply()
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('orientationchange', apply)

  stop = () => {
    vv?.removeEventListener('resize', apply)
    vv?.removeEventListener('scroll', apply)
    window.removeEventListener('orientationchange', apply)
    root.style.setProperty('--kb', '0px')
    document.body.classList.remove('kb-open')
    stop = null
  }
  return stop
}
