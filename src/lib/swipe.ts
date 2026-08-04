// v1.453.0: управление свайпами на телефоне.
//
// Чего не было. Шторки (рейка серверов с каналами слева, список участников
// справа) открывались только кнопками в шапке. На телефоне это единственный
// способ переключиться между каналами — то есть самое частое действие требовало
// прицелиться в маленькую кнопку в углу. Во всех мессенджерах это делается
// движением пальца от края.
//
// Почему движение считается здесь, а не в компоненте. Отличить «свайп» от
// «прокрутки» и от «случайного дрожания» — это правило, а не разметка, и оно
// должно быть ОДНО: два места с чуть разными порогами дадут шторку, которая
// открывается через раз, и это невозможно поймать глазами.
//
// Правила, и каждое из них ради конкретной беды:
//   • начало только от края экрана — иначе свайп воевал бы с горизонтальной
//     прокруткой внутри переписки (вкладки, ряд эмодзи, карточки);
//   • движение должно быть ГОРИЗОНТАЛЬНЫМ с заметным перевесом — иначе шторка
//     открывалась бы при обычной прокрутке ленты вверх-вниз;
//   • короткое и медленное движение не считается: это дрожание руки.
//
// Настройка. Свайпы включаются в настройках (по умолчанию включены на телефоне,
// выключены на компьютере). Кому мешает — выключает, и тогда работают только
// кнопки, как раньше.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

/** Ширина полосы у края, с которой можно начать (px). */
export const SWIPE_EDGE = 28
/** Сколько надо провести, чтобы это считалось свайпом (px). */
export const SWIPE_MIN = 60
/** Во сколько раз горизонтальное движение должно перевешивать вертикальное. */
export const SWIPE_RATIO = 1.7
/** Дольше — это уже не жест, а «человек передумал и водит пальцем» (мс). */
export const SWIPE_MAX_MS = 700

export type SwipeDir = 'left' | 'right' | null

export interface SwipePoint { x: number; y: number; t: number }

/** Годится ли начало: только от левого или правого края. */
export function fromEdge(x: number, width: number, edge = SWIPE_EDGE): 'left' | 'right' | null {
  if (x <= edge) return 'left'
  if (x >= width - edge) return 'right'
  return null
}

/**
 * Что это было. null — не свайп: пусть событие достаётся тому, кому и
 * предназначалось (прокрутке, нажатию, выделению).
 */
export function swipeDir(a: SwipePoint, b: SwipePoint): SwipeDir {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dt = b.t - a.t
  if (dt > SWIPE_MAX_MS) return null
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (ax < SWIPE_MIN) return null
  // Перевес по горизонтали: иначе диагональное движение при прокрутке ленты
  // считалось бы свайпом, и шторка вылезала бы сама.
  if (ax < ay * SWIPE_RATIO) return null
  return dx > 0 ? 'right' : 'left'
}

/** Что должен сделать свайп при таком состоянии шторок.
 *
 *  Одна функция на все экраны: иначе на одном свайп вправо открывал бы каналы,
 *  а на другом закрывал участников, и человек не смог бы выучить жест. */
export type SwipeAction = 'open-nav' | 'close-nav' | 'open-members' | 'close-members' | 'none'

export function swipeAction(dir: SwipeDir, s: { navOpen: boolean; membersOpen: boolean; hasMembers: boolean }): SwipeAction {
  if (!dir) return 'none'
  if (dir === 'right') {
    // Сначала закрываем то, что открыто справа, и только потом открываем левое:
    // иначе одним движением открылись бы обе шторки сразу.
    if (s.membersOpen) return 'close-members'
    if (!s.navOpen) return 'open-nav'
    return 'none'
  }
  if (s.navOpen) return 'close-nav'
  if (s.hasMembers && !s.membersOpen) return 'open-members'
  return 'none'
}

/** Включены ли свайпы. Читаем настройку напрямую: жест вешается из мест без
 *  провайдера настроек, а флаг нужен ровно один. */
export function swipesOn(mobile: boolean): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem('ponoi_settings') || '{}')
    if (typeof raw.swipes === 'boolean') return raw.swipes
  } catch { /* приватный режим */ }
  return mobile
}
