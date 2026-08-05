// v1.473.0: свои файлы у плагина — картинки, звуки, шрифты, данные.
//
// Зачем. Плагин — это ОДИН файл с кодом. Картинку спрайта, звук уведомления,
// шрифт или таблицу данных в него положить негде: `image` в панели умеет только
// https-ссылку на чужой сайт, а значит, всё это либо живёт у кого-то другого и
// однажды пропадает, либо не существует вовсе. Игры, визуализаторы, свои темы
// оформления — всё упиралось ровно в это.
//
// Что здесь есть. Плагин кладёт файл к себе (`put`) или скачивает его один раз
// с объявленного домена (`fetch`), а дальше пользуется им БЕЗ интернета: рисует
// на холсте, показывает строкой панели, играет звуком. Файл лежит на устройстве
// человека, в той же базе, что и таблицы плагина.
//
// Три правила, на которых всё держится:
//
//   1. ВИД ФАЙЛА ОПРЕДЕЛЯЕТСЯ ПО СОДЕРЖИМОМУ, а не по имени и не по тому, что
//      сказал плагин. `sprite.png` с разметкой внутри — это разметка, и её
//      здесь не будет. Список видов закрытый: картинки, звук, шрифты, данные.
//      HTML, SVG и всё неопознанное — отказ с объяснением, что найдено.
//
//   2. ПЛАГИН НЕ ПОЛУЧАЕТ ССЫЛКИ. Ни blob:, ни data: — наружу уходит только
//      имя. Строка панели пишется как `asset:имя`, и в настоящий адрес её
//      превращает приложение, при показе, для своего же плагина. Дай мы blob:
//      URL — он тут же уехал бы в сообщение, в чужой сайт или в чужую панель.
//
//   3. ЧУЖОГО НЕ ВИДНО. Имя плагина входит в ключ и подставляется здесь, а не
//      приходит от него, — как и в таблицах (db.ts).
//
// Проверки: src/lib/plugins/__test.ts и __attack_test.ts.

import { STORE_ASSETS as STORE, запрос, лавка } from './idb'

export class AssetError extends Error {}

/** Один файл целиком. Больше — это уже не «ресурс плагина», а хранилище. */
export const MAX_ASSET_BYTES = 32 * 1024 * 1024
/** Сколько файлов у одного плагина. */
export const MAX_ASSETS = 500
/** Сколько всего места на плагин. Половина обычной квоты браузера на origin. */
export const MAX_ASSETS_TOTAL = 256 * 1024 * 1024
/** Длина имени файла. */
export const MAX_ASSET_NAME = 120

/** Разделитель в составном ключе — тот же приём, что в db.ts. */
const SEP = '\u0000'
/** Чего в имени быть не может: управляющие знаки (в том числе разделитель
 *  ключа) и черта пути в обе стороны. */
const NAME_BAD = /[\u0000-\u001f\u007f/\\]/

/**
 * Имя файла.
 *
 * Кириллица разрешена нарочно: плагины здесь пишут по-русски, и «спрайт.png»
 * должен работать. Запрещено ровно то, чем можно навредить, а не всё подряд.
 *
 * Точка с точкой запрещена не «на всякий случай»: имя попадает в ключ базы, а
 * `../` в чужих системах ровно так и выводит за свой угол. Здесь выхода нет по
 * устройству ключа, но правило дешевле проверки «а точно ли нет».
 */
export function checkAssetName(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) throw new AssetError('Файлу нужно имя')
  if (s.length > MAX_ASSET_NAME) throw new AssetError(`Имя длиннее ${MAX_ASSET_NAME} знаков`)
  if (s.includes('..')) throw new AssetError('В имени файла не может быть «..»')
  if (NAME_BAD.test(s)) throw new AssetError('В имени файла не может быть черты пути и невидимых знаков')
  return s
}

// ── Что это за файл ─────────────────────────────────────────────────────────

/**
 * Опознание по первым байтам.
 *
 * Порядок важен: WebP и WAV начинаются одинаково (RIFF), различаются четвёртым
 * словом; у mp4/m4a метка лежит не в начале, а после длины блока.
 */
interface Вид { type: string; kind: 'image' | 'audio' | 'video' | 'font' | 'data' }

