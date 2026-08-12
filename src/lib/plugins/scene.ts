// v1.498.0: сцена как ДАННЫЕ, а не как код.
//
// Владелец: «сделай мастерскую именно удобно, не рандомные кубики туда-сюда без
// объяснения, буквально Unity в NeyLivo».
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

export type NodeKind = 'box' | 'sphere' | 'plane' | 'cylinder' | 'light' | 'empty' | 'model'

/**
 * Готовая модель, положенная в проект (v1.555.0).
 *
 * ЛЕЖИТ В САМОМ ПРОЕКТЕ, а не в файлах устройства (neylivo.assets). Решение
 * осознанное: приложение из мастерской сохраняется ОДНИМ файлом и этим же
 * файлом уезжает другому человеку. Модель, оставленная в хранилище устройства,
 * до него бы не доехала — он открыл бы игру без единой модели и решил, что она
 * сломана.
 *
 * Плата за это — вес: файл проекта растёт ровно на вес моделей, и место в
 * хранилище браузера кончается быстрее. Поэтому вес видно в мастерской рядом с
 * каждой моделью, и он же считается по всей сцене.
 */
export interface SceneAsset {
  id: string
  name: string
  /** glb — двоичный glTF (base64), obj — текст как есть. */
  format: 'glb' | 'obj'
  data: string
  /** Вес исходного файла в байтах — человеку на карточке. */
  bytes: number
}

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
  /** Какая модель показывается — id из scene.assets. Только для kind 'model'. */
  asset?: string
  /**
   * Вписать модель в столько метров по наибольшей стороне. 0 — как есть.
   *
   * Зачем это вообще. Модели приходят в каких угодно единицах: одна и та же
   * машина бывает ростом в 4 единицы и в 400. Без подгонки первая модель либо
   * не видна вовсе, либо занимает полнеба, и человек крутит «размер» вслепую,
   * не понимая, на какое число умножать. Считает это движок — только у него
   * есть настоящие границы загруженной модели.
   */
  fit?: number
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
  /** Модели, положенные в проект. Узлы вида 'model' ссылаются сюда по id. */
  assets: SceneAsset[]
}

export const KIND_LABEL: Record<NodeKind, string> = {
  box: 'Куб', sphere: 'Шар', plane: 'Плоскость', cylinder: 'Цилиндр',
  light: 'Свет', empty: 'Пустышка', model: 'Модель',
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
    case 'model':
      // Вписываем в 2 метра: первая же поставленная модель должна быть видна
      // целиком и стоять на полу, а не оказаться точкой или стеной до неба.
      return { ...общее, pos: [0, 0, 0], color: '#ffffff', shine: 0.4, fit: 2 }
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
    assets: [],
  }
}

// ── Модели ─────────────────────────────────────────────────────────────────

/** Сколько весит проект: сумма моделей. Всё остальное рядом с ними — пыль. */
export function sceneBytes(s: Scene): number {
  return (s.assets ?? []).reduce((n, a) => n + (a.bytes || a.data.length), 0)
}

/** «1,4 МБ» — число без подписи человеку ничего не говорит. */
export function fmtBytes(n: number): string {
  if (n < 1024) return n + ' Б'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ'
  return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ'
}

/**
 * Положить модель в проект и поставить её в сцену.
 *
 * Одна модель — один раз: если тот же файл добавляют второй раз, ставится
 * ссылка на уже лежащую. Иначе десять деревьев в лесу весили бы как десять
 * файлов, хотя дерево одно.
 */
export function addModel(
  s: Scene, файл: { name: string; format: 'glb' | 'obj'; data: string; bytes: number },
): { scene: Scene; id: string } {
  const был = (s.assets ?? []).find(a => a.data === файл.data)
  const asset: SceneAsset = был ?? {
    id: 'a' + Date.now().toString(36) + '-' + (счёт + 1),
    name: файл.name, format: файл.format, data: файл.data, bytes: файл.bytes,
  }
  const узел = makeNode('model', файл.name.replace(/\.(glb|gltf|obj)$/i, ''))
  узел.asset = asset.id
  const свои = s.nodes.filter(x => x.name === узел.name || x.name.startsWith(узел.name + ' ')).length
  if (свои) узел.name = узел.name + ' ' + (свои + 1)
  return {
    scene: {
      ...s,
      assets: был ? s.assets : [...(s.assets ?? []), asset],
      nodes: [...s.nodes, узел],
    },
    id: узел.id,
  }
}

