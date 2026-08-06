// v1.497.0: мастерская приложений — проект из многих файлов.
//
// Владелец: «сделай создание приложения отдельным окном рядом с ботами и
// плагинами, чтобы был гигантский отдел, где можно хоть 3д игру создать в нашем
// редакторе наподобие Unity».
//
// Что изменилось против v1.496.0. Там было три поля: разметка, стили, код. Для
// пробы этого хватает, для игры — нет: у игры есть сцена, управление, физика,
// загрузка моделей, и всё это в одном поле превращается в простыню, где ничего
// не найти. Здесь проект — это СПИСОК ФАЙЛОВ, как в любом редакторе.
//
// Как это собирается в страницу. Стили идут первыми, потом разметка, потом код
// — каждый файл отдельным тегом, В ТОМ ЖЕ ПОРЯДКЕ, что в списке. Порядок важен:
// библиотека должна выполниться раньше того, кто её зовёт, и человек управляет
// этим, переставляя файлы.
//
// Почему не сборщик с import. У страницы плагина чужое происхождение, и модуль
// по blob-адресу браузер грузить отказывается (замерено, см. htmlFrame.ts).
// Настоящий сборщик внутри приложения — это ещё мегабайты и своя вселенная
// ошибок. Порядок файлов решает ту же задачу и понятен без объяснений.
//
// Проверки: src/lib/plugins/__test.ts.

import { parsePlugin } from './manifest'

export type FileKind = 'html' | 'css' | 'js'

export interface ProjFile {
  name: string
  kind: FileKind
  text: string
}

export interface Project {
  id: string
  name: string
  version: string
  author: string
  description: string
  files: ProjFile[]
  width: number
  height: number
  frameless: boolean
  transparent: boolean
  permissions: string[]
}

export const PROJ_REQUIRED = 'apps'

export function kindOf(name: string): FileKind {
  const n = String(name ?? '').toLowerCase()
  if (n.endsWith('.css')) return 'css'
  if (n.endsWith('.html') || n.endsWith('.htm')) return 'html'
  return 'js'
}

/**
 * Имя файла. Свободное, но без того, что ломает список: пустого и повторов.
 *
 * Кириллицу разрешаем: это имя файла в СВОЁМ проекте, и «сцена.js» здесь ничем
 * не хуже «scene.js». Этот же выбор сделан у таблиц и файлов плагина.
 */
export function okFileName(raw: unknown, занятые: string[] = []): string {
  const s = String(raw ?? '').trim().replace(/[\u0000-\u001f\u007f/\\]/g, '')
  if (!s) throw new Error('У файла должно быть имя')
  if (занятые.includes(s)) throw new Error(`Файл «${s}» уже есть`)
  return s
}

/**
 * Собрать страницу из файлов проекта.
 *
 * Каждый файл — отдельным тегом, а не склейкой в один: тогда ошибка в одном
 * файле не уносит с собой остальные, и в сообщении браузера видно, где именно
 * она случилась.
 */
export function buildPage(files: ProjFile[]): string {
  const куски: string[] = []
  for (const f of files) {
    if (f.kind === 'css' && f.text.trim()) куски.push('<style>\n' + f.text + '\n</style>')
  }
  for (const f of files) {
    if (f.kind === 'html' && f.text.trim()) куски.push(f.text)
  }
  for (const f of files) {
    if (f.kind !== 'js' || !f.text.trim()) continue
    // Каждый файл — в СВОЕЙ асинхронной обёртке.
    //
    // Зачем. Почти всё в этом деле начинается с ожидания: библиотека, модель,
    // звук. В обычном теге script «await» на верхнем уровне — синтаксическая
    // ошибка, и заготовка «3D-игра» падала на первой же строке: «await is only
    // valid in async functions». Автор при этом видит пустое окно и не понимает,
    // что не так, — код-то правильный.
    //
    // Что из этого следует для автора: объявленное в файле живёт в этом файле.
    // Поделиться между файлами — через window. Об этом сказано и в подсказке
    // рядом с редактором, и в инструкции.
    //
    // Закрывающий тег внутри строки оборвал бы script посреди программы.
    const тело = f.text.replace(/<\/script>/gi, '<\\/script>')
    const жалоба = JSON.stringify('Ошибка в ' + f.name + ': ')
    куски.push('<script>\n;(async () => {\n' + тело
      + '\n})().catch(e => { console.error(' + жалоба + ' + ((e && e.message) || e)); throw e })\n</script>')
  }
  return куски.join('\n')
}

