// v1.496.0: свои ПРИЛОЖЕНИЯ прямо в Ponoi.
//
// Владелец: «добавь новое для разработчиков рядом с ботами и плагинами, а
// точнее создание своих приложений прямо в ponoi!!!»
//
// Что это и чем отличается от конструктора плагинов. Плагин — это код, который
// вписывается в само приложение: своя команда, своя кнопка, перехват сообщений.
// Приложение — это ОКНО со своей страницей: игра, редактор, инструмент. Автору
// такого окна не нужны ни события чата, ни разрешения — ему нужны html, css и
// js, и чтобы это открылось.
//
// Внутри всё то же самое: приложение собирается в обычный плагин, который
// открывает окно с html (см. htmlFrame.ts). То есть никакой второй системы
// здесь нет — есть форма, которая пишет за человека ту часть, что у всех
// одинаковая.
//
// ЗДЕСЬ ТОЛЬКО ЧИСТЫЕ ФУНКЦИИ. Сборка кода, разбор обратно, проверка имени —
// всё проверяется без единого окна (см. __test.ts).

import { parsePlugin } from './manifest'

export interface AppDraft {
  id: string
  name: string
  version: string
  author: string
  description: string
  html: string
  css: string
  js: string
  width: number
  height: number
  /** Окно без рамки и с прозрачной подложкой — для часов и накладок. */
  frameless: boolean
  transparent: boolean
  /** Какие возможности Ponoi нужны приложению. Пусто — никаких. */
  permissions: string[]
}

export const APP_DEFAULT: AppDraft = {
  id: '', name: '', version: '1.0.0', author: '', description: '',
  html: '', css: '', js: '', width: 900, height: 600,
  frameless: false, transparent: false, permissions: [],
}

/** Приложению нужно окно — без этого разрешения оно не откроется вовсе. */
export const APP_REQUIRED = 'apps'

/** Имя файла: латиница, цифры, дефис. По нему плагин узнают при обновлении. */
export function makeAppId(name: string): string {
  const t = String(name ?? '').trim().toLowerCase()
  const карта: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  }
  let out = ''
  for (const ч of t) out += карта[ч] ?? ч
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return out || 'app'
}

/**
 * Собрать страницу приложения.
 *
 * Стили и код вкладываются в саму страницу, а не подключаются файлами: у
 * страницы плагина чужое происхождение, и своих файлов по адресу она забрать не
 * может (см. htmlFrame.ts). Зато вкладывание работает везде одинаково.
 */
export function buildPage(d: Pick<AppDraft, 'html' | 'css' | 'js'>): string {
  const css = String(d.css ?? '').trim()
  const js = String(d.js ?? '').trim()
  // Закрывающий тег внутри строки кода оборвал бы <script> посреди программы —
  // и остаток кода вывалился бы на страницу текстом. Разрываем его так, как это
  // делают все, кто вкладывает код в html.
  const безопасный = js.replace(/<\/script>/gi, '<\\/script>')
  return (css ? '<style>\n' + css + '\n</style>\n' : '')
    + String(d.html ?? '')
    + (безопасный ? '\n<script>\n' + безопасный + '\n</script>' : '')
}

/** Строка ширины окна для кода — числом, а не как придётся. */
const число = (v: unknown, по: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : по
}

/**
 * Собрать готовый файл плагина из наброска приложения.
 *
 * Получается обычный .ponoi — его можно скачать, отдать другу, выложить в
 * каталог. Никакого особого вида «приложение» в системе не заводится: чем
 * меньше сущностей, тем меньше расхождений между ними.
 */