const МЕТКИ: { sig: number[]; at?: number; also?: { at: number; sig: number[] }; вид: Вид }[] = [
  { sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], вид: { type: 'image/png', kind: 'image' } },
  { sig: [0xff, 0xd8, 0xff], вид: { type: 'image/jpeg', kind: 'image' } },
  { sig: [0x47, 0x49, 0x46, 0x38], вид: { type: 'image/gif', kind: 'image' } },
  { sig: [0x42, 0x4d], вид: { type: 'image/bmp', kind: 'image' } },
  { sig: [0x52, 0x49, 0x46, 0x46], also: { at: 8, sig: [0x57, 0x45, 0x42, 0x50] }, вид: { type: 'image/webp', kind: 'image' } },
  { sig: [0x52, 0x49, 0x46, 0x46], also: { at: 8, sig: [0x57, 0x41, 0x56, 0x45] }, вид: { type: 'audio/wav', kind: 'audio' } },
  { sig: [0x4f, 0x67, 0x67, 0x53], вид: { type: 'audio/ogg', kind: 'audio' } },
  { sig: [0x66, 0x4c, 0x61, 0x43], вид: { type: 'audio/flac', kind: 'audio' } },
  { sig: [0x49, 0x44, 0x33], вид: { type: 'audio/mpeg', kind: 'audio' } },
  { sig: [0xff, 0xfb], вид: { type: 'audio/mpeg', kind: 'audio' } },
  { sig: [0xff, 0xf3], вид: { type: 'audio/mpeg', kind: 'audio' } },
  { sig: [0xff, 0xf2], вид: { type: 'audio/mpeg', kind: 'audio' } },
  // mp4/m4a: 'ftyp' с четвёртого байта, дальше марка. Звук и видео здесь
  // неразличимы без разбора всего файла, поэтому вид один — video/mp4:
  // в <audio> он играет так же, а в <img> не попадёт ни при каком виде.
  { sig: [0x66, 0x74, 0x79, 0x70], at: 4, вид: { type: 'video/mp4', kind: 'video' } },
  { sig: [0x1a, 0x45, 0xdf, 0xa3], вид: { type: 'video/webm', kind: 'video' } },
  { sig: [0x77, 0x4f, 0x46, 0x46], вид: { type: 'font/woff', kind: 'font' } },
  { sig: [0x77, 0x4f, 0x46, 0x32], вид: { type: 'font/woff2', kind: 'font' } },
  { sig: [0x00, 0x01, 0x00, 0x00, 0x00], вид: { type: 'font/ttf', kind: 'font' } },
  { sig: [0x4f, 0x54, 0x54, 0x4f], вид: { type: 'font/otf', kind: 'font' } },
]

