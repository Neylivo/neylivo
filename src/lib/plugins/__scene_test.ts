// v1.555.0: живая проверка сцены и моделей. Запуск: npm run test:scene
//
// ЗАЧЕМ НАСТОЯЩИЙ БРАУЗЕР. Чистые проверки в __test.ts стерегут ДАННЫЕ: что
// модель легла в проект, не задвоилась и открылась обратно. Про то, читается ли
// она на самом деле, они не говорят ничего — а именно там всё и ломается:
// base64 разворачивается в байты, байты уходят в GLTFLoader, загрузчик отдаёт
// объект, объект меряется и вписывается в заданный рост. Пять стыков, и ни один
// из них в Node не воспроизвести.
//
// Модель здесь делается ПРЯМО В ПРОВЕРКЕ, а не лежит файлом в репозитории:
// двоичный файл в исходниках нельзя ни прочитать глазами, ни поправить, и через
// год никто не вспомнит, что в нём. Собранный на месте glTF, наоборот, читается
// как текст — и видно, что в нём ровно один треугольник размером 2 на 4.
import { frameDoc } from './htmlFrame'
import { libList, libSource } from './libs'
import { addModel, emptyScene, scenePage, type Scene } from './scene'

const вывод = document.getElementById('out')!
const строки: string[] = []
let провалено = 0

function пиши(s: string) {
  строки.push(s)
  вывод.textContent = строки.join('\n')
}

async function check(имя: string, fn: () => boolean | Promise<boolean>) {
  try {
    const ок = await fn()
    пиши((ок ? 'OK   ' : 'ПРОВАЛ ') + имя)
    if (!ок) провалено++
  } catch (e: any) {
    пиши('ПРОВАЛ ' + имя + ' — ' + (e?.message ?? e))
    провалено++
  }
}

// ── Модель на месте ────────────────────────────────────────────────────────

/**
 * Самый маленький настоящий .glb: один треугольник 2 × 4 × 0.
 *
 * Формат простой: заголовок из трёх чисел, потом куски. Куски обязаны быть
 * выровнены по четыре байта — иначе загрузчик читает длину следующего куска не
 * с того места и жалуется на «неизвестный тип куска».
 */
function минимальныйGlb(): Uint8Array {
  const позиции = new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0])
  const бин = new Uint8Array(позиции.buffer)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: бин.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: бин.length, target: 34962 }],
    accessors: [{
      bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
      min: [0, 0, 0], max: [2, 4, 0],
    }],
  }
  const до4 = (n: number) => (4 - (n % 4)) % 4
  const текст = new TextEncoder().encode(JSON.stringify(json))
  // JSON добивается пробелами, двоичное — нулями: так велит сам формат.
  const jс = new Uint8Array(текст.length + до4(текст.length)).fill(0x20)
  jс.set(текст)
  const bс = new Uint8Array(бин.length + до4(бин.length))
  bс.set(бин)

  const всего = 12 + 8 + jс.length + 8 + bс.length
  const из = new Uint8Array(всего)
  const вид = new DataView(из.buffer)
  вид.setUint32(0, 0x46546c67, true)   // 'glTF'
  вид.setUint32(4, 2, true)            // версия
  вид.setUint32(8, всего, true)
  вид.setUint32(12, jс.length, true)
  вид.setUint32(16, 0x4e4f534a, true)  // 'JSON'
  из.set(jс, 20)
  const b = 20 + jс.length
  вид.setUint32(b, bс.length, true)
  вид.setUint32(b + 4, 0x004e4942, true) // 'BIN'
  из.set(bс, b + 8)
  return из
}

function вБазу64(байты: Uint8Array): string {
  let s = ''
  for (let i = 0; i < байты.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(байты.subarray(i, i + 0x8000)))
  }
  return btoa(s)
}

/**
 * Запустить сцену в настоящей рамке и дождаться, пока движок сообщит размер
 * загруженной модели.
 *
 * Ответчик здесь ТОТ ЖЕ, что в мастерской: журнал и выдача библиотек. Иначе
 * страница ждала бы three вечно, и проверка мерила бы собственную заглушку.
 */