export function buildApp(d: AppDraft): string {
  const id = makeAppId(d.id || d.name)
  const права = [...new Set([APP_REQUIRED, ...(d.permissions ?? [])])].join(', ')
  const страница = buildPage(d)
  const окно = {
    mode: 'window',
    title: String(d.name || 'Приложение'),
    width: число(d.width, 900),
    height: число(d.height, 600),
    frameless: !!d.frameless,
    transparent: !!d.transparent,
  }
  return `/**
 * @name ${String(d.name || 'Моё приложение').replace(/[\r\n]+/g, ' ')}
 * @id ${id}
 * @version ${String(d.version || '1.0.0').trim()}
 * @author ${String(d.author || 'я').replace(/[\r\n]+/g, ' ')}
 * @description ${String(d.description || 'Приложение').replace(/[\r\n]+/g, ' ')}
 * @permissions ${права}
 */
// Собрано конструктором приложений Ponoi. Править можно и здесь — но тогда
// конструктор разберёт файл обратно только если шапка и вызов ниже целы.
const СТРАНИЦА = ${JSON.stringify(страница)}

function onLoad(ponoi) {
  // html передаётся ОБЯЗАТЕЛЬНО: без него окно откроется пустым.
  // Первая версия собирала страницу и забывала её отдать — окно появлялось, а
  // внутри ничего, и понять почему было нельзя: ошибок нет, плагин «работает».
  // Поймано живой проверкой, которая ищет холст внутри окна.
  return ponoi.apps.create({
${Object.entries(окно).map(([k, v]) => '    ' + k + ': ' + JSON.stringify(v)).join(',\n')},
    html: СТРАНИЦА,
  }).then(function (id) { self.__окно = id })
}
`
}


/**
 * Разобрать файл обратно в набросок — чтобы приложение можно было открыть и
 * доправить, а не переписывать с нуля.
 *
 * Возвращает null, если файл собран не здесь: чужой код мы разбирать не беремся
 * и портить его тоже.
 */
export function parseApp(code: string): AppDraft | null {
  let m
  try { m = parsePlugin(code) } catch { return null }
  const стр = /const СТРАНИЦА = ("(?:[^"\\]|\\.)*")/.exec(code)
  if (!стр) return null
  let страница = ''
  try { страница = JSON.parse(стр[1]) } catch { return null }

  const кусок = (re: RegExp) => {
    const r = re.exec(страница)
    return r ? r[1].trim() : ''
  }
  const css = кусок(/^<style>\n([\s\S]*?)\n<\/style>\n/)
  const js = кусок(/\n<script>\n([\s\S]*?)\n<\/script>$/).replace(/<\\\/script>/gi, '</script>')
  let html = страница
  if (css) html = html.replace(/^<style>\n[\s\S]*?\n<\/style>\n/, '')
  if (js) html = html.replace(/\n<script>\n[\s\S]*?\n<\/script>$/, '')

  const чис = (re: RegExp, по: number) => {
    const r = re.exec(code)
    return r ? число(r[1], по) : по
  }
  return {
    id: m.id, name: m.name, version: m.version, author: m.author, description: m.description,
    html, css, js,
    // Имена полей в собранном коде БЕЗ кавычек (так читаемее), но старые
    // файлы собирались с кавычками — принимаем оба вида, иначе приложение,
    // сделанное вчера, откроется с чужими размерами.
    width: чис(/"?width"?:\s*(\d+)/, 900),
    height: чис(/"?height"?:\s*(\d+)/, 600),
    frameless: /"?frameless"?:\s*true/.test(code),
    transparent: /"?transparent"?:\s*true/.test(code),
    permissions: (m.permissions as string[]).filter(p => p !== APP_REQUIRED),
  }
}

/** Собрано ли это конструктором приложений. */
export const isApp = (code: string): boolean => /const СТРАНИЦА = "/.test(code)

// ── Заготовки ──────────────────────────────────────────────────────────────
//
// Пустой редактор — худшее начало: человек не знает, с чего начать, и половина
// уходит на первом же экране. Каждая заготовка ЗАПУСКАЕТСЯ как есть.

export interface AppTemplate { id: string; label: string; hint: string; draft: Partial<AppDraft> }

