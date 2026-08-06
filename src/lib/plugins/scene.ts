// v1.498.0: сцена как ДАННЫЕ, а не как код.
//
// Владелец: «сделай мастерскую именно удобно, не рандомные кубики туда-сюда без
// объяснения, буквально Unity в Ponoi».
//
// Что было не так в v1.497.0. Была заготовка «3D-игра» — сорок кубов, брошенных
// случайно, и текстовый редактор рядом. Чтобы поставить свой куб, надо было
// понять чужой код и дописать строчку. Это не редактор сцены, это пример.
//
// ЧТО ЗДЕСЬ. Сцена — список объектов с полями: где стоит, как повёрнут, какого
// цвета. Её видно списком, её правят полями, а рисует её ОДИН И ТОТ ЖЕ код —
// и в редакторе, и в готовой игре. Это главное решение всего файла: если бы
// редактор рисовал одно, а игра другое, они разошлись бы на второй же версии, и
// «в редакторе было по-другому» стало бы обычным делом.
//
// Скрипты привязываются к объекту: onStart и onFrame. Это ровно то, как это
// устроено в Unity, и это единственное, что нужно понять новичку.
//
// Проверки: src/lib/plugins/__test.ts (чистая часть) и живая в __api_test.tsx.

export type NodeKind = 'box' | 'sphere' | 'plane' | 'cylinder' | 'light' | 'empty'

export interface SceneNode {
  id: string
  name: string
  kind: NodeKind
  pos: [number, number, number]
  rot: [number, number, number]
  scale: [number, number, number]
  color: string
  /** Насколько блестит: 0 — матовый, 1 — зеркало. Для света — яркость. */
  shine: number
  visible: boolean
  /** Код объекта: onStart и onFrame. Пусто — объект просто стоит. */
  script: string
}

export interface Scene {
  nodes: SceneNode[]
  /** Цвет неба. */
  sky: string
  /** Общая подсветка, чтобы тени не были угольными. */
  ambient: number
  /** Где стоит камера в игре и куда смотрит. */
  camera: { pos: [number, number, number]; look: [number, number, number]; fov: number }
  /** Ходить ли по сцене на WASD и осматриваться мышью. */
  fly: boolean
  /** Тени. Дороже, но без них сцена плоская. */
  shadows: boolean
}

export const KIND_LABEL: Record<NodeKind, string> = {
  box: 'Куб', sphere: 'Шар', plane: 'Плоскость', cylinder: 'Цилиндр',
  light: 'Свет', empty: 'Пустышка',
}

let счёт = 0
export function newId(): string {
  счёт++
  return 'n' + Date.now().toString(36) + '-' + счёт
}

/** Новый объект с разумными значениями — чтобы он сразу был виден. */
export function makeNode(kind: NodeKind, имя?: string): SceneNode {
  const общее = {
    id: newId(),
    name: имя || KIND_LABEL[kind],
    kind,
    rot: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    visible: true,
    script: '',
  }
  switch (kind) {
    case 'light':
      // Свет ставим ВЫСОКО и в стороне: поставленный в начало координат, он
      // светит изнутри пола и сцена выглядит сломанной.
      return { ...общее, pos: [4, 6, 3], color: '#ffffff', shine: 2 }
    case 'plane':
      return { ...общее, pos: [0, 0, 0], scale: [10, 1, 10], color: '#2a2f3a', shine: 0.1 }
    default:
      // Над полом, а не в нём: объект, наполовину утонувший в полу, читается
      // как ошибка редактора.
      return { ...общее, pos: [0, 1, 0], color: '#5865f2', shine: 0.4 }
  }
}

export function emptyScene(): Scene {
  const пол = makeNode('plane', 'Пол')
  const свет = makeNode('light', 'Солнце')
  const куб = makeNode('box', 'Куб')
  return {
    nodes: [пол, свет, куб],
    sky: '#0e1116',
    ambient: 0.6,
    camera: { pos: [4, 3, 7], look: [0, 1, 0], fov: 60 },
    fly: true,
    shadows: true,
  }
}

/** Число из поля ввода: мусор не должен ронять сцену. */
export function num(v: unknown, по = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : по
}