function запусти(scene: Scene, режим: 'редактор' | 'игра'): Promise<{
  размеры: Record<string, number[]>; журнал: string[]
}> {
  return new Promise(готово => {
    const размеры: Record<string, number[]> = {}
    const журнал: string[] = []
    const рамка = document.createElement('iframe')
    рамка.setAttribute('sandbox', 'allow-scripts allow-pointer-lock')
    рамка.style.cssText = 'width:480px;height:320px;border:0'

    const конец = setTimeout(() => финиш(), 25000)
    let закончили = false
    function финиш() {
      if (закончили) return
      закончили = true
      clearTimeout(конец)
      window.removeEventListener('message', на)
      рамка.remove()
      готово({ размеры, журнал })
    }

    async function на(e: MessageEvent) {
      if (e.source !== рамка.contentWindow) return
      const m = e.data as any
      if (!m || m.ponoi !== 1) return
      if (m.k === 'сцена') {
        if (m.модель && Array.isArray(m.размер)) {
          размеры[String(m.модель)] = m.размер as number[]
          // Размер приходит последним из всего, что нас интересует: модель к
          // этому моменту уже разобрана, вписана и поставлена на пол.
          setTimeout(финиш, 400)
        }
        return
      }
      if (m.k !== 'call') return
      const ответ = (ok: boolean, value: unknown, error: string) =>
        рамка.contentWindow?.postMessage({ ponoi: 1, k: 'res', id: m.id, ok, value, error }, '*')
      const args = Array.isArray(m.args) ? m.args : []
      switch (String(m.method)) {
        case 'log':
          журнал.push(String(args[1] ?? 'log') + ': ' + String(args[0] ?? ''))
          return ответ(true, null, '')
        case 'libs.list': return ответ(true, await libList(), '')
        case 'libs.get': {
          const b = await libSource(String(args[0] ?? ''))
          return b ? ответ(true, b, '') : ответ(false, null, 'нет такой библиотеки')
        }
        case 'subscribe': return ответ(true, null, '')
        default: return ответ(false, null, 'в проверке недоступно')
      }
    }

    window.addEventListener('message', на)
    рамка.srcdoc = frameDoc(scenePage(scene, режим))
    document.body.appendChild(рамка)
  })
}

// ── Проверки ───────────────────────────────────────────────────────────────

const glb = минимальныйGlb()
const сцена = addModel(emptyScene(), {
  name: 'проба.glb', format: 'glb', data: вБазу64(glb), bytes: glb.length,
})
const узелМодели = сцена.id
const итог = await запусти(сцена.scene, 'редактор')

пиши('журнал страницы:\n  ' + (итог.журнал.join('\n  ') || '(пусто)'))

await check('модель правда загрузилась в сцену', () => {
  const р = итог.размеры[узелМодели]
  if (!р) throw new Error('движок не сообщил размер — модель не доехала')
  return р.length === 3
})

await check('модель вписана в заданный рост', () => {
  // Треугольник 2 × 4 × 0 при «вписать в 2 м» обязан стать 1 × 2 × 0:
  // наибольшая сторона равна заданной, пропорции целы.
  const р = итог.размеры[узелМодели]
  if (!р) throw new Error('размера нет')
  const бок = Math.max(р[0], р[1], р[2])
  if (Math.abs(бок - 2) > 0.02) throw new Error('наибольшая сторона ' + бок.toFixed(3) + ', а задано 2')
  return Math.abs(р[0] - 1) < 0.02 && Math.abs(р[1] - 2) < 0.02
})

await check('на странице нет жалоб про модель', () => {
  const плохо = итог.журнал.filter(с => /не читается|не запустилась|не выбрана модель/.test(с))
  if (плохо.length) throw new Error(плохо.join(' | '))
  return true
})

await check('модель без вписывания остаётся своего размера', async () => {
  // Ноль в поле «вписать» обязан значить «не трогать»: иначе выключить подгонку
  // было бы нечем, и своя выверенная модель всё равно уезжала бы в чужой рост.
  const s: Scene = {
    ...сцена.scene,
    nodes: сцена.scene.nodes.map(n => (n.id === узелМодели ? { ...n, fit: 0 } : n)),
  }
  const р2 = (await запусти(s, 'редактор')).размеры[узелМодели]
  if (!р2) throw new Error('движок не сообщил размер')
  return Math.abs(р2[0] - 2) < 0.02 && Math.abs(р2[1] - 4) < 0.02
})

await check('в игре модель тоже на месте', async () => {
  // Редактор и игра рисуются одним движком — но проверить это надо, а не
  // предполагать: расхождение здесь означало бы «в редакторе было по-другому».
  const р3 = (await запусти(сцена.scene, 'игра')).размеры[узелМодели]
  if (!р3) throw new Error('в игре модель не загрузилась')
  return Math.abs(Math.max(р3[0], р3[1], р3[2]) - 2) < 0.02
})

пиши('\nИТОГ: пройдено ' + (строки.filter(s => s.startsWith('OK')).length)
  + ', провалено ' + провалено)
;(window as any).__failed = провалено
;(window as any).__done = true