const число = (v: unknown, по: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : по
}

/** Имя файла плагина из названия проекта. */
export function projId(name: string): string {
  const карта: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  }
  let out = ''
  for (const ч of String(name ?? '').trim().toLowerCase()) out += карта[ч] ?? ч
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return out || 'app'
}

/**
 * Собрать проект в обычный плагин.
 *
 * Файлы сохраняются В КОДЕ, а не только собранная страница: иначе открыть
 * проект обратно можно было бы только одной простынёй, и разбиение на файлы
 * терялось бы при первом же сохранении.
 */
export function buildProject(p: Project): string {
  const id = projId(p.id || p.name)
  const права = [...new Set([PROJ_REQUIRED, ...(p.permissions ?? [])])].join(', ')
  const окно = {
    mode: 'window',
    title: String(p.name || 'Приложение'),
    width: число(p.width, 960),
    height: число(p.height, 640),
    frameless: !!p.frameless,
    transparent: !!p.transparent,
  }
  const строка = (s: string) => String(s ?? '').replace(/[\r\n]+/g, ' ')
  return `/**
 * @name ${строка(p.name || 'Моё приложение')}
 * @id ${id}
 * @version ${String(p.version || '1.0.0').trim()}
 * @author ${строка(p.author || 'я')}
 * @description ${строка(p.description || 'Приложение')}
 * @permissions ${права}
 */
// Собрано мастерской приложений Ponoi.
//
// ФАЙЛЫ — источник правды: по ним собирается страница, и по ним же мастерская
// открывает проект обратно. Правь их здесь или там, но не собранную страницу:
// её перезапишет следующее сохранение.
const ФАЙЛЫ = ${JSON.stringify(p.files, null, 2)}

const СТРАНИЦА = ${JSON.stringify(buildPage(p.files))}

function onLoad(ponoi) {
  return ponoi.apps.create({
${Object.entries(окно).map(([k, v]) => '    ' + k + ': ' + JSON.stringify(v)).join(',\n')},
    html: СТРАНИЦА,
  }).then(function (id) { self.__окно = id })
}
`
}

/** Разобрать плагин обратно в проект. Чужой код не трогаем. */
export function parseProject(code: string): Project | null {
  let m
  try { m = parsePlugin(code) } catch { return null }
  const i = code.indexOf('const ФАЙЛЫ = ')
  if (i < 0) return null
  const j = code.indexOf('\n\nconst СТРАНИЦА', i)
  if (j < 0) return null
  let files: ProjFile[]
  try { files = JSON.parse(code.slice(i + 'const ФАЙЛЫ = '.length, j)) } catch { return null }
  if (!Array.isArray(files) || !files.length) return null

  const чис = (re: RegExp, по: number) => {
    const r = re.exec(code)
    return r ? число(r[1], по) : по
  }
  return {
    id: m.id, name: m.name, version: m.version, author: m.author, description: m.description,
    files: files.map(f => ({ name: String(f.name), kind: kindOf(f.name), text: String(f.text ?? '') })),
    width: чис(/"?width"?:\s*(\d+)/, 960),
    height: чис(/"?height"?:\s*(\d+)/, 640),
    frameless: /"?frameless"?:\s*true/.test(code),
    transparent: /"?transparent"?:\s*true/.test(code),
    permissions: (m.permissions as string[]).filter(x => x !== PROJ_REQUIRED),
  }
}

export const isProject = (code: string): boolean => code.includes('const ФАЙЛЫ = ')

/**
 * Старые приложения (v1.496.0) — из трёх полей.
 *
 * Их надо уметь открыть: человек мог собрать что-то вчера, и «твой проект
 * больше не открывается» — худшее, что можно сделать с редактором.
 */