export function updateNode(s: Scene, id: string, patch: Partial<SceneNode>): Scene {
  return { ...s, nodes: s.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) }
}

export function addNode(s: Scene, kind: NodeKind): { scene: Scene; id: string } {
  const n = makeNode(kind)
  // Имя с номером, если такое уже есть: два «Куба» в списке не различить.
  const свои = s.nodes.filter(x => x.name === n.name || x.name.startsWith(n.name + ' ')).length
  if (свои) n.name = n.name + ' ' + (свои + 1)
  return { scene: { ...s, nodes: [...s.nodes, n] }, id: n.id }
}

export function removeNode(s: Scene, id: string): Scene {
  return { ...s, nodes: s.nodes.filter(n => n.id !== id) }
}

export function duplicateNode(s: Scene, id: string): { scene: Scene; id: string } {
  const был = s.nodes.find(n => n.id === id)
  if (был) {
    const копия: SceneNode = {
      ...был, id: newId(), name: был.name + ' копия',
      // Сдвигаем: копия ровно поверх оригинала выглядит как «ничего не
      // произошло», и человек жмёт кнопку ещё пять раз.
      pos: [был.pos[0] + 1.5, был.pos[1], был.pos[2]],
    }
    return { scene: { ...s, nodes: [...s.nodes, копия] }, id: копия.id }
  }
  return { scene: s, id }
}

/** Прочитать сцену из сохранённого. Битое и чужое молча становится пустой. */
export function readScene(raw: unknown): Scene {
  const п = emptyScene()
  if (!raw || typeof raw !== 'object') return п
  const o = raw as any
  const три = (v: unknown, по: [number, number, number]): [number, number, number] =>
    Array.isArray(v) && v.length === 3 ? [num(v[0], по[0]), num(v[1], по[1]), num(v[2], по[2])] : по
  const узлы: SceneNode[] = Array.isArray(o.nodes) ? o.nodes.map((n: any) => ({
    id: String(n?.id ?? newId()),
    name: String(n?.name ?? 'Объект'),
    kind: (KIND_LABEL as any)[n?.kind] ? n.kind : 'box',
    pos: три(n?.pos, [0, 1, 0]),
    rot: три(n?.rot, [0, 0, 0]),
    scale: три(n?.scale, [1, 1, 1]),
    color: typeof n?.color === 'string' ? n.color : '#5865f2',
    shine: num(n?.shine, 0.4),
    visible: n?.visible !== false,
    script: typeof n?.script === 'string' ? n.script : '',
  })) : п.nodes
  return {
    nodes: узлы,
    sky: typeof o.sky === 'string' ? o.sky : п.sky,
    ambient: num(o.ambient, п.ambient),
    camera: {
      pos: три(o?.camera?.pos, п.camera.pos),
      look: три(o?.camera?.look, п.camera.look),
      fov: num(o?.camera?.fov, п.camera.fov),
    },
    fly: o.fly !== false,
    shadows: o.shadows !== false,
  }
}

/**
 * ДВИЖОК СЦЕНЫ.
 *
 * Один и тот же и в редакторе, и в готовой игре — разница только в режиме:
 * в редакторе камера облетает сцену и по объекту можно щёлкнуть, в игре
 * выполняются скрипты объектов.
 *
 * Живёт строкой по той же причине, что песочница воркера и мост страницы: он
 * должен попасть внутрь целиком, без сборщика.
 *
 * ВНИМАНИЕ при правке: это шаблонная строка TypeScript. Обратная кавычка и
 * обратная косая с «n» обрывают её молча — я на этом попадался трижды. Только
 * латинские имена, никаких обратных кавычек.
 */
