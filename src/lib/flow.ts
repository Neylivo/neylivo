// v1.458.0: схема прохождения — как в Detroit, а не список строк.
//
// Что было и почему это было плохо. Прохождение показывалось списком, который
// человек ВБИВАЛ САМ. Владелец на это справедливо ругнулся: он просил систему,
// которая смотрит сама и показывает красиво.
//
// Что теперь. Данные приложение берёт из Steam — у каждой игры есть вехи
// (достижения) с названием, описанием, картинкой и отметкой «пройдено» именно у
// этого человека (см. electron/steamAchievements.cjs). Показываются они цепочкой
// узлов со связями: пройденное позади, текущее выделено, дальнейшее приглушено.
//
// Раскладка здесь и только здесь — отдельной чистой функцией. Причина простая:
// координаты узлов и линий между ними легко «поплывут» при первой же правке
// разметки, а поймать это глазами на схеме из полусотни узлов невозможно. Пусть
// лучше падает проверка.
//
// Порядок узлов. Пройденные — по времени, когда их правда прошли: это и есть
// настоящий путь человека. Остальные — как отдал Steam. Так линия слева направо
// означает «сначала было это, потом то», а не случайный порядок выдачи.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).

export interface FlowNode {
  id: string
  title: string
  desc?: string
  icon?: string
  done: boolean
  /** Когда пройдено (мс). 0 — неизвестно. */
  at?: number
}

export interface Placed extends FlowNode {
  /** Место в цепочке, с нуля. */
  step: number
  x: number
  y: number
  /** Текущая веха — первая непройденная. Она одна. */
  current: boolean
}

export interface FlowLayout {
  nodes: Placed[]
  /** Связи «откуда → куда» для линий. */
  links: { from: string; to: string }[]
  width: number
  height: number
}

/** Размеры узла и промежутки. Держим числами здесь: разметка их читает, а не
 *  выдумывает свои — иначе линии перестанут попадать в узлы. */
export const NODE_W = 190
export const NODE_H = 62
export const GAP_X = 58
export const GAP_Y = 26
export const PAD = 28

/**
 * Разложить вехи змейкой: по ряду в несколько узлов, следующий ряд обратно.
 *
 * Почему змейкой, а не одной строкой: одна строка на полсотни вех — это экран
 * шириной в двенадцать тысяч пикселей, по которому надо ехать вбок и терять из
 * виду и начало, и конец. Змейка помещается и читается сверху вниз.
 */
export function layoutFlow(list: readonly FlowNode[], perRow = 4): FlowLayout {
  const ordered = orderNodes(list)
  const curIndex = ordered.findIndex(n => !n.done)
  const nodes: Placed[] = ordered.map((n, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    // Нечётные ряды идут справа налево — тогда конец одного ряда оказывается
    // прямо над началом следующего, и связь между ними короткая.
    const c = row % 2 === 0 ? col : perRow - 1 - col
    return {
      ...n,
      step: i,
      current: i === curIndex,
      x: PAD + c * (NODE_W + GAP_X),
      y: PAD + row * (NODE_H + GAP_Y),
    }
  })
  const links = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }))
  const cols = Math.min(perRow, Math.max(nodes.length, 1))
  const rows = Math.ceil(nodes.length / perRow) || 1
  return {
    nodes,
    links,
    width: PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X,
    height: PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y,
  }
}

/** Пройденные — по времени прохождения, остальные — как пришли. */
export function orderNodes(list: readonly FlowNode[]): FlowNode[] {
  const done = list.filter(n => n.done).slice()
  const rest = list.filter(n => !n.done)
  done.sort((a, b) => (a.at || 0) - (b.at || 0))
  return [...done, ...rest]
}

/** Точки, между которыми рисуется линия: от правого края одного узла к левому
 *  краю другого — или наоборот, если ряд идёт справа налево. */
export function linkPath(a: Placed, b: Placed): { x1: number; y1: number; x2: number; y2: number } {
  const сверхуВниз = a.y !== b.y
  if (сверхуВниз) {
    // Переход на новый ряд — линия идёт вниз от середины низа к середине верха.
    return { x1: a.x + NODE_W / 2, y1: a.y + NODE_H, x2: b.x + NODE_W / 2, y2: b.y }
  }
  const слеваНаправо = b.x > a.x
  return слеваНаправо
    ? { x1: a.x + NODE_W, y1: a.y + NODE_H / 2, x2: b.x, y2: b.y + NODE_H / 2 }
    : { x1: a.x, y1: a.y + NODE_H / 2, x2: b.x + NODE_W, y2: b.y + NODE_H / 2 }
}

/** Сколько пройдено. Считает то же, что показывает полоса и что уходит друзьям. */
export function flowProgress(list: readonly FlowNode[]): { done: number; total: number; pct: number } {
  const total = list.length
  const done = list.filter(n => n.done).length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}
