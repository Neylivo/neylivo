// v1.492.0: складываем встроенные библиотеки в исходник приложения.
//
// Зачем не просто импортировать их. Библиотеку надо отдать СТРАНИЦЕ плагина, а
// она живёт в песочнице с чужим происхождением: ни импортировать оттуда наш
// модуль, ни скачать наш файл она не может. Значит, приложению нужен ТЕКСТ
// библиотеки, который оно передаст в страницу через мост.
//
// Почему генератор, а не `import ... from 'three?raw'`. Такой ввоз понимает
// сборщик приложения (Vite), но не понимают ни esbuild, которым собираются
// проверки, ни Node. Одна строка ради удобства сломала бы половину проверок, а
// чинить их пришлось бы обходными путями в четырёх местах. Сгенерированный файл
// понимают все и одинаково.
//
// Запуск: npm run gen-libs (входит в prebuild). Файл в репозитории — иначе
// сборка зависела бы от того, что кто-то не забыл его собрать.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Что складываем.
 *
 * global — под каким именем библиотека появится на странице. Для модулей с
 * `export {…}` оно собирается автоматически (см. withGlobal в libs.ts): внутри
 * того же модуля все её значения доступны по локальным именам, и мы просто
 * дописываем присваивание в window.
 */
const БИБЛИОТЕКИ = [
  {
    id: 'three',
    пакет: 'three',
    global: 'THREE',
    описание: 'Трёхмерная графика: сцены, камеры, материалы, загрузчики моделей',
    тип: 'module',
  },
]

const куски = []
const опись = []
const ВРЕМЕННО = join(КОРЕНЬ, 'node_modules/.ponoi-libs')
mkdirSync(ВРЕМЕННО, { recursive: true })

for (const b of БИБЛИОТЕКИ) {
  // Собираем библиотеку В ОДИН ФАЙЛ сами.
  //
  // Готовые сборки для этого не годятся: three до r170 отдавал один
  // самодостаточный three.module.min.js, а с r183 он начинается с
  // «import{...} from ...» — то есть без своих соседних файлов не работает.
  // Вставить такой в страницу нельзя, и «библиотека не выполнилась» было
  // единственным, что об этом говорило. Сборка своими руками не зависит от
  // того, как пакет решил разложиться в этот раз, и годится для ЛЮБОГО пакета.
  const цель = join(ВРЕМЕННО, b.id + '.js')
  const вход = join(ВРЕМЕННО, b.id + '.entry.js')
  writeFileSync(вход, 'export * from ' + JSON.stringify(b.пакет) + ';')
  try {
    execFileSync(process.execPath, [
      join(КОРЕНЬ, 'node_modules/esbuild/bin/esbuild'),
      вход, '--bundle', '--format=esm', '--minify', '--platform=browser',
      '--outfile=' + цель,
    ], { stdio: 'pipe' })
  } catch (e) {
    console.error('[gen-libs] не собрался ' + b.id + ': '
      + String(e.stderr ?? e.message).slice(0, 400))
    process.exit(1)
  }
  const src = readFileSync(цель, 'utf8')
  const имя = 'СЫРЬЁ_' + b.id.toUpperCase()
  куски.push('const ' + имя + ' = ' + JSON.stringify(src))
  опись.push('  { id: ' + JSON.stringify(b.id)
    + ', global: ' + JSON.stringify(b.global)
    + ', kind: ' + JSON.stringify(b.тип)
    + ', about: ' + JSON.stringify(b.описание)
    + ', src: ' + имя + ' },')
  console.log('[gen-libs] ' + b.id + ': ' + Math.round(src.length / 1024) + ' КБ')
}
rmSync(ВРЕМЕННО, { recursive: true, force: true })

const out = `// СГЕНЕРИРОВАНО scripts/gen-libs.mjs — не править руками.
//
// Здесь лежит ИСХОДНЫЙ ТЕКСТ встроенных библиотек. Он нужен именно текстом:
// страница плагина живёт в песочнице с чужим происхождением и не может ни
// импортировать наш модуль, ни скачать наш файл. Приложение передаёт ей текст
// через мост, она выполняет его у себя.
//
// Файл грузится ТОЛЬКО по запросу плагина (см. libs.ts): у человека без
// плагинов-игр он не нужен вовсе.

export interface ВстроеннаяБиблиотека {
  id: string
  global: string
  kind: 'module' | 'script'
  about: string
  src: string
}

${куски.join('\n\n')}

export const ВСТРОЕННЫЕ: ВстроеннаяБиблиотека[] = [
${опись.join('\n')}
]
`

mkdirSync(join(КОРЕНЬ, 'src/lib/plugins'), { recursive: true })
writeFileSync(join(КОРЕНЬ, 'src/lib/plugins/libsData.ts'), out)
console.log('[gen-libs] записано: src/lib/plugins/libsData.ts, '
  + Math.round(out.length / 1024) + ' КБ')