export const SCENE_RUNTIME = String.raw`
async function запустиСцену(данные, режим) {
  const THREE = await ponoi.lib('three')
  const холст = ponoi.canvas()
  const рендер = new THREE.WebGLRenderer({ canvas: холст, antialias: true })
  рендер.shadowMap.enabled = !!данные.shadows

  const сцена = new THREE.Scene()
  сцена.background = new THREE.Color(данные.sky || '#0e1116')

  const камера = new THREE.PerspectiveCamera(данные.camera.fov || 60,
    холст.width / холст.height, 0.1, 500)

  сцена.add(new THREE.HemisphereLight(0xffffff, 0x223044, Number(данные.ambient) || 0))

  const поId = {}
  const скрипты = []

  function собери(n) {
    let объект
    const цвет = new THREE.Color(n.color || '#ffffff')
    if (n.kind === 'light') {
      объект = new THREE.DirectionalLight(цвет, Number(n.shine) || 1)
      объект.castShadow = !!данные.shadows
      if (объект.shadow) {
        объект.shadow.mapSize.set(1024, 1024)
        объект.shadow.camera.left = -20; объект.shadow.camera.right = 20
        объект.shadow.camera.top = 20; объект.shadow.camera.bottom = -20
      }
    } else if (n.kind === 'empty') {
      объект = new THREE.Group()
    } else {
      const материал = new THREE.MeshStandardMaterial({
        color: цвет,
        roughness: 1 - Math.min(1, Math.max(0, Number(n.shine) || 0)),
        metalness: Math.min(0.9, Math.max(0, Number(n.shine) || 0) * 0.6),
      })
      let форма
      if (n.kind === 'sphere') форма = new THREE.SphereGeometry(0.6, 32, 24)
      else if (n.kind === 'plane') форма = new THREE.BoxGeometry(1, 0.08, 1)
      else if (n.kind === 'cylinder') форма = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 28)
      else форма = new THREE.BoxGeometry(1, 1, 1)
      объект = new THREE.Mesh(форма, материал)
      объект.castShadow = n.kind !== 'plane'
      объект.receiveShadow = true
    }
    объект.position.set(n.pos[0], n.pos[1], n.pos[2])
    объект.rotation.set(n.rot[0] * Math.PI / 180, n.rot[1] * Math.PI / 180, n.rot[2] * Math.PI / 180)
    объект.scale.set(n.scale[0], n.scale[1], n.scale[2])
    объект.visible = n.visible !== false
    объект.userData.id = n.id
    объект.userData.имя = n.name
    сцена.add(объект)
    поId[n.id] = объект
    return объект
  }

  for (const n of данные.nodes) собери(n)

  // ── Скрипты объектов ─────────────────────────────────────────────────────
  //
  // Только в игре. В редакторе они молчат: иначе объект уезжал бы из-под руки,
  // пока его двигают полями, и понять, где он стоит на самом деле, было бы
  // нельзя.
  if (режим === 'игра') {
    for (const n of данные.nodes) {
      if (!n.script || !n.script.trim()) continue
      try {
        const делай = new Function('это', 'сцена', 'THREE', 'ponoi',
          '"use strict";' + n.script + '\n;return { onStart: typeof onStart === "function" ? onStart : null,'
          + ' onFrame: typeof onFrame === "function" ? onFrame : null }')
        const ч = делай(поId[n.id], сцена, THREE, ponoi)
        if (ч.onStart) ч.onStart()
        if (ч.onFrame) скрипты.push({ имя: n.name, fn: ч.onFrame })
      } catch (e) {
        console.error('Ошибка в скрипте объекта ' + n.name + ': ' + ((e && e.message) || e))
      }
    }
  }

  // ── Камера ───────────────────────────────────────────────────────────────
  камера.position.set(данные.camera.pos[0], данные.camera.pos[1], данные.camera.pos[2])
  камера.lookAt(данные.camera.look[0], данные.camera.look[1], данные.camera.look[2])

  let орбита = { угол: 0.6, высота: 0.45, дальность: 9 }
  let тянут = false
  const центр = new THREE.Vector3(данные.camera.look[0], данные.camera.look[1], данные.camera.look[2])

  if (режим === 'редактор') {
    // В редакторе камера ОБЛЕТАЕТ сцену: это единственный способ понять, где
    // что стоит, а свободный полёт в редакторе требует захвата мыши, из-за
    // которого не нажать на объект.
    const начало = new THREE.Vector3(данные.camera.pos[0], данные.camera.pos[1], данные.camera.pos[2])
    орбита.дальность = Math.max(3, начало.distanceTo(центр))
    холст.addEventListener('pointerdown', e => { тянут = true; холст.setPointerCapture(e.pointerId) })
    холст.addEventListener('pointerup', e => { тянут = false; try { холст.releasePointerCapture(e.pointerId) } catch (err) {} })
    холст.addEventListener('pointermove', e => {
      if (!тянут) return
      орбита.угол -= e.movementX * 0.006
      орбита.высота = Math.max(-1.4, Math.min(1.4, орбита.высота + e.movementY * 0.006))
    })
    холст.addEventListener('wheel', e => {
      e.preventDefault()
      орбита.дальность = Math.max(1.5, Math.min(80, орбита.дальность * (1 + Math.sign(e.deltaY) * 0.12)))
    }, { passive: false })

    // Щелчок выбирает объект — и говорит об этом наружу.
    const луч = new THREE.Raycaster()
    холст.addEventListener('click', e => {
      const r = холст.getBoundingClientRect()
      const т = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1)
      луч.setFromCamera(т, камера)
      const попал = луч.intersectObjects(сцена.children, true)
      for (const п of попал) {
        let o = п.object
        while (o && !o.userData.id) o = o.parent
        if (o && o.userData.id) {
          parent.postMessage({ ponoi: 1, k: 'сцена', выбран: o.userData.id }, '*')
          return
        }
      }
      parent.postMessage({ ponoi: 1, k: 'сцена', выбран: null }, '*')
    })
  } else if (данные.fly) {
    // В игре — ходьба и осмотр, как в любой игре от первого лица.
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
    скрипты.push({ имя: '(ходьба)', fn: dt => {
      const с = (клавиши.ShiftLeft ? 12 : 5) * dt
      const вперёд = new THREE.Vector3(-Math.sin(рыскание), 0, -Math.cos(рыскание))
      const вбок = new THREE.Vector3(Math.cos(рыскание), 0, -Math.sin(рыскание))
      if (клавиши.KeyW) камера.position.addScaledVector(вперёд, с)
      if (клавиши.KeyS) камера.position.addScaledVector(вперёд, -с)
      if (клавиши.KeyD) камера.position.addScaledVector(вбок, с)
      if (клавиши.KeyA) камера.position.addScaledVector(вбок, -с)
      if (клавиши.Space) камера.position.y += с
      if (клавиши.ControlLeft) камера.position.y -= с
      камера.rotation.set(тангаж, рыскание, 0, 'YXZ')
    } })
  }

  // ── Подсветка выбранного ─────────────────────────────────────────────────
  let рамка = null
  function подсветить(id) {
    if (рамка) { сцена.remove(рамка); рамка = null }
    const о = id && поId[id]
    if (!о || о.isLight) return
    рамка = new THREE.BoxHelper(о, 0x3ba55d)
    сцена.add(рамка)
  }

  addEventListener('message', e => {
    const m = e.data
    if (!m || m.ponoi !== 1) return
    if (m.k === 'выбрать') подсветить(m.id)
  })

  ponoi.frame(dt => {
    if (режим === 'редактор') {
      камера.position.set(
        центр.x + Math.cos(орбита.угол) * Math.cos(орбита.высота) * орбита.дальность,
        центр.y + Math.sin(орбита.высота) * орбита.дальность,
        центр.z + Math.sin(орбита.угол) * Math.cos(орбита.высота) * орбита.дальность)
      камера.lookAt(центр)
      if (рамка) рамка.update()
    }
    for (const с of скрипты) {
      try { с.fn(dt) } catch (e) {
        console.error('Ошибка в скрипте ' + с.имя + ': ' + ((e && e.message) || e))
      }
    }
    рендер.render(сцена, камера)
  })

  parent.postMessage({ ponoi: 1, k: 'сцена', готово: true }, '*')
}
`

/** Страница редактора: движок плюс запуск в нужном режиме. */
export function scenePage(scene: Scene, режим: 'редактор' | 'игра'): string {
  return '<style>body{margin:0;overflow:hidden;background:' + scene.sky + '}'
    + 'canvas{display:block;width:100%;height:100%}</style>\n'
    + '<script>\n;(async () => {\n'
    + SCENE_RUNTIME + '\n'
    + 'await запустиСцену(' + JSON.stringify(scene) + ', ' + JSON.stringify(режим) + ')\n'
    + '})().catch(e => console.error("Сцена не запустилась: " + ((e && e.message) || e)))\n'
    + '</script>'
}