export function fromOldApp(code: string): Project | null {
  let m
  try { m = parsePlugin(code) } catch { return null }
  const стр = /const СТРАНИЦА = ("(?:[^"\\]|\\.)*")/.exec(code)
  if (!стр) return null
  let страница = ''
  try { страница = JSON.parse(стр[1]) } catch { return null }
  const css = (/^<style>\n([\s\S]*?)\n<\/style>\n/.exec(страница) ?? [])[1] ?? ''
  const js = ((/\n<script>\n([\s\S]*?)\n<\/script>$/.exec(страница) ?? [])[1] ?? '')
    .replace(/<\\\/script>/gi, '</script>')
  let html = страница
  if (css) html = html.replace(/^<style>\n[\s\S]*?\n<\/style>\n/, '')
  if (js) html = html.replace(/\n<script>\n[\s\S]*?\n<\/script>$/, '')
  return {
    id: m.id, name: m.name, version: m.version, author: m.author, description: m.description,
    files: [
      { name: 'страница.html', kind: 'html', text: html },
      { name: 'стили.css', kind: 'css', text: css },
      { name: 'код.js', kind: 'js', text: js },
    ],
    width: 960, height: 640, frameless: false, transparent: false,
    permissions: (m.permissions as string[]).filter(x => x !== PROJ_REQUIRED),
  }
}

// ── Заготовки ──────────────────────────────────────────────────────────────

export interface ProjTemplate { id: string; label: string; hint: string; files: ProjFile[]; big?: boolean }

const ИГРА_3D = `// Трёхмерная сцена на встроенном three.js.
// Мышью — осмотреться, WASD — ходить, колесо — приблизить.
const THREE = await ponoi.lib('three')

const холст = ponoi.canvas()
const рендер = new THREE.WebGLRenderer({ canvas: холст, antialias: true })
рендер.shadowMap.enabled = true

const сцена = new THREE.Scene()
сцена.background = new THREE.Color(0x0e1116)
сцена.fog = new THREE.Fog(0x0e1116, 18, 60)

const камера = new THREE.PerspectiveCamera(70, холст.width / холст.height, 0.1, 200)
камера.position.set(0, 1.7, 6)

// Свет
сцена.add(new THREE.HemisphereLight(0x9fb8ff, 0x101418, 1.1))
const солнце = new THREE.DirectionalLight(0xffffff, 2)
солнце.position.set(8, 14, 6)
солнце.castShadow = true
сцена.add(солнце)

// Пол
const пол = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.95 }),
)
пол.rotation.x = -Math.PI / 2
пол.receiveShadow = true
сцена.add(пол)

// Кубы
const кубы = []
for (let i = 0; i < 40; i++) {
  const к = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1 + Math.random() * 3, 1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.55, 0.55) }),
  )
  к.position.set((Math.random() - 0.5) * 40, к.geometry.parameters.height / 2, (Math.random() - 0.5) * 40)
  к.castShadow = true
  сцена.add(к)
  кубы.push(к)
}

// Управление
const клавиши = {}
addEventListener('keydown', e => { клавиши[e.code] = true })
addEventListener('keyup', e => { клавиши[e.code] = false })

let рыскание = 0, тангаж = 0
холст.addEventListener('click', () => ponoi.cursor.lock(холст))
addEventListener('pointermove', e => {
  if (!ponoi.cursor.locked()) return
  рыскание -= e.movementX * 0.0022
  тангаж = Math.max(-1.3, Math.min(1.3, тангаж - e.movementY * 0.0022))
})
addEventListener('wheel', e => {
  камера.fov = Math.max(30, Math.min(100, камера.fov + Math.sign(e.deltaY) * 3))
  камера.updateProjectionMatrix()
})

ponoi.frame(dt => {
  const скорость = (клавиши.ShiftLeft ? 12 : 5) * dt
  const вперёд = new THREE.Vector3(-Math.sin(рыскание), 0, -Math.cos(рыскание))
  const вбок = new THREE.Vector3(Math.cos(рыскание), 0, -Math.sin(рыскание))
  if (клавиши.KeyW) камера.position.addScaledVector(вперёд, скорость)
  if (клавиши.KeyS) камера.position.addScaledVector(вперёд, -скорость)
  if (клавиши.KeyD) камера.position.addScaledVector(вбок, скорость)
  if (клавиши.KeyA) камера.position.addScaledVector(вбок, -скорость)
  камера.rotation.set(тангаж, рыскание, 0, 'YXZ')

  for (const к of кубы) к.rotation.y += dt * 0.2

  рендер.render(сцена, камера)
})

ponoi.log('Сцена готова: щёлкни по окну и оглядись мышью, ходи на WASD')`