export const APP_TEMPLATES: AppTemplate[] = [
  {
    id: 'empty', label: 'С нуля', hint: 'Пустая страница — пиши что хочешь',
    draft: {
      html: '<h1>Привет!</h1>\n<p id="что">Это моё приложение.</p>',
      css: 'body { font: 16px system-ui; padding: 20px; color: #dbdee1; background: #313338 }\nh1 { color: #5865f2 }',
      js: "document.getElementById('что').textContent = 'Работает: ' + new Date().toLocaleTimeString()",
    },
  },
  {
    id: 'canvas2d', label: 'Игра на холсте', hint: 'Кадровый цикл, мышь и клавиши',
    draft: {
      html: '',
      css: 'body { margin: 0; overflow: hidden; background: #10121a }',
      js: `const c = ponoi.canvas()
const g = c.getContext('2d')
let x = c.width / 2, y = c.height / 2, vx = 220, vy = 160
let мышь = { x: -1, y: -1 }

addEventListener('pointermove', e => { мышь.x = e.clientX * devicePixelRatio; мышь.y = e.clientY * devicePixelRatio })
addEventListener('keydown', e => { if (e.key === ' ') { vx = -vx; vy = -vy } })

ponoi.frame(dt => {
  x += vx * dt; y += vy * dt
  if (x < 20 || x > c.width - 20) vx = -vx
  if (y < 20 || y > c.height - 20) vy = -vy
  g.fillStyle = '#10121a'; g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#5865f2'
  g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.fill()
  if (мышь.x > 0) {
    g.strokeStyle = '#3ba55d'; g.beginPath(); g.moveTo(x, y); g.lineTo(мышь.x, мышь.y); g.stroke()
  }
  g.fillStyle = '#949ba4'; g.font = (14 * devicePixelRatio) + 'px system-ui'
  g.fillText('пробел — развернуть', 16 * devicePixelRatio, 28 * devicePixelRatio)
})`,
    },
  },
  {
    id: 'three', label: 'Трёхмерная сцена', hint: 'Встроенный three.js, куб и мышь',
    draft: {
      html: '',
      css: 'body { margin: 0; overflow: hidden; background: #000 }',
      js: `const THREE = await ponoi.lib('three')
const c = ponoi.canvas()
const рендер = new THREE.WebGLRenderer({ canvas: c, antialias: true })
const сцена = new THREE.Scene()
const камера = new THREE.PerspectiveCamera(60, c.width / c.height, 0.1, 100)
камера.position.set(0, 1.2, 4)

const куб = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 1.4, 1.4),
  new THREE.MeshStandardMaterial({ color: 0x5865f2, roughness: 0.35 }),
)
сцена.add(куб)
сцена.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2))
const лампа = new THREE.DirectionalLight(0xffffff, 1.5)
лампа.position.set(3, 5, 2)
сцена.add(лампа)

let повод = { x: 0, y: 0 }
addEventListener('pointermove', e => {
  повод.x = (e.clientX / innerWidth - 0.5) * 2
  повод.y = (e.clientY / innerHeight - 0.5) * 2
})

ponoi.frame(dt => {
  куб.rotation.y += dt * 0.8 + повод.x * dt * 3
  куб.rotation.x += dt * 0.3 + повод.y * dt * 3
  рендер.render(сцена, камера)
})`,
    },
  },
  {
    id: 'files', label: 'Работа с файлами', hint: 'Открыть, перетащить, сохранить',
    draft: {
      html: '<div class="панель">\n  <button id="открыть">Открыть файл</button>\n  <button id="сохранить">Сохранить</button>\n</div>\n<pre id="что">Брось сюда файл или нажми «Открыть».</pre>',
      css: 'body { font: 14px system-ui; margin: 0; padding: 16px; color: #dbdee1; background: #313338 }\n.панель { display: flex; gap: 8px; margin-bottom: 12px }\nbutton { padding: 10px 14px; border: 0; border-radius: 8px; background: #5865f2; color: #fff; font-size: 14px; cursor: pointer }\npre { white-space: pre-wrap; background: #1e1f22; padding: 12px; border-radius: 8px; min-height: 120px }',
      js: `const что = document.getElementById('что')

async function показать(файлы) {
  if (!файлы.length) return
  const f = файлы[0]
  const текст = f.size < 200000 ? (await f.text()).slice(0, 2000) : '(слишком большой, чтобы показать)'
  что.textContent = f.name + '  ' + f.size + ' байт  ' + (f.type || 'без типа') + '\\n\\n' + текст
}

document.getElementById('открыть').onclick = async () => показать(await ponoi.files.open())
document.getElementById('сохранить').onclick = () =>
  ponoi.files.save('моё.txt', что.textContent, 'text/plain')
ponoi.files.onDrop(показать)`,
    },
  },
]