function совпало(b: Uint8Array, sig: number[], at = 0): boolean {
  if (b.length < at + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false
  return true
}

/**
 * Похоже ли начало файла на разметку.
 *
 * Отдельно от «неизвестный вид» ради ответа человеку: «это разметка, её сюда
 * нельзя» объясняет причину, а «неизвестный вид» заставляет гадать. SVG сюда же
 * — картинка, внутри которой может быть код, это не картинка.
 */
function разметка(текст: string): boolean {
  const t = текст.trimStart().slice(0, 200).toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<svg')
    || t.startsWith('<?xml') || t.startsWith('<script')
}

/**
 * Вид файла по содержимому. Ничего не «угадывает»: не опознал — отказ.
 *
 * Текст и JSON опознаются последними и только если байты действительно
 * читаются как UTF-8 без управляющих знаков: иначе любой двоичный мусор
 * проехал бы сюда под видом «данных».
 */
export function sniffAsset(buf: ArrayBuffer): Вид {
  const b = new Uint8Array(buf)
  if (b.length === 0) throw new AssetError('Пустой файл')
  for (const м of МЕТКИ) {
    if (!совпало(b, м.sig, м.at ?? 0)) continue
    if (м.also && !совпало(b, м.also.sig, м.also.at)) continue
    return м.вид
  }
  // Дальше — только текстовые виды. Читаем начало и проверяем, что это правда
  // текст: fatal:true уронит разбор на первом же неверном байте.
  let начало = ''
  try {
    начало = new TextDecoder('utf-8', { fatal: true }).decode(b.slice(0, Math.min(b.length, 4096)))
  } catch {
    throw new AssetError('Не удалось опознать файл: это не картинка, не звук, не шрифт и не текст')
  }
  if (разметка(начало)) {
    throw new AssetError('Разметку (HTML, SVG, XML) хранить ресурсом нельзя — внутри неё может быть код')
  }
  // Управляющие знаки в тексте означают, что это всё-таки двоичный файл.
  if (/[\u0000-\u0008\u000e-\u001f]/.test(начало)) {
    throw new AssetError('Не удалось опознать файл: это не картинка, не звук, не шрифт и не текст')
  }
  const t = начало.trimStart()[0]
  if (t === '{' || t === '[') {
    // Целиком разбирать не пытаемся: файл может быть на сотню мегабайт, а
    // «начинается как JSON» — это ровно то, что нам нужно знать про вид.
    return { type: 'application/json', kind: 'data' }
  }
  return { type: 'text/plain', kind: 'data' }
}

// ── Хранение ────────────────────────────────────────────────────────────────

interface Запись {
  k: string
  p: string
  name: string
  type: string
  kind: string
  size: number
  at: number
  data: ArrayBuffer
}

/** Что плагин узнаёт о своём файле. Самих байтов здесь нет — они по get(). */
export interface AssetInfo { name: string; type: string; kind: string; size: number; at: number }

const ключ = (pluginId: string, name: string) => pluginId + SEP + name
const снаружи = (r: Запись): AssetInfo => ({ name: r.name, type: r.type, kind: r.kind, size: r.size, at: r.at })

async function свои(pluginId: string): Promise<Запись[]> {
  const st = await лавка(STORE, 'readonly')
  const idx = st.index('byPlugin')
  return запрос(idx.getAll(IDBKeyRange.only(pluginId)), r => (r.result as Запись[]) ?? [])
}

/**
 * Байты от плагина — во что угодно из того, что он может прислать.
 *
 * ArrayBuffer и типизированные массивы приезжают как есть (структурным
 * клоном), строка — как base64 или data:-строка. Обычный текст строкой тоже
 * годится: свой JSON плагин пишет именно так.
 */
export function bytesFrom(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer
  }
  if (typeof data === 'string') {
    let s = data
    const m = /^data:[^;,]*;base64,/i.exec(s)
    if (m) s = s.slice(m[0].length)
    else if (/^data:/i.test(s)) {
      // data:...,текст — без base64. Разбираем как текст, а не молча роняем.
      return new TextEncoder().encode(decodeURIComponent(s.slice(s.indexOf(',') + 1))).buffer as ArrayBuffer
    }
    if (m || /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, '').length % 4 === 0 && s.length > 8) {
      try {
        const bin = atob(s.replace(/\s/g, ''))
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out.buffer
      } catch {
        if (m) throw new AssetError('Строка помечена как base64, но разобрать её не удалось')
      }
    }
    return new TextEncoder().encode(s).buffer as ArrayBuffer
  }
  throw new AssetError('Файл — это байты (ArrayBuffer, Uint8Array) или строка (base64, data:, текст)')
}

/** Положить файл к себе. Возвращает то же, что покажет list. */
export async function assetPut(pluginId: string, name: string, data: unknown): Promise<AssetInfo> {
  const n = checkAssetName(name)
  // Blob разбирается отдельно: у него байты достаются только обещанием, а
  // bytesFrom обязан оставаться чистой функцией — её и проверяют отдельно.
  const buf = typeof Blob !== 'undefined' && data instanceof Blob
    ? await data.arrayBuffer()
    : bytesFrom(data)
  if (buf.byteLength > MAX_ASSET_BYTES) {
    throw new AssetError(`Файл больше ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} МБ`)
  }
  const вид = sniffAsset(buf)

  const было = await свои(pluginId)
  const прежний = было.find(r => r.name === n)
  if (!прежний && было.length >= MAX_ASSETS) {
    throw new AssetError(`У плагина уже ${MAX_ASSETS} файлов — больше нельзя.`)
  }
  // Перезапись своего же файла не должна считаться за прибавку: иначе плагин,
  // обновляющий один и тот же файл, упирался бы в общий предел на ровном месте.
  const занято = было.reduce((s, r) => s + r.size, 0) - (прежний?.size ?? 0)
  if (занято + buf.byteLength > MAX_ASSETS_TOTAL) {
    throw new AssetError(`Место кончилось: у плагина может быть до ${Math.round(MAX_ASSETS_TOTAL / 1024 / 1024)} МБ файлов`)
  }

  const rec: Запись = {
    k: ключ(pluginId, n), p: pluginId, name: n,
    type: вид.type, kind: вид.kind, size: buf.byteLength, at: Date.now(), data: buf,
  }
  const st = await лавка(STORE, 'readwrite')
  await запрос(st.put(rec), () => null)
  // Ссылка на прежнее содержимое стала неверной — иначе панель показывала бы
  // старую картинку до перезапуска приложения.
  забытьСсылку(pluginId, n)
  return снаружи(rec)
}