export const PROJ_TEMPLATES: ProjTemplate[] = [
  {
    id: 'empty', label: 'С нуля', hint: 'Пустой проект',
    files: [
      { name: 'страница.html', kind: 'html', text: '<h1>Привет!</h1>\n<p id="что">Это моё приложение.</p>' },
      { name: 'стили.css', kind: 'css', text: 'body { font: 16px system-ui; padding: 20px; color: #dbdee1; background: #313338 }\nh1 { color: #5865f2 }' },
      { name: 'код.js', kind: 'js', text: "document.getElementById('что').textContent = 'Работает: ' + new Date().toLocaleTimeString()" },
    ],
  },
  {
    id: 'game3d', label: '3D-игра', hint: 'Сцена, свет, тени, ходьба на WASD и мышь', big: true,
    files: [
      { name: 'стили.css', kind: 'css', text: 'body { margin: 0; overflow: hidden; background: #0e1116; cursor: crosshair }' },
      { name: 'игра.js', kind: 'js', text: ИГРА_3D },
    ],
  },
  {
    id: 'canvas2d', label: 'Игра на холсте', hint: 'Кадровый цикл, мышь и клавиши',
    files: [
      { name: 'стили.css', kind: 'css', text: 'body { margin: 0; overflow: hidden; background: #10121a }' },
      {
        name: 'игра.js', kind: 'js', text: `const c = ponoi.canvas()
const g = c.getContext('2d')
let x = c.width / 2, y = c.height / 2, vx = 220, vy = 160

addEventListener('keydown', e => { if (e.key === ' ') { vx = -vx; vy = -vy } })

ponoi.frame(dt => {
  x += vx * dt; y += vy * dt
  if (x < 20 || x > c.width - 20) vx = -vx
  if (y < 20 || y > c.height - 20) vy = -vy
  g.fillStyle = '#10121a'; g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#5865f2'
  g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.fill()
})`,
      },
    ],
  },
  {
    id: 'files', label: 'Работа с файлами', hint: 'Открыть, перетащить, сохранить',
    files: [
      { name: 'страница.html', kind: 'html', text: '<div class="панель">\n  <button id="открыть">Открыть файл</button>\n  <button id="сохранить">Сохранить</button>\n</div>\n<pre id="что">Брось сюда файл или нажми «Открыть».</pre>' },
      { name: 'стили.css', kind: 'css', text: 'body { font: 14px system-ui; margin: 0; padding: 16px; color: #dbdee1; background: #313338 }\n.панель { display: flex; gap: 8px; margin-bottom: 12px }\nbutton { padding: 10px 14px; border: 0; border-radius: 8px; background: #5865f2; color: #fff; cursor: pointer }\npre { white-space: pre-wrap; background: #1e1f22; padding: 12px; border-radius: 8px; min-height: 120px }' },
      {
        name: 'код.js', kind: 'js', text: `const что = document.getElementById('что')

async function показать(файлы) {
  if (!файлы.length) return
  const f = файлы[0]
  const текст = f.size < 200000 ? (await f.text()).slice(0, 2000) : '(слишком большой)'
  что.textContent = f.name + '  ' + f.size + ' байт\\n\\n' + текст
}

document.getElementById('открыть').onclick = async () => показать(await ponoi.files.open())
document.getElementById('сохранить').onclick = () => ponoi.files.save('моё.txt', что.textContent, 'text/plain')
ponoi.files.onDrop(показать)`,
      },
    ],
  },
]
