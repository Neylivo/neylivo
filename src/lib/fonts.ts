// v1.530.0: выбранный шрифт работает НА ЛЮБОМ устройстве.
//
// Владелец: «проблема с классическим английским шрифтом на телефонах».
//
// ЧТО БЫЛО. В наборе шрифтов (ник, сообщения, названия каналов) лежали имена
// системных шрифтов: Georgia, Open Sans, Comic Sans MS, JetBrains Mono, Roboto.
// На Windows часть из них есть — и выбор работает. На Android нет ни Georgia,
// ни Open Sans, ни Comic Sans, ни JetBrains Mono: браузер молча подставляет
// обычный шрифт. Человек выбирает «классический», сохраняет, видит на
// компьютере — а на телефоне ничего не меняется, и понять почему нельзя.
//
// Проверено замером на этой машине: Georgia, Open Sans и Comic Sans есть,
// Roboto и JetBrains Mono — нет. На Android ровно наоборот: есть Roboto.
//
// ЧТО ТЕПЕРЬ. Шрифты лежат В САМОМ ПРИЛОЖЕНИИ и подгружаются, когда их
// выбрали: засечковый (PT Serif — с кириллицей), моноширинный (JetBrains Mono)
// и округлый (Comic Neue) вместо Comic Sans. Выбор работает одинаково всюду, и
// человеку не надо знать, что такое «системный шрифт».
//
// ПОЧЕМУ ЛЕНИВО. Три шрифта с кириллицей — это сотни килобайт. Класть их в
// стартовую загрузку ради того, что выбирают единицы, нельзя: у нас потолок
// на вес запуска, и он не для красоты (см. scripts/smoke.cjs). Файл шрифта
// приезжает ровно тогда, когда его выбрали, и остаётся в кэше.
//
// Проверки: src/lib/__ui_test.ts (набор и разбор) и npm run smoke (вес старта).

export interface FontPreset {
  /** Что писать в CSS font-family. */
  id: string
  /** Как называется для человека. */
  name: string
  /** Шрифт лежит у нас и приедет сам. Иначе — надежда на систему. */
  bundled?: boolean
}

/**
 * Набор на выбор.
 *
 * Системных имён здесь больше нет — кроме «Системного», который и означает
 * «какой на устройстве». Всё остальное приложение приносит с собой.
 */
export const FONT_PRESETS: FontPreset[] = [
  { id: '', name: 'Системный' },
  { id: "'Inter', sans-serif", name: 'Inter', bundled: true },
  { id: "'PT Serif', Georgia, serif", name: 'Классический', bundled: true },
  { id: "'JetBrains Mono', monospace", name: 'Моноширинный', bundled: true },
  { id: "'Comic Neue', 'Comic Sans MS', cursive", name: 'Округлый', bundled: true },
]

/** Что грузить для каждого шрифта. Ключ — начало строки font-family. */
const ЗАГРУЗЧИКИ: [string, () => Promise<unknown>][] = [
  ["'PT Serif'", () => Promise.all([
    import('@fontsource/pt-serif/cyrillic-400.css'),
    import('@fontsource/pt-serif/cyrillic-700.css'),
    import('@fontsource/pt-serif/latin-400.css'),
    import('@fontsource/pt-serif/latin-700.css'),
  ])],
  ["'JetBrains Mono'", () => Promise.all([
    import('@fontsource/jetbrains-mono/cyrillic-400.css'),
    import('@fontsource/jetbrains-mono/latin-400.css'),
    import('@fontsource/jetbrains-mono/latin-700.css'),
  ])],
  ["'Comic Neue'", () => Promise.all([
    import('@fontsource/comic-neue/latin-400.css'),
    import('@fontsource/comic-neue/latin-700.css'),
  ])],
]

const ужеГрузили = new Set<string>()

/**
 * Подтянуть файл шрифта, если он наш и ещё не подтянут.
 *
 * Зовётся везде, где шрифт ПОКАЗЫВАЕТСЯ, а не только там, где выбирается:
 * чужой ник может быть написан шрифтом, который я сам никогда не выбирал, и
 * без загрузки он показался бы обычным — то есть чужая настройка молча
 * пропала бы.
 */
export function ensureFont(family: string | null | undefined): void {
  const f = String(family || '')
  if (!f) return
  for (const [ключ, грузить] of ЗАГРУЗЧИКИ) {
    if (!f.includes(ключ) || ужеГрузили.has(ключ)) continue
    ужеГрузили.add(ключ)
    void грузить().catch(() => { ужеГрузили.delete(ключ) })
  }
}

/**
 * Есть ли этот шрифт на устройстве прямо сейчас.
 *
 * Приём общий: рисуем строку выбранным шрифтом и запасным, сравниваем ширину.
 * Совпала — значит шрифта нет и его подменили. Нужно для честной подписи в
 * настройках: «этого шрифта на устройстве нет».
 */
export function fontAvailable(family: string, measure?: (f: string) => number): boolean {
  const f = String(family || '').trim()
  if (!f) return true
  const мера = measure ?? браузерМера
  if (!мера) return true
  const имя = f.split(',')[0].trim()
  const запас = f.includes('serif') && !f.includes('sans-serif') ? 'serif'
    : f.includes('monospace') ? 'monospace' : 'sans-serif'
  const своя = мера(имя + ', ' + запас)
  const обычная = мера(запас)
  return Math.abs(своя - обычная) > 0.5
}

const браузерМера: ((f: string) => number) | null = (() => {
  if (typeof document === 'undefined') return null
  let ctx: CanvasRenderingContext2D | null = null
  return (f: string) => {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return 0
    ctx.font = '32px ' + f
    return ctx.measureText('NeyLivo mmmmiiiil WXYZ 123').width
  }
})()