/**
 * Выбросить модели, на которые никто не смотрит.
 *
 * Удалённый объект уносит с собой только себя — файл модели остаётся лежать в
 * проекте и весить. Чистка идёт при сохранении: делать её на каждое удаление
 * значило бы терять файл от одного неверного нажатия, а «отменить» здесь нет.
 */
export function pruneAssets(s: Scene): Scene {
  const нужные = new Set(s.nodes.filter(n => n.kind === 'model' && n.asset).map(n => n.asset))
  const оставить = (s.assets ?? []).filter(a => нужные.has(a.id))
  return оставить.length === (s.assets ?? []).length ? s : { ...s, assets: оставить }
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
    asset: typeof n?.asset === 'string' ? n.asset : undefined,
    fit: n?.fit === undefined ? undefined : num(n.fit, 0),
  })) : п.nodes
  const модели: SceneAsset[] = Array.isArray(o.assets) ? o.assets
    // Битую модель молча пропускаем, а не роняем всю сцену: одна испорченная
    // запись не должна стоить человеку всего проекта.
    .filter((a: any) => a && typeof a.id === 'string' && typeof a.data === 'string')
    .map((a: any) => ({
      id: String(a.id),
      name: String(a.name ?? 'модель'),
      format: a.format === 'obj' ? 'obj' : 'glb',
      data: String(a.data),
      bytes: num(a.bytes, String(a.data).length),
    })) : []
  return {
    nodes: узлы,
    assets: модели,
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
  const THREE = await neylivo.lib('three')
  const холст = neylivo.canvas()
  const рендер = new THREE.WebGLRenderer({ canvas: холст, antialias: true })
  рендер.shadowMap.enabled = !!данные.shadows

  const сцена = new THREE.Scene()
  сцена.background = new THREE.Color(данные.sky || '#0e1116')

  const камера = new THREE.PerspectiveCamera(данные.camera.fov || 60,
    холст.width / холст.height, 0.1, 500)

  сцена.add(new THREE.HemisphereLight(0xffffff, 0x223044, Number(данные.ambient) || 0))

  const поId = {}
  const скрипты = []

  // ── Модели ───────────────────────────────────────────────────────────────
  //
  // Модель лежит в самом проекте: glb — двоичный, поэтому base64, obj — текст.
  // Грузится она НЕ мгновенно, а объект в сцене нужен сразу (по нему щёлкают,
  // его двигают, на нём висит скрипт). Поэтому на месте модели сразу стоит
  // пустая группа, а содержимое приезжает в неё позже.

  function байтыИзБазы64(s) {
    const дв = atob(s)
    const из = new Uint8Array(дв.length)
    for (let i = 0; i < дв.length; i++) из[i] = дв.charCodeAt(i)
    return из
  }

  function теней(корень) {
    корень.traverse(function (o) {
      if (o.isMesh) { o.castShadow = !!данные.shadows; o.receiveShadow = true }
    })
  }

  /**
   * Вписать модель в заданный рост и поставить её НА ПОЛ.
   *
   * Про пол отдельно: у моделей начало координат бывает где угодно — в центре,
   * в макушке, в стороне. Без этого поставленное «в ноль» дерево наполовину
   * тонет в земле, и человек ищет ошибку в своих числах, а не в модели.
   */
  function вписать(корень, метров) {
    if (!(Number(метров) > 0)) return
    const короб = new THREE.Box3().setFromObject(корень)
    const размер = new THREE.Vector3()
    короб.getSize(размер)
    const бок = Math.max(размер.x, размер.y, размер.z)
    if (!(бок > 0) || !isFinite(бок)) return
    корень.scale.multiplyScalar(Number(метров) / бок)
    короб.setFromObject(корень)
    корень.position.y -= короб.min.y
  }

  /** Настоящий размер модели — наружу, чтобы мастерская показала его человеку. */
  function сообщиРазмер(n, корень) {
    try {
      const размер = new THREE.Vector3()
      new THREE.Box3().setFromObject(корень).getSize(размер)
      parent.postMessage({ ponoi: 1, k: 'сцена', модель: n.id,
        размер: [размер.x, размер.y, размер.z] }, '*')
    } catch (e) {}
  }

  function положиМодель(n, группа) {
    let a = null
    for (const x of (данные.assets || [])) if (x.id === n.asset) a = x
    if (!a) {
      console.warn('У объекта ' + n.name + ' не выбрана модель')
      return
    }
    const жалоба = function (e) {
      console.error('Модель ' + a.name + ' не читается: ' + ((e && e.message) || e))
    }
    try {
      if (a.format === 'obj') {
        const о = new THREE.OBJLoader().parse(a.data)
        группа.add(о)
        теней(о)
        вписать(о, n.fit)
        сообщиРазмер(n, о)
        return
      }
      const байты = байтыИзБазы64(a.data)
      new THREE.GLTFLoader().parse(байты.buffer, '', function (г) {
        группа.add(г.scene)
        теней(г.scene)
        вписать(г.scene, n.fit)
        сообщиРазмер(n, г.scene)
      }, жалоба)
    } catch (e) { жалоба(e) }
  }

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
    } else if (n.kind === 'model') {
      объект = new THREE.Group()
      положиМодель(n, объект)
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
        // Оба имени, как в загрузчике плагинов: скрипт объекта пишут той же
        // рукой, что и плагин, и он вправе звать и neylivo, и ponoi.
        const делай = new Function('это', 'сцена', 'THREE', 'neylivo', 'ponoi',
          '"use strict";' + n.script + '\n;return { onStart: typeof onStart === "function" ? onStart : null,'
          + ' onFrame: typeof onFrame === "function" ? onFrame : null }')
        const ч = делай(поId[n.id], сцена, THREE, ponoi, ponoi)
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
    // Облёт передаётся снаружи при пересборке вида: иначе каждая правка поля
    // возвращала бы камеру в начальное положение, и рассмотреть сцену с другой
    // стороны было бы нельзя дольше секунды.
    if (данные.орбита) {
      орбита.угол = Number(данные.орбита.угол) || орбита.угол
      орбита.высота = Number(данные.орбита.высота) || орбита.высота
      орбита.дальность = Number(данные.орбита.дальность) || орбита.дальность
    }
    // Облёт наружу — с задержкой: за один поворот колеса приходит десяток
    // событий, и слать столько же сообщений незачем.
    let ждёмОрбиту = null
    const отложиОрбиту = () => {
      if (ждёмОрбиту) clearTimeout(ждёмОрбиту)
      ждёмОрбиту = setTimeout(
        () => parent.postMessage({ ponoi: 1, k: 'сцена', орбита: орбита }, '*'), 250)
    }

    // ── Мышь в редакторе ─────────────────────────────────────────────────
    //
    // Тянуть ПО ОБЪЕКТУ — двигать объект, тянуть по пустому месту — облетать
    // сцену. Без этого место задавалось только тремя числами в инспекторе:
    // поставить стену там, где она нужна, значило подбирать координаты
    // вслепую, по одной десятой за раз.
    //
    // По земле, а не «куда смотрю»: объект тащится по плоскости своей высоты,
    // и пол под ним не меняется сам собой. Вверх и вниз — с Shift, по
    // плоскости, обращённой к камере.
    const луч = new THREE.Raycaster()
    const плоскость = new THREE.Plane()
    const точка = new THREE.Vector3()
    const сдвиг = new THREE.Vector3()
    let тащим = null

    const норм = e => {
      const r = холст.getBoundingClientRect()
      return new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const подЛучом = e => {
      луч.setFromCamera(норм(e), камера)
      // Рамку выбранного исключаем: она висит поверх объекта, и луч упирался
      // бы в неё вместо него — выбранное невозможно было бы ни перевыбрать,
      // ни сдвинуть.
      const цели = сцена.children.filter(o => o !== рамка)
      const попал = луч.intersectObjects(цели, true)
      for (const п of попал) {
        let o = п.object
        while (o && !o.userData.id) o = o.parent
        if (o && o.userData.id) return o
      }
      return null
    }

    холст.addEventListener('pointerdown', e => {
      холст.setPointerCapture(e.pointerId)
      const о = подЛучом(e)
      if (!о) { тянут = true; return }
      parent.postMessage({ ponoi: 1, k: 'сцена', выбран: о.userData.id }, '*')
      подсветить(о.userData.id)
      тащим = о
      if (e.shiftKey) {
        const н = new THREE.Vector3()
        камера.getWorldDirection(н)
        н.y = 0
        плоскость.setFromNormalAndCoplanarPoint(н.normalize(), о.position)
      } else {
        плоскость.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), о.position)
      }
      луч.setFromCamera(норм(e), камера)
      if (луч.ray.intersectPlane(плоскость, точка)) сдвиг.copy(о.position).sub(точка)
      else сдвиг.set(0, 0, 0)
    })
    холст.addEventListener('pointerup', e => {
      try { холст.releasePointerCapture(e.pointerId) } catch (err) {}
      if (тащим) {
        // Наружу — только когда отпустили. Слать на каждый кадр значило бы
        // перерисовывать инспектор шестьдесят раз в секунду ради чисел,
        // которые всё равно ещё меняются.
        parent.postMessage({ ponoi: 1, k: 'сцена', двинут: тащим.userData.id,
          где: [тащим.position.x, тащим.position.y, тащим.position.z] }, '*')
        тащим = null
      } else if (тянут) отложиОрбиту()
      тянут = false
    })
    холст.addEventListener('pointermove', e => {
      if (тащим) {
        луч.setFromCamera(норм(e), камера)
        if (луч.ray.intersectPlane(плоскость, точка)) {
          тащим.position.copy(точка).add(сдвиг)
          if (рамка) рамка.update()
        }
        return
      }
      if (!тянут) return
      орбита.угол -= e.movementX * 0.006
      орбита.высота = Math.max(-1.4, Math.min(1.4, орбита.высота + e.movementY * 0.006))
    })
    холст.addEventListener('wheel', e => {
      e.preventDefault()
      орбита.дальность = Math.max(1.5, Math.min(80, орбита.дальность * (1 + Math.sign(e.deltaY) * 0.12)))
      отложиОрбиту()
    }, { passive: false })

    // Щелчок по пустому месту снимает выбор. Отдельным событием, потому что
    // pointerdown по пустому месту — это ещё и начало облёта: снимать выбор
    // сразу значило бы терять его при каждом повороте камеры.
    холст.addEventListener('click', e => {
      if (!подЛучом(e)) parent.postMessage({ ponoi: 1, k: 'сцена', выбран: null }, '*')
    })
  } else if (данные.fly) {
    // В игре — ходьба и осмотр, как в любой игре от первого лица.
    const клавиши = {}
    addEventListener('keydown', e => { клавиши[e.code] = true })
    addEventListener('keyup', e => { клавиши[e.code] = false })
    let рыскание = 0, тангаж = 0
    холст.addEventListener('click', () => neylivo.cursor.lock(холст))
    addEventListener('pointermove', e => {
      if (!neylivo.cursor.locked()) return
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

  neylivo.frame(dt => {
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

/** Где стоит камера облёта в редакторе. Живёт вне сцены: это вид, а не данные. */
export interface Орбита { угол: number; высота: number; дальность: number }

/**
 * Страница редактора: движок плюс запуск в нужном режиме.
 *
 * Облёт передаётся отдельным доводом, а НЕ полем сцены. Разница важная: сцена —
 * это то, что уедет в готовое приложение, а «откуда я сейчас смотрю» касается
 * только мастерской и в игру попадать не должно.
 */
export function scenePage(scene: Scene, режим: 'редактор' | 'игра', орбита?: Орбита | null): string {
  const данные = орбита ? { ...scene, орбита } : scene
  return '<style>body{margin:0;overflow:hidden;background:' + scene.sky + '}'
    + 'canvas{display:block;width:100%;height:100%}</style>\n'
    + '<script>\n;(async () => {\n'
    + SCENE_RUNTIME + '\n'
    + 'await запустиСцену(' + JSON.stringify(данные) + ', ' + JSON.stringify(режим) + ')\n'
    + '})().catch(e => console.error("Сцена не запустилась: " + ((e && e.message) || e)))\n'
    + '</script>'
}