async function запись(pluginId: string, name: string): Promise<Запись | null> {
  const n = checkAssetName(name)
  const st = await лавка(STORE, 'readonly')
  const r = await запрос(st.get(ключ(pluginId, n)), q => q.result as Запись | undefined)
  return r ?? null
}

/** Байты файла. Плагину уходит копия — своего у него не остаётся. */
export async function assetGet(pluginId: string, name: string): Promise<ArrayBuffer | null> {
  const r = await запись(pluginId, name)
  return r ? r.data : null
}

export async function assetInfo(pluginId: string, name: string): Promise<AssetInfo | null> {
  const r = await запись(pluginId, name)
  return r ? снаружи(r) : null
}

export async function assetList(pluginId: string): Promise<AssetInfo[]> {
  const все = await свои(pluginId)
  return все.map(снаружи).sort((a, b) => a.name.localeCompare(b.name))
}

export async function assetRemove(pluginId: string, name: string): Promise<boolean> {
  const n = checkAssetName(name)
  const st = await лавка(STORE, 'readwrite')
  const было = await запрос(st.get(ключ(pluginId, n)), q => q.result as Запись | undefined)
  if (!было) return false
  await запрос(st.delete(ключ(pluginId, n)), () => null)
  забытьСсылку(pluginId, n)
  return true
}

/** Убрать все файлы плагина. Как и таблицы, зовётся при УДАЛЕНИИ плагина, а не
 *  при выключении: выключил — файлы должны дождаться включения обратно. */
export async function assetClear(pluginId: string): Promise<number> {
  const все = await свои(pluginId)
  const st = await лавка(STORE, 'readwrite')
  for (const r of все) st.delete(r.k)
  забытьСсылки(pluginId)
  return все.length
}

/** Сколько места занято — для карточки плагина. */
export async function assetUsage(pluginId: string): Promise<{ count: number; bytes: number }> {
  const все = await свои(pluginId)
  return { count: все.length, bytes: все.reduce((s, r) => s + r.size, 0) }
}

// ── Ссылки для показа ───────────────────────────────────────────────────────
//
// Адрес живёт ЗДЕСЬ, а не у плагина. Плагин пишет в строке панели `asset:имя`,
// приложение при показе меняет это на настоящий адрес своего же плагина. Так
// ссылку неоткуда взять ни другому плагину, ни сообщению, ни чужому сайту.

const ссылки = new Map<string, string>()

/** Строка вида `asset:имя` — и ничего больше. */
export const ASSET_PREFIX = 'asset:'
export function isAssetRef(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(ASSET_PREFIX)
}
export function assetRefName(v: string): string {
  return v.slice(ASSET_PREFIX.length).trim()
}

function забытьСсылку(pluginId: string, name: string) {
  const k = ключ(pluginId, name)
  const url = ссылки.get(k)
  if (url) { try { URL.revokeObjectURL(url) } catch {} ссылки.delete(k) }
}

function забытьСсылки(pluginId: string) {
  for (const k of [...ссылки.keys()]) {
    if (k.startsWith(pluginId + SEP)) {
      try { URL.revokeObjectURL(ссылки.get(k)!) } catch {}
      ссылки.delete(k)
    }
  }
}

/**
 * Настоящий адрес файла — для картинки в панели и для звука.
 *
 * Только для показа приложением. Ссылка кэшируется: у одной и той же картинки в
 * панели, которая перерисовывается на каждое движение ползунка, не должно
 * появляться по новому blob-адресу на кадр — это течь памяти в чистом виде.
 */
export async function assetUrl(pluginId: string, name: string): Promise<string | null> {
  const n = checkAssetName(name)
  const k = ключ(pluginId, n)
  const было = ссылки.get(k)
  if (было) return было
  const r = await запись(pluginId, n)
  if (!r) return null
  const url = URL.createObjectURL(new Blob([r.data], { type: r.type }))
  ссылки.set(k, url)
  return url
}

/** Уборка за плагином: адреса живут в окне и сами не пропадут. */
export function clearAssetUrls(pluginId: string) { забытьСсылки(pluginId) }

export function clearAllAssetUrls() {
  for (const url of ссылки.values()) { try { URL.revokeObjectURL(url) } catch {} }
  ссылки.clear()
}

/** Сколько адресов выдано — видно только проверкам, чтобы ловить течь. */
export function assetUrlCount(): number { return ссылки.size }
